import { describe, expect, it, vi } from 'vitest';

// Node test environment: deletionRequestRepo.ts transitively imports
// getSupabase (lib/auth/supabase), which reaches into native modules — mock
// it so these tests never load the native react-native chain (mirrors
// sessionsRepo.test.ts/assignTerritory.test.ts's established pattern). Every
// test here injects its own fake `supabase`, so the mocked getSupabase is
// never actually invoked.
vi.mock('../../../lib/auth/supabase', () => ({ getSupabase: vi.fn() }));

import { createDeletionRequestRepo, type CreateDeletionRequestRepoOptions } from './deletionRequestRepo';
import { readFileSync } from 'node:fs';

function fakeSupabase(
  rpcImpl: (fn: string, args?: unknown) => Promise<{ data: unknown; error: unknown }>,
): NonNullable<CreateDeletionRequestRepoOptions['supabase']> {
  return { rpc: vi.fn(rpcImpl) as never };
}

describe('createDeletionRequestRepo', () => {
  it('submit(null) calling the RPC and receiving "recorded" resolves "recorded"', async () => {
    const rpc = vi.fn(async () => ({ data: 'recorded', error: null }));
    const { submit } = createDeletionRequestRepo({ supabase: { rpc: rpc as never } });

    await expect(submit(null)).resolves.toBe('recorded');
    expect(rpc).toHaveBeenCalledWith('request_account_deletion', { p_note: null });
  });

  it('receiving "already_pending" resolves "already_pending" — a normal outcome, never thrown', async () => {
    const supabase = fakeSupabase(async () => ({ data: 'already_pending', error: null }));
    const { submit } = createDeletionRequestRepo({ supabase });

    await expect(submit(null)).resolves.toBe('already_pending');
  });

  it('a transport/network failure resolves "offline", distinguishable from a server rejection', async () => {
    const supabase = fakeSupabase(async () => ({
      data: null,
      error: { message: 'Network request failed', status: undefined },
    }));
    const { submit } = createDeletionRequestRepo({ supabase });

    await expect(submit(null)).resolves.toBe('offline');
  });

  it('a thrown fetch rejection (e.g. offline device) also resolves "offline", never rejects', async () => {
    const supabase = fakeSupabase(async () => {
      throw new Error('Failed to fetch');
    });
    const { submit } = createDeletionRequestRepo({ supabase });

    await expect(submit(null)).resolves.toBe('offline');
  });

  it('any other server-side error resolves "error" and never "recorded"', async () => {
    const supabase = fakeSupabase(async () => ({
      data: null,
      error: { message: 'permission denied for function request_account_deletion', code: '42501' },
    }));
    const { submit } = createDeletionRequestRepo({ supabase });

    await expect(submit(null)).resolves.toBe('error');
  });

  it('an unrecognized discriminated value from the RPC resolves "error" rather than being trusted as "recorded"', async () => {
    const supabase = fakeSupabase(async () => ({ data: 'something-unexpected', error: null }));
    const { submit } = createDeletionRequestRepo({ supabase });

    await expect(submit(null)).resolves.toBe('error');
  });

  it('calls the RPC exactly once per submit() invocation', async () => {
    const rpc = vi.fn(async () => ({ data: 'recorded', error: null }));
    const { submit } = createDeletionRequestRepo({ supabase: { rpc: rpc as never } });

    await submit('a note');

    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('passes the note through as the RPC\'s only argument — never a user id, team id, or contract id', async () => {
    const rpc = vi.fn(async () => ({ data: 'recorded', error: null }));
    const { submit } = createDeletionRequestRepo({ supabase: { rpc: rpc as never } });

    await submit('please contact me first');

    expect(rpc).toHaveBeenCalledWith('request_account_deletion', { p_note: 'please contact me first' });
    const [, args] = (rpc.mock.calls[0] ?? []) as unknown as [string, Record<string, unknown>];
    expect(Object.keys(args)).toEqual(['p_note']);
  });

  it('the repo exposes only submit — no read, update, or delete method exists on the returned object', () => {
    const rpc = vi.fn(async () => ({ data: 'recorded', error: null }));
    const repo = createDeletionRequestRepo({ supabase: { rpc: rpc as never } });

    expect(Object.keys(repo)).toEqual(['submit']);
  });
});

describe('deletionRequestRepo.ts (source-level structural proofs)', () => {
  const source = readFileSync(
    new URL('./deletionRequestRepo.ts', import.meta.url),
    'utf-8',
  );

  it('never accesses the deletion_requests table directly — RPC only', () => {
    expect(source).not.toMatch(/from\(['"]deletion_requests['"]\)/);
  });

  it('the header comment states the § 257 HGB retention anchor and the "deletes nothing" fact', () => {
    expect(source).toContain('§ 257 HGB');
    expect(source).toContain('deletes nothing');
  });
});
