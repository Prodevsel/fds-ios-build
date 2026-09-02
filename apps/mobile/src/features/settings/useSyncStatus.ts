import { useCallback, useEffect, useState } from 'react';
import type { AbstractPowerSyncDatabase } from '@powersync/common';

/**
 * Live local sync status for the Einstellungen SYNC block (design SSOT screen
 * 15) — the honest offline story (SYNC-01): how many writes are still waiting in
 * the PowerSync CRUD upload queue and when the last sync landed. A read-only
 * peek at `db.getCrudBatch` (never `.complete()`'d — that stays the connector's
 * job, mirrors ContractListScreen's pending-id derivation), re-evaluated on
 * every PowerSync `statusChanged`.
 *
 * `pendingCount` gates the "Abmelden" row (design: only possible once everything
 * is transferred) and drives the "Offline · N Vorgänge warten" line.
 */
export interface SyncStatus {
  pendingCount: number;
  lastSyncedAtIso: string | null;
  /** Re-read the queue + status immediately (a read-only peek). */
  refresh: () => void;
  /**
   * The honest "Jetzt synchronisieren" action: trigger a REAL reconnect via the
   * PowerSync client (which drains the CRUD upload queue on (re)connect), then
   * re-peek the queue. Falls back to a plain peek if the app has not connected
   * yet (no connector) — never a do-nothing button.
   */
  retryUpload: () => void;
}

/** Read `db.currentStatus.lastSyncedAt` defensively (shape varies across SDKs). */
function readLastSyncedAtIso(db: AbstractPowerSyncDatabase): string | null {
  const status = (db as { currentStatus?: { lastSyncedAt?: Date | null } }).currentStatus;
  const value = status?.lastSyncedAt ?? null;
  return value instanceof Date ? value.toISOString() : null;
}

export function useSyncStatus(db: AbstractPowerSyncDatabase): SyncStatus {
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncedAtIso, setLastSyncedAtIso] = useState<string | null>(null);

  const refresh = useCallback(() => {
    let cancelled = false;
    void (async () => {
      const batch = await db.getCrudBatch(1000);
      if (cancelled) return;
      setPendingCount(batch?.crud.length ?? 0);
      setLastSyncedAtIso(readLastSyncedAtIso(db));
    })();
    return () => {
      cancelled = true;
    };
  }, [db]);

  const retryUpload = useCallback(() => {
    // Iron Rule 1: PowerSync is the only network data path. Re-establishing the
    // connection with the connector the app already connected with makes the
    // client drain the CRUD upload queue — a real upload retry, not a queue
    // peek. `connect()` is not awaited (the UI stays responsive; failures surface
    // via the status listener → the sync line updates on its own).
    const connector = db.connector;
    if (connector) {
      void db.connect(connector).catch(() => {
        // Swallowed: a reconnect failure is reflected by the status listener
        // (pending count / last-sync line); nothing to do here but not throw.
      });
    }
    refresh();
  }, [db, refresh]);

  useEffect(() => {
    refresh();
    const unsubscribe = db.registerListener({ statusChanged: () => refresh() });
    return () => unsubscribe();
  }, [db, refresh]);

  return { pendingCount, lastSyncedAtIso, refresh, retryUpload };
}
