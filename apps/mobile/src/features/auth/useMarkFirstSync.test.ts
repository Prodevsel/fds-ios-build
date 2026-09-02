import { describe, expect, it, vi } from 'vitest';

// Node test environment: useMarkFirstSync transitively imports getSupabase
// (lib/auth/supabase), which reaches into native modules — mock it so these
// tests never load the native react-native chain (mirrors
// useRoleScope.test.ts's mocking pattern).
const { rpcSpy, getSupabaseMock } = vi.hoisted(() => {
  const rpcSpy = vi.fn(async () => ({ data: null, error: null }));
  const getSupabaseMock = vi.fn(() => ({ rpc: rpcSpy }));
  return { rpcSpy, getSupabaseMock };
});
vi.mock('../../lib/auth/supabase', () => ({ getSupabase: getSupabaseMock }));

import { attachMarkFirstSync, type MarkFirstSyncDb } from './useMarkFirstSync';
import type { SyncStatus } from '@powersync/common';

/** A fake PowerSync db: a mutable `currentStatus` + a registerListener that
 * records the callback so tests can fire statusChanged events manually. */
function fakeDb(initialHasSynced: boolean | undefined): {
  db: MarkFirstSyncDb;
  fireStatusChanged: (status: Pick<SyncStatus, 'hasSynced'>) => void;
} {
  let listener: ((status: Pick<SyncStatus, 'hasSynced'>) => void) | null = null;
  const db: MarkFirstSyncDb = {
    get currentStatus() {
      return { hasSynced: initialHasSynced } as SyncStatus;
    },
    registerListener(handlers) {
      listener = handlers.statusChanged as (status: Pick<SyncStatus, 'hasSynced'>) => void;
      return () => {
        listener = null;
      };
    },
  };
  return {
    db,
    fireStatusChanged: (status) => listener?.(status),
  };
}

describe('attachMarkFirstSync', () => {
  it('makes zero calls before first sync completes', () => {
    const spy = vi.fn(async () => undefined);
    const { db, fireStatusChanged } = fakeDb(false);
    attachMarkFirstSync(db, spy);

    fireStatusChanged({ hasSynced: false });
    fireStatusChanged({ hasSynced: undefined });

    expect(spy).not.toHaveBeenCalled();
  });

  it('calls exactly once on the first ready (hasSynced: true) event', () => {
    const spy = vi.fn(async () => undefined);
    const { db, fireStatusChanged } = fakeDb(false);
    attachMarkFirstSync(db, spy);

    fireStatusChanged({ hasSynced: true });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('fires immediately if currentStatus already reports hasSynced on attach', () => {
    const spy = vi.fn(async () => undefined);
    const { db } = fakeDb(true);
    attachMarkFirstSync(db, spy);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('never fires a second time on repeat ready events in the same session', () => {
    const spy = vi.fn(async () => undefined);
    const { db, fireStatusChanged } = fakeDb(false);
    attachMarkFirstSync(db, spy);

    fireStatusChanged({ hasSynced: true });
    fireStatusChanged({ hasSynced: true });
    fireStatusChanged({ hasSynced: true });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('swallows an RPC rejection instead of throwing into the caller', () => {
    const spy = vi.fn(async () => {
      throw new Error('network down');
    });
    const { db, fireStatusChanged } = fakeDb(false);
    expect(() => {
      attachMarkFirstSync(db, spy);
      fireStatusChanged({ hasSynced: true });
    }).not.toThrow();
  });

  it('defaults to calling supabase.rpc("mark_first_sync_complete") directly, not a connector path', () => {
    const { db, fireStatusChanged } = fakeDb(false);
    attachMarkFirstSync(db);

    fireStatusChanged({ hasSynced: true });

    expect(getSupabaseMock).toHaveBeenCalled();
    expect(rpcSpy).toHaveBeenCalledWith('mark_first_sync_complete');
  });
});
