import { beforeEach, describe, expect, it, vi } from 'vitest';

// Node test environment (vitest.config.ts): never load the native
// expo-notifications module — scheduleFollowUpNotification is pure/DI'd
// (mirrors useSkeletonFlow.test.ts's pattern), so only the enum constant
// SchedulableTriggerInputTypes.DATE needs mocking.
vi.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

import {
  buildFollowUpPresets,
  defaultFollowUpDate,
  scheduleFollowUpNotification,
} from './useFollowUpSchedule';
import type { NotificationsClient } from './useFollowUpSchedule';

function fakeNotifications(overrides: Partial<NotificationsClient> = {}): NotificationsClient {
  return {
    requestPermissionsAsync: vi.fn(async () => ({ granted: true }) as never),
    scheduleNotificationAsync: vi.fn(async () => 'notification-id'),
    ...overrides,
  } as NotificationsClient;
}

/** First-call-first-arg helper, avoiding `mock.calls[0][0]` possibly-undefined noise under strict mode. */
function firstScheduleCall(notifications: NotificationsClient) {
  const mockFn = notifications.scheduleNotificationAsync as ReturnType<typeof vi.fn>;
  const call = mockFn.mock.calls[0];
  if (!call) throw new Error('scheduleNotificationAsync was never called');
  return call[0] as {
    content: { title: string; body: string; data: Record<string, unknown> };
    trigger: { type: string; date: Date };
  };
}

describe('buildFollowUpPresets (JS-only one-tap follow-up presets)', () => {
  // A fixed local reference moment (Mon 2026-07-20, 15:05 local).
  const now = new Date(2026, 6, 20, 15, 5, 30, 500);

  it('offers exactly the four presets in order', () => {
    expect(buildFollowUpPresets(now).map((p) => p.key)).toEqual([
      'today18',
      'tomorrow11',
      'in3days',
      'nextWeek',
    ]);
  });

  it('"Heute 18:00" is today at 18:00 local, seconds/ms zeroed', () => {
    const today18 = buildFollowUpPresets(now)[0]!.date;
    expect(today18.getFullYear()).toBe(2026);
    expect(today18.getMonth()).toBe(6);
    expect(today18.getDate()).toBe(20);
    expect(today18.getHours()).toBe(18);
    expect(today18.getMinutes()).toBe(0);
    expect(today18.getSeconds()).toBe(0);
  });

  it('"Morgen 11:00" is tomorrow at 11:00 local', () => {
    const tomorrow11 = buildFollowUpPresets(now)[1]!.date;
    expect(tomorrow11.getDate()).toBe(21);
    expect(tomorrow11.getHours()).toBe(11);
    expect(tomorrow11.getMinutes()).toBe(0);
  });

  it('"In 3 Tagen" and "Nächste Woche" advance 3 and 7 days at 11:00 local', () => {
    const presets = buildFollowUpPresets(now);
    expect(presets[2]!.date.getDate()).toBe(23);
    expect(presets[2]!.date.getHours()).toBe(11);
    expect(presets[3]!.date.getDate()).toBe(27);
    expect(presets[3]!.date.getHours()).toBe(11);
  });

  it('carries a real Date on every preset (never a placeholder)', () => {
    for (const preset of buildFollowUpPresets(now)) {
      expect(preset.date).toBeInstanceOf(Date);
      expect(Number.isNaN(preset.date.getTime())).toBe(false);
    }
  });
});

describe('defaultFollowUpDate (UI-SPEC: tomorrow, next 30-min rounding)', () => {
  it('rounds up to the next 30-minute mark, same day-of-week tomorrow', () => {
    const now = new Date('2026-07-20T17:05:00Z');
    const result = defaultFollowUpDate(now);
    expect(result.getUTCDate()).toBe(21);
    expect(result.getUTCMinutes()).toBe(30);
    expect(result.getUTCHours()).toBe(17);
  });

  it('rolls the hour forward when rounding crosses the 60-minute mark', () => {
    const now = new Date('2026-07-20T17:45:00Z');
    const result = defaultFollowUpDate(now);
    expect(result.getUTCDate()).toBe(21);
    expect(result.getUTCHours()).toBe(18);
    expect(result.getUTCMinutes()).toBe(0);
  });

  it('is a no-op round when already on a 30-minute mark', () => {
    const now = new Date('2026-07-20T09:30:00Z');
    const result = defaultFollowUpDate(now);
    expect(result.getUTCHours()).toBe(9);
    expect(result.getUTCMinutes()).toBe(30);
  });
});

describe('scheduleFollowUpNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests permission then schedules a DATE trigger equal to the caller-provided time', async () => {
    const notifications = fakeNotifications();
    const when = new Date('2026-07-21T17:30:00Z');

    const result = await scheduleFollowUpNotification(notifications, 'house-1', when);

    expect(result).toEqual({ ok: true });
    expect(notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const call = firstScheduleCall(notifications);
    expect(call.trigger).toEqual({ type: 'date', date: when });
  });

  it('surfaces the houseId in the notification data payload', async () => {
    const notifications = fakeNotifications();
    await scheduleFollowUpNotification(notifications, 'house-42', new Date());

    const call = firstScheduleCall(notifications);
    expect(call.content.data).toEqual({ houseId: 'house-42' });
  });

  it('uses German i18n copy for the notification title/body (never hardcoded)', async () => {
    const notifications = fakeNotifications();
    await scheduleFollowUpNotification(notifications, 'house-7', new Date());

    const call = firstScheduleCall(notifications);
    expect(call.content.title).toBe('Follow-up fällig');
    expect(call.content.body).toBe('Haus house-7 — Termin erreicht');
  });

  it('a denied notification permission surfaces an error state, never throws', async () => {
    const notifications = fakeNotifications({
      requestPermissionsAsync: vi.fn(async () => ({ granted: false }) as never),
    });

    const result = await scheduleFollowUpNotification(notifications, 'house-1', new Date());

    expect(result).toEqual({ ok: false, error: 'notification permission denied' });
    expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('a native scheduling failure resolves to an error result, never throws uncaught', async () => {
    const notifications = fakeNotifications({
      scheduleNotificationAsync: vi.fn(async () => {
        throw new Error('native scheduling failed');
      }),
    });

    const result = await scheduleFollowUpNotification(notifications, 'house-1', new Date());

    expect(result).toEqual({ ok: false, error: 'native scheduling failed' });
  });
});
