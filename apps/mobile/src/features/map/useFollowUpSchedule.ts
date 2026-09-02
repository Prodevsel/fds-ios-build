import { useCallback, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { t } from '../../i18n';

/**
 * MAP-02: exact-time local follow-up reminders. Mirrors the `useSpeechProbe`
 * hook shape (useSpikeProbes.ts) — permission-request-then-act, useState
 * machine, try/catch around the native call so a denied/failed permission
 * surfaces as an error state and never throws uncaught.
 *
 * Android 12+ requires `SCHEDULE_EXACT_ALARM` (and Android 13+
 * `POST_NOTIFICATIONS`) in the installed manifest for this to fire at the
 * exact scheduled minute (02-RESEARCH.md Pitfall 4) — declared in
 * app.config.ts, only real on-device after the Task 3 rebuild.
 */

export type FollowUpScheduleStatus = 'idle' | 'scheduling' | 'ok' | 'error';

export interface FollowUpScheduleState {
  status: FollowUpScheduleStatus;
  error: string | null;
}

const IDLE: FollowUpScheduleState = { status: 'idle', error: null };

/** Structural slice of the expo-notifications module this hook depends on (injectable for tests). */
export type NotificationsClient = Pick<
  typeof Notifications,
  'requestPermissionsAsync' | 'scheduleNotificationAsync'
>;

/**
 * Tomorrow, current time rounded UP to the next 30-minute mark (UI-SPEC
 * "follow-up default: tomorrow, next 30-min rounding") — minimizes taps for
 * the common case ("tomorrow from 5:30 PM").
 */
export function defaultFollowUpDate(now: Date = new Date()): Date {
  const result = new Date(now);
  result.setDate(result.getDate() + 1);
  result.setSeconds(0, 0);
  const minutes = result.getMinutes();
  const roundedMinutes = Math.ceil(minutes / 30) * 30;
  if (roundedMinutes === 60) {
    result.setHours(result.getHours() + 1);
    result.setMinutes(0);
  } else {
    result.setMinutes(roundedMinutes);
  }
  return result;
}

/** The four one-tap follow-up presets offered in the StatusSheet picker. */
export type FollowUpPresetKey = 'today18' | 'tomorrow11' | 'in3days' | 'nextWeek';

export interface FollowUpPreset {
  key: FollowUpPresetKey;
  date: Date;
}

/** Set `base` to the given wall-clock hour:minute (seconds/ms zeroed). */
function atTime(base: Date, hours: number, minutes: number): Date {
  const result = new Date(base);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

/**
 * Pure builder for the four sensible follow-up presets (JS-only, no native
 * picker): "Heute 18:00", "Morgen 11:00", "In 3 Tagen" (11:00) and "Nächste
 * Woche" (in 7 days, 11:00). Each carries a real `Date` fed straight into the
 * appointment producer — never a fake/placeholder time. `now` is injectable for
 * deterministic tests. The day-based presets default to 11:00 (a reasonable
 * mid-morning door time); the rep can still fine-tune with the manual stepper.
 */
export function buildFollowUpPresets(now: Date = new Date()): FollowUpPreset[] {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const inThreeDays = new Date(now);
  inThreeDays.setDate(inThreeDays.getDate() + 3);
  const nextWeek = new Date(now);
  nextWeek.setDate(nextWeek.getDate() + 7);
  return [
    { key: 'today18', date: atTime(now, 18, 0) },
    { key: 'tomorrow11', date: atTime(tomorrow, 11, 0) },
    { key: 'in3days', date: atTime(inThreeDays, 11, 0) },
    { key: 'nextWeek', date: atTime(nextWeek, 11, 0) },
  ];
}

/**
 * Pure scheduling function, DI'd Notifications client (mirrors
 * useSkeletonFlow.test.ts's pattern: test the logic directly against a fake,
 * never load the native module in Node). Never throws — permission denial
 * and native-call failures both resolve to an `{ ok: false }` result.
 */
export async function scheduleFollowUpNotification(
  notifications: NotificationsClient,
  houseId: string,
  when: Date,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const permission = await notifications.requestPermissionsAsync();
    if (!permission.granted) {
      return { ok: false, error: 'notification permission denied' };
    }
    await notifications.scheduleNotificationAsync({
      content: {
        title: t('followUp.notificationTitle'),
        body: t('followUp.notificationBody').replace('{houseId}', houseId),
        data: { houseId },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeError(error) };
  }
}

export function useFollowUpSchedule(): {
  state: FollowUpScheduleState;
  scheduleFollowUp: (houseId: string, when: Date) => Promise<boolean>;
} {
  const [state, setState] = useState<FollowUpScheduleState>(IDLE);

  const scheduleFollowUp = useCallback(async (houseId: string, when: Date) => {
    setState({ status: 'scheduling', error: null });
    const result = await scheduleFollowUpNotification(Notifications, houseId, when);
    if (result.ok) {
      setState({ status: 'ok', error: null });
      return true;
    }
    setState({ status: 'error', error: result.error });
    return false;
  }, []);

  return { state, scheduleFollowUp };
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
