import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { t } from '../../i18n';
import { getSupabase } from '../../lib/auth/supabase';
import {
  type LeaderboardCache,
  type LeaderboardCacheKey,
  createLeaderboardCache,
} from '../leaderboard/db/leaderboardCache';

/**
 * useDealClosedBroadcast — GAMI-04 client leg (D-02 name-only, D-03). While
 * foregrounded, subscribes to the rep's OWN scoped Realtime topic
 * (`leaderboard:team:<team_id>` — never a client-guessed/global topic, T-09-12)
 * and, on a teammate's deal-close broadcast (09-06's `notify_deal_closed()`
 * trigger), shows a name-only German local notification (mirrors
 * useFollowUpSchedule.ts's DI'd NotificationsClient / permission-then-act /
 * never-throws pattern — this is a LOCAL notification, not a remote APNs/FCM
 * push; no such infra exists in this repo) and invalidates the cached
 * leaderboard entry for the currently-viewed team+scope+period key so a
 * subsequent offline RPC failure never silently serves the pre-broadcast
 * snapshot as current (T-09-11).
 *
 * The 09-01 spike verdict is PASS (see 09-REALTIME-SPIKE.md) — this ships the
 * real Realtime subscription path, not the documented poll-on-foreground
 * fallback.
 *
 * Foreground-only by design (subscribed while the screen holding this hook
 * is mounted/focused; unsubscribed on unmount/blur) — consistent with this
 * project's PowerSync-uploads-are-foreground-only precedent (01-09).
 * Authorization is NOT the client's job: `realtime.messages` RLS (0065) is
 * the real authority — subscribing to another team's topic is denied
 * server-side regardless of what a compromised client attempts (T-09-12).
 */

/** Structural slice of expo-notifications this hook depends on (mirrors
 * useFollowUpSchedule.ts's NotificationsClient DI — same never-throws
 * permission-then-act contract). */
export type NotificationsClient = Pick<
  typeof Notifications,
  'requestPermissionsAsync' | 'scheduleNotificationAsync'
>;

/** The single field 0065's `leaderboard_deal_closed_payload` composite type
 * carries (T-09-11) — the broadcast payload NEVER contains an amount,
 * counter, or any other contract-identifying field. */
export interface DealClosedRecord {
  rep_name: string;
}

/** Mirrors `realtime.broadcast_changes()`'s wrapped payload shape (verified
 * live against the installed Realtime extension in 09-06) — `record`/
 * `old_record` are both typed via the same dedicated composite, so neither
 * ever carries more than `rep_name`. */
export interface DealClosedBroadcastMessage {
  payload: {
    operation: string;
    table: string;
    schema: string;
    record: DealClosedRecord | null;
    old_record: DealClosedRecord | null;
  };
}

/** Structural slice of a subscribed private Realtime channel this hook
 * depends on — deliberately narrower than `@supabase/realtime-js`'s
 * `RealtimeChannel` class so a plain fake object satisfies it in tests
 * without ever constructing a real WebSocket channel. */
export interface RealtimeChannelLike {
  on(
    type: 'broadcast',
    filter: { event: string },
    callback: (message: DealClosedBroadcastMessage) => void,
  ): RealtimeChannelLike;
  subscribe(callback?: (status: string, err?: Error) => void): RealtimeChannelLike;
}

/** Structural slice of the Supabase client this hook depends on (mirrors
 * assignTerritory.ts's `Pick<SupabaseClient, 'rpc'>` DI convention). */
export interface RealtimeClient {
  channel(topic: string, opts?: { config: { private: boolean } }): RealtimeChannelLike;
  removeChannel(channel: RealtimeChannelLike): Promise<unknown>;
}

const DEAL_CLOSED_EVENT = 'deal_closed';

/** The rep's own scoped team topic (0065) — teamId must come from the rep's
 * own membership (useRoleScope-derived selection), never a client-guessed
 * arbitrary team; RLS on `realtime.messages` is the real authority either way. */
export function dealClosedTopic(teamId: string): string {
  return `leaderboard:team:${teamId}`;
}

/**
 * Pure scheduling function for the name-only local notification — never
 * throws (permission denial / native failure both resolve to an `{ok:false}`
 * result), exactly mirroring `scheduleFollowUpNotification`'s contract.
 */
export async function dispatchDealClosedNotification(
  notifications: NotificationsClient,
  repName: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const permission = await notifications.requestPermissionsAsync();
    if (!permission.granted) {
      return { ok: false, error: 'notification permission denied' };
    }
    await notifications.scheduleNotificationAsync({
      content: {
        title: t('leaderboard.dealClosedTitle'),
        body: t('leaderboard.dealClosedBody').replace('{repName}', repName),
        data: { repName },
      },
      trigger: null, // immediate — this is a "now" local notification, not a scheduled one.
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeError(error) };
  }
}

/**
 * Pure/DI'd core: subscribes to the rep's own scoped team topic on a private
 * Realtime channel. On every incoming `{ rep_name }` broadcast: invalidates
 * the leaderboard cache entry for `key` (unconditionally — the ranking is
 * stale regardless of whether the OS ends up surfacing a notification for
 * it) and dispatches the name-only local notification (fire-and-forget,
 * never throws). Returns an unsubscribe function.
 */
export function subscribeDealClosedBroadcast(
  realtime: RealtimeClient,
  notifications: NotificationsClient,
  cache: Pick<LeaderboardCache, 'invalidate'>,
  key: LeaderboardCacheKey,
  onDealClosed?: (repName: string) => void,
): () => void {
  const topic = dealClosedTopic(key.teamId);
  const channel = realtime.channel(topic, { config: { private: true } });

  channel
    .on('broadcast', { event: DEAL_CLOSED_EVENT }, (message) => {
      const repName = message.payload.record?.rep_name;
      if (!repName) return;
      cache.invalidate(key);
      void dispatchDealClosedNotification(notifications, repName);
      onDealClosed?.(repName);
    })
    .subscribe();

  return () => {
    void realtime.removeChannel(channel);
  };
}

function createDefaultRealtimeClient(): RealtimeClient {
  const supabase = getSupabase();
  return {
    channel: (topic, opts) => supabase.channel(topic, opts) as unknown as RealtimeChannelLike,
    removeChannel: (channel) => supabase.removeChannel(channel as never),
  };
}

export interface UseDealClosedBroadcastOptions {
  /** The rep's own selected team (LeaderboardScreen's `selectedTeamId`) —
   * pass `null` while no team is selected yet to skip subscribing entirely. */
  teamId: string | null;
  scope: LeaderboardCacheKey['scope'];
  period: LeaderboardCacheKey['period'];
  /** Called after cache invalidation + notification dispatch for every
   * received event, so the caller can trigger a live re-fetch of the
   * currently-displayed ranking. */
  onDealClosed?: (repName: string) => void;
  /** Injectable for tests; defaults to the real Supabase Realtime client. */
  realtime?: RealtimeClient;
  /** Injectable for tests; defaults to the real expo-notifications module. */
  notifications?: NotificationsClient;
  /** Injectable for tests; defaults to the real MMKV-backed leaderboard cache. */
  cache?: Pick<LeaderboardCache, 'invalidate'>;
}

/**
 * Reactive shell: subscribes while `teamId` is non-null (mirrors
 * useRoleScope's foreground/cancelled-guard useEffect shape), unsubscribes
 * on unmount or whenever `teamId`/`scope`/`period` changes — foreground-only,
 * no background listener (T-09-15, accepted).
 */
export function useDealClosedBroadcast({
  teamId,
  scope,
  period,
  onDealClosed,
  realtime,
  notifications,
  cache,
}: UseDealClosedBroadcastOptions): void {
  useEffect(() => {
    if (teamId === null) return;

    const realtimeClient = realtime ?? createDefaultRealtimeClient();
    const notificationsClient = notifications ?? Notifications;
    const cacheClient = cache ?? createLeaderboardCache();

    const unsubscribe = subscribeDealClosedBroadcast(
      realtimeClient,
      notificationsClient,
      cacheClient,
      { teamId, scope, period },
      onDealClosed,
    );

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, scope, period]);
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
