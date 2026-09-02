import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canForcePurge,
  deriveWipeBadge,
  parseDeviceWipeOrderRow,
} from './useDeviceWipeOrders';

/**
 * Proves SEC-08/D-02/D-03's admin `useDeviceWipeOrders` data layer: the
 * four-state model (never a boolean), the `stall_reason` split whose two
 * causes need OPPOSITE operator responses, the operator+status-gated force
 * purge, writes going only through the two RPCs, and no client-side
 * ownership re-filter over an already RLS-scoped select.
 */

interface FakeCall {
  kind: 'select' | 'rpc';
  fn?: string;
  args?: unknown;
}

function makeFakeSupabase(
  options: { rows?: unknown[]; selectError?: Error | null; issueResult?: string; forceResult?: string } = {},
) {
  const calls: FakeCall[] = [];
  let rows = options.rows ?? [];
  const selectError = options.selectError ?? null;
  const issueResult = options.issueResult ?? 'queued';
  const forceResult = options.forceResult ?? 'forced';

  const supabase = {
    from(table: string) {
      calls.push({ kind: 'select', fn: table });
      return {
        select() {
          return {
            order() {
              return Promise.resolve(selectError ? { data: null, error: selectError } : { data: rows, error: null });
            },
          };
        },
      };
    },
    rpc(fn: string, args?: unknown) {
      calls.push({ kind: 'rpc', fn, args });
      if (fn === 'issue_device_wipe_order') {
        return Promise.resolve({ data: issueResult, error: null });
      }
      if (fn === 'force_purge_device_wipe_order') {
        return Promise.resolve({ data: forceResult, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };

  return {
    supabase,
    calls,
    setRows(next: unknown[]) {
      rows = next;
    },
  };
}

let currentFake: ReturnType<typeof makeFakeSupabase> = makeFakeSupabase();
let currentReps: unknown[] = [];

vi.mock('@/lib/supabase', () => ({ getSupabase: () => currentFake.supabase }));
vi.mock('@/features/reps/useReps', () => ({ useReps: () => ({ data: currentReps }) }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

afterEach(() => {
  currentFake = makeFakeSupabase();
  currentReps = [];
});

const repDirectory = new Map([
  ['rep-1', 'Alice Rep'],
  ['rep-2', 'Bob Rep'],
]);

describe('deriveWipeBadge', () => {
  it('queued -> neutral / wipe.statusQueued', () => {
    expect(deriveWipeBadge({ status: 'queued', stallReason: null })).toEqual({
      variant: 'neutral',
      copyKey: 'wipe.statusQueued',
    });
  });

  it('locked_draining -> invited / wipe.statusDraining', () => {
    expect(deriveWipeBadge({ status: 'locked_draining', stallReason: null })).toEqual({
      variant: 'invited',
      copyKey: 'wipe.statusDraining',
    });
  });

  it('locked_stalled with stallReason "queue" -> removed / wipe.statusStalled', () => {
    expect(deriveWipeBadge({ status: 'locked_stalled', stallReason: 'queue' })).toEqual({
      variant: 'removed',
      copyKey: 'wipe.statusStalled',
    });
  });

  it('locked_stalled with stallReason "unverified_path" -> SAME variant, DIFFERENT copy', () => {
    expect(deriveWipeBadge({ status: 'locked_stalled', stallReason: 'unverified_path' })).toEqual({
      variant: 'removed',
      copyKey: 'wipe.statusStalledUnverifiedPath',
    });
  });

  it('locked_stalled with a null stallReason falls back to the generic queue copy, never the unverified-path copy', () => {
    expect(deriveWipeBadge({ status: 'locked_stalled', stallReason: null })).toEqual({
      variant: 'removed',
      copyKey: 'wipe.statusStalled',
    });
  });

  it('locked_stalled with an unrecognized stallReason falls back to the generic queue copy', () => {
    expect(
      deriveWipeBadge({ status: 'locked_stalled', stallReason: 'bogus-reason' as never }),
    ).toEqual({ variant: 'removed', copyKey: 'wipe.statusStalled' });
  });

  it('purged_complete -> active / wipe.statusComplete', () => {
    expect(deriveWipeBadge({ status: 'purged_complete', stallReason: null })).toEqual({
      variant: 'active',
      copyKey: 'wipe.statusComplete',
    });
  });

  it('the five distinguishable presentations produce five distinct copyKeys', () => {
    const keys = [
      deriveWipeBadge({ status: 'queued', stallReason: null }).copyKey,
      deriveWipeBadge({ status: 'locked_draining', stallReason: null }).copyKey,
      deriveWipeBadge({ status: 'locked_stalled', stallReason: 'queue' }).copyKey,
      deriveWipeBadge({ status: 'locked_stalled', stallReason: 'unverified_path' }).copyKey,
      deriveWipeBadge({ status: 'purged_complete', stallReason: null }).copyKey,
    ];
    expect(new Set(keys).size).toBe(5);
  });

  it('an unrecognized status normalizes to queued/neutral, never to complete', () => {
    expect(deriveWipeBadge({ status: 'bogus-status' as never, stallReason: null })).toEqual({
      variant: 'neutral',
      copyKey: 'wipe.statusQueued',
    });
  });
});

describe('canForcePurge', () => {
  it('true for locked_draining and locked_stalled, operator role', () => {
    expect(canForcePurge({ status: 'locked_draining' }, 'operator')).toBe(true);
    expect(canForcePurge({ status: 'locked_stalled' }, 'operator')).toBe(true);
  });

  it('false for queued — nothing is locked yet, so there is nothing to force', () => {
    expect(canForcePurge({ status: 'queued' }, 'operator')).toBe(false);
  });

  it('false for purged_complete — already closed', () => {
    expect(canForcePurge({ status: 'purged_complete' }, 'operator')).toBe(false);
  });

  it('false for a non-operator role regardless of status', () => {
    expect(canForcePurge({ status: 'locked_draining' }, 'team_lead')).toBe(false);
    expect(canForcePurge({ status: 'locked_stalled' }, 'admin')).toBe(false);
  });
});

describe('parseDeviceWipeOrderRow', () => {
  it('parses a well-formed row, resolving the rep name from the directory', () => {
    const row = parseDeviceWipeOrderRow(
      {
        id: 'order-1',
        device_owner_rep_id: 'rep-1',
        device_id: 'device-abc',
        status: 'locked_draining',
        stall_reason: null,
        pending_artifact_count: 4,
        issued_at: '2026-08-10T10:00:00Z',
        last_progress_at: '2026-08-11T10:00:00Z',
        completed_at: null,
        forced_by: null,
        forced_at: null,
        forced_discarded_count: null,
      },
      repDirectory,
    );
    expect(row?.repName).toBe('Alice Rep');
    expect(row?.status).toBe('locked_draining');
    expect(row?.pendingArtifactCount).toBe(4);
  });

  it('drops a row missing id or device_owner_rep_id, rather than coercing it', () => {
    expect(parseDeviceWipeOrderRow({ device_owner_rep_id: 'rep-1', issued_at: 'x' }, repDirectory)).toBeNull();
    expect(parseDeviceWipeOrderRow({ id: 'order-1', issued_at: 'x' }, repDirectory)).toBeNull();
  });

  it('an unknown status normalizes to queued, never crashing or rendering as complete', () => {
    const row = parseDeviceWipeOrderRow(
      {
        id: 'order-1',
        device_owner_rep_id: 'rep-1',
        status: 'bogus',
        issued_at: '2026-08-10T10:00:00Z',
      },
      repDirectory,
    );
    expect(row?.status).toBe('queued');
  });

  it('an unknown stall_reason normalizes to null, never to unverified_path', () => {
    const row = parseDeviceWipeOrderRow(
      {
        id: 'order-1',
        device_owner_rep_id: 'rep-1',
        status: 'locked_stalled',
        stall_reason: 'something-else',
        issued_at: '2026-08-10T10:00:00Z',
      },
      repDirectory,
    );
    expect(row?.stallReason).toBeNull();
  });

  it('resolves forcedByName from the same rep directory', () => {
    const row = parseDeviceWipeOrderRow(
      {
        id: 'order-1',
        device_owner_rep_id: 'rep-1',
        status: 'purged_complete',
        issued_at: '2026-08-10T10:00:00Z',
        forced_by: 'rep-2',
        forced_at: '2026-08-12T10:00:00Z',
        forced_discarded_count: 3,
      },
      repDirectory,
    );
    expect(row?.forcedByName).toBe('Bob Rep');
    expect(row?.forcedDiscardedCount).toBe(3);
  });
});

describe('useDeviceWipeOrders', () => {
  it('lists rows from the RLS-scoped select with the rep name resolved from useReps, and issues no client-side ownership filter args', async () => {
    currentReps = [{ id: 'm1', userId: 'rep-1', name: 'Alice Rep' }];
    currentFake = makeFakeSupabase({
      rows: [
        {
          id: 'order-1',
          device_owner_rep_id: 'rep-1',
          device_id: null,
          status: 'queued',
          stall_reason: null,
          pending_artifact_count: 0,
          issued_at: '2026-08-10T10:00:00Z',
          last_progress_at: null,
          completed_at: null,
          forced_by: null,
          forced_at: null,
          forced_discarded_count: null,
        },
      ],
    });
    const { useDeviceWipeOrders } = await import('./useDeviceWipeOrders');
    const { result } = renderHook(() => useDeviceWipeOrders(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0]?.repName).toBe('Alice Rep');

    const selectCall = currentFake.calls.find((c) => c.kind === 'select');
    expect(selectCall?.args).toBeUndefined();
  });

  it('issue() calls issue_device_wipe_order and returns the discriminated verdict unchanged, including not_entitled', async () => {
    currentFake = makeFakeSupabase({ issueResult: 'not_entitled' });
    const { useDeviceWipeOrders } = await import('./useDeviceWipeOrders');
    const { result } = renderHook(() => useDeviceWipeOrders(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.issue('rep-1');
    });

    expect(outcome).toBe('not_entitled');
    const rpcCall = currentFake.calls.find((c) => c.kind === 'rpc' && c.fn === 'issue_device_wipe_order');
    expect(rpcCall?.args).toEqual({ p_rep_id: 'rep-1' });
  });

  it('forcePurge() calls force_purge_device_wipe_order with the order id and discarded count', async () => {
    currentFake = makeFakeSupabase({ forceResult: 'forced' });
    const { useDeviceWipeOrders } = await import('./useDeviceWipeOrders');
    const { result } = renderHook(() => useDeviceWipeOrders(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.forcePurge('order-1', 7);
    });

    expect(outcome).toBe('forced');
    const rpcCall = currentFake.calls.find(
      (c) => c.kind === 'rpc' && c.fn === 'force_purge_device_wipe_order',
    );
    expect(rpcCall?.args).toEqual({ p_order_id: 'order-1', p_discarded_count: 7 });
  });

  it('surfaces a select failure via error', async () => {
    currentFake = makeFakeSupabase({ selectError: new Error('network down') });
    const { useDeviceWipeOrders } = await import('./useDeviceWipeOrders');
    const { result } = renderHook(() => useDeviceWipeOrders(), { wrapper });

    await waitFor(() => expect(result.current.error).not.toBeNull());
  });
});
