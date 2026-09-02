import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Proves SEC-06/D-23's `useMySessions` admin data layer against a fake
 * Supabase client: it lists over the SAME two RPCs the mobile sibling
 * consumes (no service-role path, no client-side user-id re-filter), drops
 * malformed rows rather than guessing, and never claims a revoke ended
 * access before the server confirms it via a subsequent list refresh.
 */

interface FakeRpcCall {
  fn: string;
  args: unknown;
}

interface RawRow {
  id?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  user_agent?: unknown;
  ip?: unknown;
  refreshed_at?: unknown;
  not_after?: unknown;
  is_current?: unknown;
}

function makeFakeSupabase(options: {
  rows?: RawRow[];
  listError?: Error | null;
  revokeError?: Error | null;
} = {}) {
  const calls: FakeRpcCall[] = [];
  let rows = options.rows ?? [];
  const listError = options.listError ?? null;
  const revokeError = options.revokeError ?? null;

  const supabase = {
    rpc(fn: string, args?: unknown) {
      calls.push({ fn, args });
      if (fn === 'list_my_sessions') {
        return Promise.resolve(listError ? { data: null, error: listError } : { data: rows, error: null });
      }
      if (fn === 'revoke_my_session') {
        return Promise.resolve(revokeError ? { data: null, error: revokeError } : { data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };

  return {
    supabase,
    calls,
    setRows(next: RawRow[]) {
      rows = next;
    },
  };
}

let currentFake: ReturnType<typeof makeFakeSupabase> = makeFakeSupabase();

vi.mock('@/lib/supabase', () => ({ getSupabase: () => currentFake.supabase }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

afterEach(() => {
  currentFake = makeFakeSupabase();
});

const rowA: RawRow = {
  id: 's1',
  created_at: '2026-08-10T10:00:00Z',
  updated_at: '2026-08-14T09:00:00Z',
  user_agent: 'Mozilla/5.0 (Fixture)',
  ip: '203.0.113.9',
  refreshed_at: '2026-08-14T09:00:00Z',
  not_after: '2026-08-14T09:15:00Z',
  is_current: true,
};

const rowB: RawRow = {
  id: 's2',
  created_at: '2026-08-05T10:00:00Z',
  updated_at: '2026-08-12T09:00:00Z',
  user_agent: null,
  ip: null,
  refreshed_at: '2026-08-12T09:00:00Z',
  not_after: '2026-08-14T09:15:00Z',
  is_current: false,
};

/** The REAL-WORLD row shape (14-REVIEW CR-01): `auth.sessions.not_after` is
 *  NULL for every session this project creates (`[auth.sessions].timebox` is
 *  deliberately unset in supabase/config.toml) and `refreshed_at` is NULL
 *  until a session's first token refresh. Both are nullable columns; the
 *  fixtures above are the *lucky* shape, this one is the shipped one. */
const rowRealWorld: RawRow = {
  id: 's-real',
  created_at: '2026-08-14T08:59:00Z',
  updated_at: '2026-08-14T08:59:00Z',
  user_agent: 'Mozilla/5.0 (Fixture)',
  ip: '203.0.113.9',
  refreshed_at: null,
  not_after: null,
  is_current: true,
};

describe('useMySessions', () => {
  it('lists sessions in the RPC-provided (newest first) order, exposing loading then loaded state', async () => {
    currentFake = makeFakeSupabase({ rows: [rowA, rowB] });
    const { useMySessions } = await import('./useMySessions');
    const { result } = renderHook(() => useMySessions(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.sessions.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(result.current.isError).toBe(false);
  });

  it('parses a row with a null user_agent or ip cleanly', async () => {
    currentFake = makeFakeSupabase({ rows: [rowB] });
    const { useMySessions } = await import('./useMySessions');
    const { result } = renderHook(() => useMySessions(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.sessions[0]?.userAgent).toBeNull();
    expect(result.current.sessions[0]?.ip).toBeNull();
  });

  it('keeps a row whose not_after AND refreshed_at are null — the shape the live RPC actually returns', async () => {
    // REGRESSION (14-REVIEW CR-01): requiring these two nullable timestamps
    // dropped every real row, so the tab rendered `sessions.emptyBody` on a
    // working account.
    currentFake = makeFakeSupabase({ rows: [rowRealWorld] });
    const { useMySessions } = await import('./useMySessions');
    const { result } = renderHook(() => useMySessions(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.sessions.map((s) => s.id)).toEqual(['s-real']);
    expect(result.current.sessions[0]?.refreshedAt).toBeNull();
    expect(result.current.sessions[0]?.notAfter).toBeNull();
  });

  it('drops a row missing id or with a non-boolean is_current, rather than coercing it', async () => {
    currentFake = makeFakeSupabase({
      rows: [
        rowA,
        { ...rowB, id: undefined },
        { ...rowB, id: 's3', is_current: 'true' as unknown },
      ],
    });
    const { useMySessions } = await import('./useMySessions');
    const { result } = renderHook(() => useMySessions(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.sessions.map((s) => s.id)).toEqual(['s1']);
  });

  it('surfaces a list load failure via isError', async () => {
    currentFake = makeFakeSupabase({ listError: new Error('network down') });
    const { useMySessions } = await import('./useMySessions');
    const { result } = renderHook(() => useMySessions(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('revoke() marks the row revoking, and it stays visible (not removed) while the server still returns it', async () => {
    currentFake = makeFakeSupabase({ rows: [rowA, rowB] });
    const { useMySessions } = await import('./useMySessions');
    const { result } = renderHook(() => useMySessions(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.revoke('s1');
    });

    // Server still returns the row (15-minute latency window) — the hook
    // must not remove it itself; it stays present, flagged as revoking.
    expect(result.current.sessions.map((s) => s.id)).toContain('s1');
    expect(result.current.revokingIds.has('s1')).toBe(true);
    expect(result.current.revokeError).toBe(false);
  });

  it('a revoked row disappears only once the server stops returning it on refetch', async () => {
    currentFake = makeFakeSupabase({ rows: [rowA, rowB] });
    const { useMySessions } = await import('./useMySessions');
    const { result } = renderHook(() => useMySessions(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Simulate the server having genuinely dropped the row by the time this
    // revoke's own refetch runs.
    currentFake.setRows([rowB]);

    await act(async () => {
      await result.current.revoke('s1');
    });

    expect(result.current.sessions.map((s) => s.id)).toEqual(['s2']);
  });

  it('a failed revoke clears the revoking mark and surfaces revokeError, never leaving the row stuck', async () => {
    currentFake = makeFakeSupabase({ rows: [rowA, rowB], revokeError: new Error('offline') });
    const { useMySessions } = await import('./useMySessions');
    const { result } = renderHook(() => useMySessions(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.revoke('s1');
    });

    expect(result.current.revokingIds.has('s1')).toBe(false);
    expect(result.current.revokeError).toBe(true);
    expect(result.current.sessions.map((s) => s.id)).toContain('s1');
  });

  it('never re-filters by a client-side user id — both RPCs are called with only the arguments they need', async () => {
    currentFake = makeFakeSupabase({ rows: [rowA] });
    const { useMySessions } = await import('./useMySessions');
    const { result } = renderHook(() => useMySessions(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.revoke('s1');
    });

    const listCall = currentFake.calls.find((c) => c.fn === 'list_my_sessions');
    const revokeCall = currentFake.calls.find((c) => c.fn === 'revoke_my_session');
    expect(listCall?.args).toBeUndefined();
    expect(revokeCall?.args).toEqual({ p_session_id: 's1' });
  });
});
