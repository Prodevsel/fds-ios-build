import { beforeEach, describe, expect, it, vi } from 'vitest';

// Node test environment: never load expo-notifications' native module — the
// tested core is pure/DI'd (mirrors useFollowUpSchedule.test.ts's pattern).
vi.mock('expo-notifications', () => ({}));
// The module under test transitively imports leaderboardCache.ts's default
// storage factory (react-native-mmkv, a native Nitro module) — every test
// here injects a fake cache, so this mock is never actually invoked (mirrors
// leaderboardCache.test.ts / useLeaderboard.test.ts's mock).
vi.mock('react-native-mmkv', () => ({
  createMMKV: vi.fn(() => {
    throw new Error('MMKV native module must never be constructed in unit tests');
  }),
}));
// getSupabase() (the default RealtimeClient factory) is never reached since
// every test injects a fake `realtime` — mirrors assignTerritory.test.ts's
// supabase-module mock convention.
vi.mock('../../lib/auth/supabase', () => ({ getSupabase: vi.fn() }));

import {
  dealClosedTopic,
  dispatchDealClosedNotification,
  subscribeDealClosedBroadcast,
} from './useDealClosedBroadcast';
import type {
  DealClosedBroadcastMessage,
  NotificationsClient,
  RealtimeChannelLike,
  RealtimeClient,
} from './useDealClosedBroadcast';
import type { LeaderboardCache, LeaderboardCacheKey } from '../leaderboard/db/leaderboardCache';

function fakeNotifications(overrides: Partial<NotificationsClient> = {}): NotificationsClient {
  return {
    requestPermissionsAsync: vi.fn(async () => ({ granted: true }) as never),
    scheduleNotificationAsync: vi.fn(async () => 'notification-id'),
    ...overrides,
  } as NotificationsClient;
}

/** First-call-first-arg helper (mirrors useFollowUpSchedule.test.ts). */
function firstScheduleCall(notifications: NotificationsClient) {
  const mockFn = notifications.scheduleNotificationAsync as ReturnType<typeof vi.fn>;
  const call = mockFn.mock.calls[0];
  if (!call) throw new Error('scheduleNotificationAsync was never called');
  return call[0] as {
    content: { title: string; body: string; data: Record<string, unknown> };
    trigger: unknown;
  };
}

/** A fake private-channel client whose `.on('broadcast', ...)` callback is
 * captured so the test can simulate an incoming server broadcast directly —
 * mirrors this repo's DI-fake convention (no real Supabase Realtime socket
 * is ever opened in a unit test). */
function fakeRealtimeClient(): {
  realtime: RealtimeClient;
  emit: (message: DealClosedBroadcastMessage) => void;
  channelCalls: string[];
  removeChannel: ReturnType<typeof vi.fn>;
} {
  const channelCalls: string[] = [];
  let capturedCallback: ((message: DealClosedBroadcastMessage) => void) | null = null;
  const removeChannel = vi.fn(async () => undefined);

  const channel: RealtimeChannelLike = {
    on: vi.fn((_type, _filter, callback) => {
      capturedCallback = callback;
      return channel;
    }),
    subscribe: vi.fn(() => channel),
  };

  const realtime: RealtimeClient = {
    channel: vi.fn((topic: string) => {
      channelCalls.push(topic);
      return channel;
    }),
    removeChannel,
  };

  return {
    realtime,
    emit: (message) => {
      if (!capturedCallback) throw new Error('no broadcast callback registered — subscribe first');
      capturedCallback(message);
    },
    channelCalls,
    removeChannel,
  };
}

function fakeCache(): LeaderboardCache & {
  invalidate: ReturnType<typeof vi.fn<(key: LeaderboardCacheKey) => void>>;
} {
  return {
    get: vi.fn(() => null),
    set: vi.fn(),
    invalidate: vi.fn((_key: LeaderboardCacheKey) => undefined),
  };
}

describe('dealClosedTopic', () => {
  it('derives the rep-own scoped team topic — never a global/guessed topic', () => {
    expect(dealClosedTopic('team-123')).toBe('leaderboard:team:team-123');
  });
});

describe('dispatchDealClosedNotification (GAMI-04, D-02 name-only)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requests permission then schedules an immediate, name-only German notification', async () => {
    const notifications = fakeNotifications();

    const result = await dispatchDealClosedNotification(notifications, 'Erika Muster');

    expect(result).toEqual({ ok: true });
    expect(notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const call = firstScheduleCall(notifications);
    expect(call.content.title).toBe('Team-Update');
    expect(call.content.body).toBe('Erika Muster hat abgeschlossen!');
    expect(call.content.data).toEqual({ repName: 'Erika Muster' });
    // No amount/counter key anywhere in the dispatched content (D-02/T-09-11).
    const serialized = JSON.stringify(call.content);
    expect(serialized).not.toMatch(/commission|amount|betrag|preis|deals?count|counter/i);
  });

  it('a denied permission is a no-op — never throws, never schedules', async () => {
    const notifications = fakeNotifications({
      requestPermissionsAsync: vi.fn(async () => ({ granted: false }) as never),
    });

    const result = await dispatchDealClosedNotification(notifications, 'Erika Muster');

    expect(result).toEqual({ ok: false, error: 'notification permission denied' });
    expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('a native scheduling failure resolves to an error result, never throws uncaught', async () => {
    const notifications = fakeNotifications({
      scheduleNotificationAsync: vi.fn(async () => {
        throw new Error('native scheduling failed');
      }),
    });

    const result = await dispatchDealClosedNotification(notifications, 'Erika Muster');

    expect(result).toEqual({ ok: false, error: 'native scheduling failed' });
  });
});

describe('subscribeDealClosedBroadcast (foreground Realtime subscription, GAMI-04)', () => {
  beforeEach(() => vi.clearAllMocks());

  const key = { teamId: 'team-1', scope: 'team' as const, period: 'week' as const };

  it('subscribes on the rep-own scoped team topic (never a client-guessed/global topic)', () => {
    const { realtime, channelCalls } = fakeRealtimeClient();
    const notifications = fakeNotifications();
    const cache = fakeCache();

    subscribeDealClosedBroadcast(realtime, notifications, cache, key);

    expect(channelCalls).toEqual(['leaderboard:team:team-1']);
  });

  it('an incoming { rep_name } broadcast triggers exactly one local notification and one cache invalidation', async () => {
    const { realtime, emit } = fakeRealtimeClient();
    const notifications = fakeNotifications();
    const cache = fakeCache();

    subscribeDealClosedBroadcast(realtime, notifications, cache, key);
    emit({
      payload: {
        operation: 'INSERT',
        table: 'contract_status_events',
        schema: 'public',
        record: { rep_name: 'Max Mustermann' },
        old_record: { rep_name: 'Max Mustermann' },
      },
    });

    // Notification dispatch is fire-and-forget (void) inside the sync
    // broadcast callback — flush microtasks before asserting.
    await Promise.resolve();
    await Promise.resolve();

    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const call = firstScheduleCall(notifications);
    expect(call.content.body).toBe('Max Mustermann hat abgeschlossen!');
    expect(cache.invalidate).toHaveBeenCalledTimes(1);
    expect(cache.invalidate).toHaveBeenCalledWith(key);
  });

  it('a broadcast with no rep_name is ignored — no notification, no invalidation (defensive, never throws)', async () => {
    const { realtime, emit } = fakeRealtimeClient();
    const notifications = fakeNotifications();
    const cache = fakeCache();

    subscribeDealClosedBroadcast(realtime, notifications, cache, key);
    emit({
      payload: {
        operation: 'INSERT',
        table: 'contract_status_events',
        schema: 'public',
        record: null,
        old_record: null,
      },
    });
    await Promise.resolve();

    expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('a denied notification permission on the received broadcast is a no-op, never throws', async () => {
    const { realtime, emit } = fakeRealtimeClient();
    const notifications = fakeNotifications({
      requestPermissionsAsync: vi.fn(async () => ({ granted: false }) as never),
    });
    const cache = fakeCache();

    subscribeDealClosedBroadcast(realtime, notifications, cache, key);
    expect(() =>
      emit({
        payload: {
          operation: 'INSERT',
          table: 'contract_status_events',
          schema: 'public',
          record: { rep_name: 'Erika Muster' },
          old_record: null,
        },
      }),
    ).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    // Cache invalidation is unconditional on receipt (independent of the
    // notification permission outcome) — the ranking is stale regardless of
    // whether the OS surfaced a notification for it.
    expect(cache.invalidate).toHaveBeenCalledTimes(1);
  });

  it('calls the optional onDealClosed callback with the rep name after dispatch', async () => {
    const { realtime, emit } = fakeRealtimeClient();
    const notifications = fakeNotifications();
    const cache = fakeCache();
    const onDealClosed = vi.fn();

    subscribeDealClosedBroadcast(realtime, notifications, cache, key, onDealClosed);
    emit({
      payload: {
        operation: 'INSERT',
        table: 'contract_status_events',
        schema: 'public',
        record: { rep_name: 'Erika Muster' },
        old_record: null,
      },
    });
    await Promise.resolve();

    expect(onDealClosed).toHaveBeenCalledWith('Erika Muster');
  });

  it('returns an unsubscribe function that removes the channel exactly once', () => {
    const { realtime, removeChannel } = fakeRealtimeClient();
    const notifications = fakeNotifications();
    const cache = fakeCache();

    const unsubscribe = subscribeDealClosedBroadcast(realtime, notifications, cache, key);
    unsubscribe();

    expect(removeChannel).toHaveBeenCalledTimes(1);
  });
});
