import { useEffect } from 'react';
import type { AbstractPowerSyncDatabase, SyncStatus } from '@powersync/common';
import { getSupabase } from '../../lib/auth/supabase';

/**
 * useMarkFirstSync — D-01/ONBD-02: the device's own one-shot "synced" signal.
 * A rep is not "functionally active" until activated (email confirmed) AND
 * first-sync-complete; this hook is what flips the latter. Iron Rule 1
 * governs the sales happy path only — this is a one-time control-plane ping
 * (mirrors useRoleScope's/useSessionIdentity's precedent of calling
 * getSupabase() directly for non-sales-data control-plane reads/writes), so
 * it calls `getSupabase().rpc('mark_first_sync_complete')` DIRECTLY, never
 * via the connector's upload path or CRUD transaction queue — this write
 * never touches the PowerSync CRUD upload queue.
 */

/** Structural slice of the PowerSync db handle attachMarkFirstSync depends on (injectable for tests). */
export type MarkFirstSyncDb = Pick<AbstractPowerSyncDatabase, 'currentStatus' | 'registerListener'>;

/**
 * Pure/DI'd core wiring (mirrors StatusSheet.tsx's writeHouseStatus pattern —
 * test the logic directly against a fake db/rpc, never render a component).
 * Registers a statusChanged listener and fires `callRpc()` exactly once, the
 * first time `hasSynced` is (or becomes) true — a `hasFired` closure guard
 * caps it at one call across every subsequent statusChanged event, including
 * ones already reporting `hasSynced: true`. Returns an unsubscribe function.
 */
export function attachMarkFirstSync(
  db: MarkFirstSyncDb,
  // supabase-js's .rpc() returns a thenable PostgrestFilterBuilder, not a
  // strict Promise — PromiseLike is the honest shared contract for both the
  // default and any injected test spy.
  callRpc: () => PromiseLike<unknown> = () => getSupabase().rpc('mark_first_sync_complete'),
): () => void {
  let hasFired = false;

  const fireIfSynced = (status: Pick<SyncStatus, 'hasSynced'> | undefined) => {
    if (hasFired) return;
    if (!status?.hasSynced) return;
    hasFired = true;
    void Promise.resolve(callRpc()).catch((err: unknown) => {
      // Swallowed: the server RPC is idempotent (guarded on
      // first_synced_at IS NULL, 0062_first_synced_at.sql), so a later
      // session retries harmlessly. Never surfaced to the UI.
      console.warn('[useMarkFirstSync] mark_first_sync_complete failed:', err);
    });
  };

  fireIfSynced(db.currentStatus);
  return db.registerListener({ statusChanged: fireIfSynced });
}

/**
 * Reactive shell: re-runs attachMarkFirstSync whenever the PowerSync db
 * handle (re)appears (mirrors MapScreen's boot() connect site — db starts
 * null and is set once openDatabase() resolves). `db` is null before boot;
 * the effect is a no-op until it materializes.
 */
export function useMarkFirstSync(db: AbstractPowerSyncDatabase | null): void {
  useEffect(() => {
    if (!db) return;
    return attachMarkFirstSync(db);
  }, [db]);
}
