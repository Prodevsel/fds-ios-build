import { describe, expect, it, vi } from 'vitest';

// Node test environment: sessionsRepo.ts transitively imports getSupabase
// (lib/auth/supabase), which reaches into native modules — mock it so these
// tests never load the native react-native chain (mirrors
// assignTerritory.test.ts's mocking pattern). Every test here injects its
// own fake `supabase`, so the mocked getSupabase is never actually invoked.
vi.mock('../../../lib/auth/supabase', () => ({ getSupabase: vi.fn() }));

import { createSessionsRepo, parseSessionRow, type CreateSessionsRepoOptions } from './sessionsRepo';

function fakeSupabase(
  rpcImpl: (fn: string, args?: unknown) => Promise<{ data: unknown; error: unknown }>,
): NonNullable<CreateSessionsRepoOptions['supabase']> {
  return { rpc: vi.fn(rpcImpl) as never };
}

const RAW_ROW = {
  id: 'session-1',
  created_at: '2026-08-01T10:00:00Z',
  updated_at: '2026-08-01T10:05:00Z',
  user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)',
  ip: '203.0.113.9',
  refreshed_at: '2026-08-01T10:05:00Z',
  not_after: '2026-08-08T10:00:00Z',
  is_current: true,
};

describe('parseSessionRow (pure, no network)', () => {
  it('parses a well-formed row into camelCase SessionRow', () => {
    expect(parseSessionRow(RAW_ROW)).toEqual({
      id: 'session-1',
      createdAt: '2026-08-01T10:00:00Z',
      updatedAt: '2026-08-01T10:05:00Z',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)',
      ip: '203.0.113.9',
      refreshedAt: '2026-08-01T10:05:00Z',
      notAfter: '2026-08-08T10:00:00Z',
      isCurrent: true,
    });
  });

  it('parses successfully with a null user_agent (nullable in the live schema)', () => {
    const row = parseSessionRow({ ...RAW_ROW, user_agent: null });
    expect(row).not.toBeNull();
    expect(row?.userAgent).toBeNull();
  });

  it('parses successfully with a null ip (nullable in the live schema)', () => {
    const row = parseSessionRow({ ...RAW_ROW, ip: null });
    expect(row).not.toBeNull();
    expect(row?.ip).toBeNull();
  });

  it('drops a row missing id, rather than guessing', () => {
    const { id, ...rest } = RAW_ROW;
    expect(parseSessionRow(rest)).toBeNull();
  });

  it('drops a row with a non-boolean is_current, rather than coercing', () => {
    expect(parseSessionRow({ ...RAW_ROW, is_current: 'true' })).toBeNull();
    expect(parseSessionRow({ ...RAW_ROW, is_current: null })).toBeNull();
  });

  // REGRESSION (14-REVIEW CR-01): both timestamps are NULLABLE on
  // auth.sessions. GoTrue leaves not_after NULL for EVERY session unless
  // `[auth.sessions].timebox` is configured (it is deliberately unset in
  // supabase/config.toml), and refreshed_at NULL until a session's first
  // token refresh. Requiring either dropped every real row and rendered a
  // plausible-looking "no sessions" empty state on a working account.
  it('parses the real-world row shape — not_after AND refreshed_at both null (no timebox configured, no refresh yet)', () => {
    const row = parseSessionRow({ ...RAW_ROW, not_after: null, refreshed_at: null });
    expect(row).not.toBeNull();
    expect(row?.notAfter).toBeNull();
    expect(row?.refreshedAt).toBeNull();
    expect(row?.id).toBe('session-1');
  });

  it('parses a row with the timestamp keys entirely absent, rather than dropping it', () => {
    const { refreshed_at, not_after, ...rest } = RAW_ROW;
    const row = parseSessionRow(rest);
    expect(row).not.toBeNull();
    expect(row?.refreshedAt).toBeNull();
    expect(row?.notAfter).toBeNull();
  });
});

describe('createSessionsRepo', () => {
  it('listSessions() calls rpc("list_my_sessions") and returns parsed rows in RPC order', async () => {
    const rpc = vi.fn(async () => ({ data: [RAW_ROW, { ...RAW_ROW, id: 'session-2', is_current: false }], error: null }));
    const { listSessions } = createSessionsRepo({ supabase: { rpc: rpc as never } });

    const rows = await listSessions();

    expect(rpc).toHaveBeenCalledWith('list_my_sessions');
    expect(rows.map((r) => r.id)).toEqual(['session-1', 'session-2']);
  });

  it('listSessions() drops malformed rows rather than guessing, keeping well-formed ones', async () => {
    const supabase = fakeSupabase(async () => ({
      data: [RAW_ROW, { ...RAW_ROW, id: undefined }],
      error: null,
    }));
    const { listSessions } = createSessionsRepo({ supabase });

    const rows = await listSessions();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('session-1');
  });

  it('listSessions() returns the real-world rows (null not_after/refreshed_at), never an empty list', async () => {
    // REGRESSION (14-REVIEW CR-01): this is the exact shape the live RPC
    // returns under this project's config. Before the fix every row was
    // dropped here and the screen rendered `sessions.emptyHeading`.
    const supabase = fakeSupabase(async () => ({
      data: [
        { ...RAW_ROW, not_after: null, refreshed_at: null },
        { ...RAW_ROW, id: 'session-2', is_current: false, not_after: null, refreshed_at: null },
      ],
      error: null,
    }));
    const { listSessions } = createSessionsRepo({ supabase });

    const rows = await listSessions();

    expect(rows.map((r) => r.id)).toEqual(['session-1', 'session-2']);
  });

  it('listSessions() throws on a transport error', async () => {
    const supabase = fakeSupabase(async () => ({ data: null, error: new Error('network down') }));
    const { listSessions } = createSessionsRepo({ supabase });

    await expect(listSessions()).rejects.toThrow('network down');
  });

  it('revokeSession(id) calls rpc("revoke_my_session", { p_session_id }) and resolves on success', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const { revokeSession } = createSessionsRepo({ supabase: { rpc: rpc as never } });

    await expect(revokeSession('session-1')).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('revoke_my_session', { p_session_id: 'session-1' });
  });

  it('revokeSession(id) rejects with a classified error on a network failure', async () => {
    const supabase = fakeSupabase(async () => ({ data: null, error: new Error('network down') }));
    const { revokeSession } = createSessionsRepo({ supabase });

    await expect(revokeSession('session-1')).rejects.toThrow('network down');
  });

  it('resolving revokeSession does NOT prove the session was the caller\'s — the RPC is a silent no-op for someone else\'s id, documented in the file header, not re-checked client-side', async () => {
    // The repo has no way to distinguish "revoked mine" from "silent no-op on
    // someone else's id" — both resolve identically. This test asserts the
    // repo does not attempt (and cannot attempt) to fake that distinction.
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const { revokeSession } = createSessionsRepo({ supabase: { rpc: rpc as never } });

    await expect(revokeSession('not-mine')).resolves.toBeUndefined();
  });
});
