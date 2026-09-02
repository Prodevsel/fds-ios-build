import type { AbstractPowerSyncDatabase } from '@powersync/common';
import { getSupabase } from '../../../lib/auth/supabase';
import { getDeviceIdDefault } from '../../../lib/device/getDeviceId';
import { createSessionsRepo } from '../../settings/db/sessionsRepo';
import { createDefaultWipeDeps, runDrainThenPurge, type WipePhase } from './wipeMachinery';

/**
 * remoteWipeConnector.ts — SEC-08's device half (D-01/D-02/D-04), closing the
 * remote-wipe honesty contract 15-03 (server) and 15-10 (shared machinery)
 * built for. On the next connect after an org-admin issues a
 * `device_wipe_orders` row, this module honors it in TWO STRICTLY ORDERED
 * stages, never collapsed into one:
 *
 *   1. LOCK (the security guarantee, D-01): unconditional, on first sight of
 *      any non-`purged_complete` order, regardless of the pending-artifact
 *      count. `lock('remote-wipe')` fires, then `revokeAllSessions()` — in
 *      that exact order, before any network report is even attempted. This
 *      never waits on connectivity quality, a queue check, or a report
 *      acknowledgement (`attachRemoteWipeConnector`'s call-order tests below
 *      assert this literally).
 *   2. PURGE (the § 257 HGB / § 147 AO retention anchor, 15-CONTEXT.md): runs
 *      ONLY once the real pending-artifact queue reaches zero, via
 *      `wipeMachinery.runDrainThenPurge('remote', ...)` (D-04: one
 *      implementation, three entry points — this module reimplements no part
 *      of the purge itself, only decides WHEN to call it).
 *
 * D-02's single worst outcome — a silent success on a device still holding
 * an unsynced signed contract — is why the pending count is reported
 * VERBATIM on every progress report, including a genuine `0`, and why
 * `'purged_complete'` is NEVER reported alongside a non-zero count from this
 * module (the server also independently refuses that claim, migration 0080).
 *
 * D-03's destructive escape hatch (force-purge, discarding unsynced items on
 * a device that will never reconnect) is admin-side only — no code path in
 * this module ever discards an unsynced item; it only ever locks, waits, and
 * reports the truth.
 */

export type WipeStatus = 'queued' | 'locked_draining' | 'locked_stalled' | 'purged_complete';

export interface RemoteWipeOrder {
  id: string;
  status: WipeStatus;
  pendingArtifactCount: number;
}

export type RemoteWipeAction =
  | { kind: 'none' }
  | { kind: 'lock-and-report' } // order seen for the first time, or still draining
  | { kind: 'purge' } // queue at zero, locked already
  | { kind: 'already-complete' };

/**
 * A locked_stalled report's ROOT CAUSE (migration 0080's bidirectionally
 * validated `stall_reason` column, T-15-03-11) — never a null/guessed value.
 */
export type StallReason = 'queue' | 'unverified_path';

export interface RemoteWipeDeps {
  watchOrder(cb: (order: RemoteWipeOrder | null) => void): () => void;
  getUploadQueueStats(): Promise<{ count: number; size: number | null }>;
  lock(reason: 'remote-wipe'): void;
  revokeAllSessions(): Promise<void>;
  /**
   * `stallReason` is REQUIRED whenever `status === 'locked_stalled'` and
   * forbidden otherwise (mirrors `report_wipe_progress`'s own 22023 guard,
   * migration 0080) — the published 15-11-PLAN.md interface block omitted
   * this 4th parameter even though its own `<behavior>` section mandates it
   * on every `locked_stalled` report; added here as a Rule 1 fix (see this
   * plan's SUMMARY "Deviations" section) rather than silently dropping the
   * cause the admin needs to act correctly (T-15-11-09).
   */
  reportProgress(
    deviceId: string,
    status: WipeStatus,
    pendingCount: number,
    stallReason?: StallReason,
  ): Promise<'recorded' | 'no_order'>;
  getDeviceId(): Promise<string>;
  runPurge(): Promise<WipePhase>; // wipeMachinery.runDrainThenPurge('remote', ...)
}

/**
 * Pure: the entire D-01 rule, three explicit parameters so it is testable
 * without PowerSync or a real order. `alreadyLocked` is tracked by the
 * CALLER (`attachRemoteWipeConnector`'s own module-local state) — this
 * function has no knowledge of `AppLockProvider`'s React state at all.
 *
 * - `null` order → nothing to do.
 * - `'purged_complete'` → terminal, NEVER re-purged (D-02's completion is a
 *   one-way state, matching `report_wipe_progress`'s own `status <>
 *   'purged_complete'` UPDATE predicate, migration 0080).
 * - Not yet locked → ALWAYS `lock-and-report`, regardless of `pendingCount`
 *   — even a `0` count on first sight locks before it would ever purge
 *   (D-01: the lock is never skipped as an optimization).
 * - Already locked, queue non-empty → `lock-and-report` (report the new
 *   count; still draining).
 * - Already locked, queue empty → `purge`.
 */
export function deriveRemoteWipeAction(
  order: RemoteWipeOrder | null,
  pendingCount: number,
  alreadyLocked: boolean,
): RemoteWipeAction {
  if (!order) return { kind: 'none' };
  if (order.status === 'purged_complete') return { kind: 'already-complete' };
  if (!alreadyLocked) return { kind: 'lock-and-report' };
  if (pendingCount > 0) return { kind: 'lock-and-report' };
  return { kind: 'purge' };
}

/**
 * Drives a synced `device_wipe_orders` row through D-01's two stages,
 * reporting the truth at every step. Every side effect is injected
 * (`RemoteWipeDeps`, options-object DI, `createAssignTerritory` precedent) —
 * this function itself touches no native module and no live table directly.
 *
 * `alreadyLocked`/`unverifiedPathBlocked` are module-local closure state for
 * THIS attached connector instance (a fresh `attachRemoteWipeConnector` call
 * — e.g. a new app session — starts both `false` again; that is correct,
 * since a fresh session's `AppLockProvider` also starts unlocked/idle-locked
 * and must re-observe the synced order to re-derive its own lock).
 */
export function attachRemoteWipeConnector(deps: RemoteWipeDeps): () => void {
  let alreadyLocked = false;
  // T-15-11: once wipeMachinery reports `blocked-unverified-path`, retrying
  // the purge changes nothing until plan 15-01's probe resolves the real
  // path on a real device — never call the purge routine again this session.
  let unverifiedPathBlocked = false;

  async function handleOrder(order: RemoteWipeOrder | null): Promise<void> {
    try {
      if (!order || order.status === 'purged_complete') return;

      const stats = await deps.getUploadQueueStats();
      const action = deriveRemoteWipeAction(order, stats.count, alreadyLocked);

      if (action.kind === 'none' || action.kind === 'already-complete') return;

      if (action.kind === 'lock-and-report') {
        if (!alreadyLocked) {
          // D-01: unconditional, synchronous, before any await — the lock
          // does not wait on network success, a queue check, or a report
          // acknowledgement. Set the local flag immediately so a concurrent
          // watch tick during the awaits below can never call lock() twice
          // or skip the one-time session revocation.
          deps.lock('remote-wipe');
          alreadyLocked = true;
          await deps.revokeAllSessions();
        }
        const deviceId = await deps.getDeviceId();
        // A `reportProgress` rejection or 'no_order' result does NOT undo or
        // skip the lock above — the lock is irreversible once entered
        // (caught by this function's own outer try/catch).
        await deps.reportProgress(deviceId, 'locked_draining', stats.count);
        return;
      }

      // action.kind === 'purge'
      if (unverifiedPathBlocked) return;

      const result = await deps.runPurge();
      const deviceId = await deps.getDeviceId();

      if (result.kind === 'complete') {
        // D-02: the ONLY call site in this module allowed to report
        // 'purged_complete', and always with a literal 0 — never a variable
        // that could drift non-zero.
        await deps.reportProgress(deviceId, 'purged_complete', 0);
        return;
      }

      if (result.kind === 'blocked-unverified-path') {
        unverifiedPathBlocked = true;
        // `stats.count` above is the TRUTHFUL live count already read this
        // tick — the path gate fires BEFORE the shared purge machinery ever
        // reads the queue itself (see wipeMachinery.ts's own gate order), so
        // this is commonly and legitimately `0`. Reported verbatim, never
        // suppressed, never fabricated non-zero to make the stall "look"
        // queue-shaped (T-15-11-10) — the cause travels in `stallReason`,
        // not the count (T-15-11-09).
        await deps.reportProgress(deviceId, 'locked_stalled', stats.count, 'unverified_path');
        return;
      }

      if (result.kind === 'blocked') {
        // Race: the queue grew again between this tick's own read and the
        // shared purge machinery's own internal re-check — report the FRESH
        // count from that re-check, cause 'queue' (never conflated with the
        // unverified-path cause above).
        await deps.reportProgress(deviceId, 'locked_stalled', result.pendingCount, 'queue');
        return;
      }

      // result.kind === 'failed' — a genuine I/O error during the purge
      // itself (e.g. a file deletion failure). Not `'purged_complete'`
      // (never), and not representable as a `locked_stalled` cause either:
      // `stallReason` is constrained to `'queue' | 'unverified_path'`
      // (migration 0080's CHECK), neither of which is true here — inventing
      // one would misdirect the admin exactly as T-15-11-09 forbids. No
      // report is sent; the order stays at its last truthfully-reported
      // state and the purge is retried on the NEXT watch tick, unlike the
      // unverified-path case above (a transient I/O failure, unlike a static
      // unconfirmed path, may well succeed on retry).
    } catch {
      // No downstream failure (revokeAllSessions, reportProgress, runPurge,
      // getDeviceId, getUploadQueueStats) may ever propagate unhandled here
      // — D-01: entering the lock is irreversible regardless of any
      // network/report failure afterward.
    }
  }

  return deps.watchOrder((order) => {
    void handleOrder(order);
  });
}

// ---------------------------------------------------------------------------
// Production wiring — mirrors wipeMachinery.ts's own
// createDefaultWipeDeps(onPhase) shape (factory, not a module-scope
// constant, so nothing native/network resolves at import time).
// ---------------------------------------------------------------------------

interface RawDeviceWipeOrderRow {
  id: string;
  status: string;
  pending_artifact_count: string | null;
}

function isWipeStatus(value: string): value is WipeStatus {
  return (
    value === 'queued' ||
    value === 'locked_draining' ||
    value === 'locked_stalled' ||
    value === 'purged_complete'
  );
}

/**
 * Pure parser mirroring `settingsPolicyRepo.ts`'s `parsePolicyRow` "drop
 * rather than guess" convention — an unrecognized `status` value is dropped
 * (treated as no order), never coerced to a guessed one.
 */
export function parseRemoteWipeOrderRow(row: RawDeviceWipeOrderRow | undefined): RemoteWipeOrder | null {
  if (!row) return null;
  if (!isWipeStatus(row.status)) return null;
  const parsedCount = row.pending_artifact_count != null ? Number(row.pending_artifact_count) : 0;
  return {
    id: row.id,
    status: row.status,
    pendingArtifactCount: Number.isFinite(parsedCount) ? parsedCount : 0,
  };
}

// Deliberately WITHOUT a WHERE clause naming the rep — this table's
// PowerSync stream (15-03, powersync/sync-streams.yaml) is ALREADY
// row-filtered to exactly the rows RLS would allow this rep to read
// (settingsPolicyRepo.ts precedent for the same reasoning). The
// `status != 'purged_complete'` filter here is a PRESENTATION choice (which
// row is the CURRENT order), never an authorization one — a completed order
// row stays in the synced mirror, just not selected by this query.
const REMOTE_WIPE_ORDER_SELECT_SQL =
  "SELECT id, status, pending_artifact_count FROM device_wipe_orders WHERE status != 'purged_complete' ORDER BY issued_at DESC LIMIT 1";

/**
 * Read-only watch factory (mirrors `settingsPolicyRepo.ts`'s
 * `watchPolicies` — `AbortController` cleanup, no direct network call, no
 * polling loop). This is the ONLY way this module reads order state; the
 * mirror this table lands in stays read-only end to end — the sole write
 * path is the `report_wipe_progress` RPC below (this module never writes a
 * row to this table directly; see the header comment's D-01/D-02 framing and
 * `connector.ts`'s own rejection of any client-originated write to it).
 */
export function createRemoteWipeOrderWatch(
  db: Pick<AbstractPowerSyncDatabase, 'watch'>,
): RemoteWipeDeps['watchOrder'] {
  return (cb) => {
    const controller = new AbortController();
    db.watch(
      REMOTE_WIPE_ORDER_SELECT_SQL,
      [],
      {
        onResult: (result) => {
          const rows = (result.rows?._array ?? []) as RawDeviceWipeOrderRow[];
          cb(parseRemoteWipeOrderRow(rows[0]));
        },
        onError: () => cb(null),
      },
      { signal: controller.signal },
    );
    return () => controller.abort();
  };
}

export interface CreateDefaultRemoteWipeDepsOptions {
  /** The already-open PowerSync database singleton (`useSessionDb()`/`openDatabase()` — never a second, independently-opened handle). */
  db: Pick<AbstractPowerSyncDatabase, 'watch' | 'getUploadQueueStats'>;
  /** `AppLockProvider`'s own `lock` — this module never constructs its own lock state. */
  lock: (reason: 'remote-wipe') => void;
}

/**
 * Real dependency wiring for `attachRemoteWipeConnector`. `revokeAllSessions`
 * reuses `sessionsRepo.ts` — the SAME `list_my_sessions`/`revoke_my_session`
 * RPCs `SessionsScreen.tsx` calls, never a second session-revocation call
 * site — but revokes EVERY session on the account, not only the current one:
 * a remote-wipe order targets a device that may be lost or stolen, so the
 * correct response is broader than the single-current-session revoke
 * `SessionsScreen.tsx` itself offers a rep.
 */
export function createDefaultRemoteWipeDeps(options: CreateDefaultRemoteWipeDepsOptions): RemoteWipeDeps {
  const { db, lock } = options;
  const sessionsRepo = createSessionsRepo();

  return {
    watchOrder: createRemoteWipeOrderWatch(db),
    async getUploadQueueStats() {
      return db.getUploadQueueStats();
    },
    lock,
    async revokeAllSessions() {
      const sessions = await sessionsRepo.listSessions();
      await Promise.all(sessions.map((session) => sessionsRepo.revokeSession(session.id)));
    },
    async reportProgress(deviceId, status, pendingCount, stallReason) {
      const { data, error } = await getSupabase().rpc('report_wipe_progress', {
        p_device_id: deviceId,
        p_status: status,
        p_pending_count: pendingCount,
        p_stall_reason: stallReason ?? null,
      });
      if (error) throw error;
      return data as 'recorded' | 'no_order';
    },
    async getDeviceId() {
      const result = await getDeviceIdDefault();
      return result.deviceId;
    },
    async runPurge() {
      // D-04: the SAME shared machinery every wipe entry point drives —
      // this module reimplements no part of the purge sequence itself, only
      // decides WHEN (post-drain) to call it, per the § 257 HGB / § 147 AO
      // retention anchor (15-CONTEXT.md).
      return runDrainThenPurge('remote', createDefaultWipeDeps());
    },
  };
}
