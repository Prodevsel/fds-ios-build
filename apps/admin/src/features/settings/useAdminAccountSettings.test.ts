import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Proves the SET-09/D-12 read-then-branch data layer: `useAdminAccountSettings`
 * reads own-row `app_users.full_name` + `user_settings.language`, and
 * `useSaveAdminAccountSettings` branches to `update()` when a `user_settings`
 * row already exists and `insert()` when it does not — mirroring
 * `useLeaderboardConfig.ts`'s `useSaveLeaderboardConfig` idiom verbatim, and
 * NEVER calling `upsert`.
 */

const mocks = vi.hoisted(() => ({
  session: { session: { user: { id: 'user-1', email: 'operator@fixture.test' } }, role: 'operator', loading: false },
}));

vi.mock('@/lib/auth/useSession', () => ({ useSession: () => mocks.session }));

interface FakeCall {
  table: string;
  op: 'select' | 'update' | 'insert';
  payload?: unknown;
}

function makeFakeSupabase(options: {
  fullName?: string | null;
  userSettingsRow?: { id: string; language: string } | null;
  failUpdate?: boolean;
  failInsert?: boolean;
} = {}) {
  const calls: FakeCall[] = [];
  const fullName = options.fullName ?? 'Alice Operator';
  const userSettingsRow = options.userSettingsRow === undefined ? null : options.userSettingsRow;

  const supabase = {
    from(table: string) {
      return {
        select(_cols: string) {
          calls.push({ table, op: 'select' });
          return {
            eq(_col: string, _val: string) {
              return {
                async maybeSingle() {
                  if (table === 'app_users') {
                    return { data: { full_name: fullName }, error: null };
                  }
                  if (table === 'user_settings') {
                    return { data: userSettingsRow, error: null };
                  }
                  return { data: null, error: null };
                },
              };
            },
          };
        },
        update(payload: unknown) {
          calls.push({ table, op: 'update', payload });
          return {
            eq: async (_col: string, _val: string) =>
              options.failUpdate ? { error: new Error('update failed') } : { error: null },
          };
        },
        insert(payload: unknown) {
          calls.push({ table, op: 'insert', payload });
          return (async () =>
            options.failInsert ? { error: new Error('insert failed') } : { error: null })();
        },
      };
    },
  };

  return { supabase, calls };
}

let currentFake: ReturnType<typeof makeFakeSupabase> = makeFakeSupabase();

vi.mock('@/lib/supabase', () => ({ getSupabase: () => currentFake.supabase }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

afterEach(() => {
  mocks.session = {
    session: { user: { id: 'user-1', email: 'operator@fixture.test' } },
    role: 'operator',
    loading: false,
  };
  currentFake = makeFakeSupabase();
});

describe('useAdminAccountSettings', () => {
  it('reads app_users.full_name and user_settings.language for the signed-in user', async () => {
    currentFake = makeFakeSupabase({
      fullName: 'Alice Operator',
      userSettingsRow: { id: 'user-1', language: 'de' },
    });
    const { useAdminAccountSettings } = await import('./useAdminAccountSettings');
    const { result } = renderHook(() => useAdminAccountSettings(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ fullName: 'Alice Operator', language: 'de' });
  });

  it('defaults language to "de" when no user_settings row exists yet', async () => {
    currentFake = makeFakeSupabase({ fullName: 'Alice Operator', userSettingsRow: null });
    const { useAdminAccountSettings } = await import('./useAdminAccountSettings');
    const { result } = renderHook(() => useAdminAccountSettings(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ fullName: 'Alice Operator', language: 'de' });
  });
});

describe('useSaveAdminAccountSettings', () => {
  it('updates an existing user_settings row (never upsert)', async () => {
    currentFake = makeFakeSupabase({ userSettingsRow: { id: 'user-1', language: 'de' } });
    const { useSaveAdminAccountSettings } = await import('./useAdminAccountSettings');
    const { result } = renderHook(() => useSaveAdminAccountSettings(), { wrapper });

    result.current.mutate({ fullName: 'Alice New Name', language: 'en' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const settingsCalls = currentFake.calls.filter((c) => c.table === 'user_settings');
    expect(settingsCalls.some((c) => c.op === 'update')).toBe(true);
    expect(settingsCalls.some((c) => c.op === 'insert')).toBe(false);

    const appUsersUpdate = currentFake.calls.find((c) => c.table === 'app_users' && c.op === 'update');
    expect(appUsersUpdate?.payload).toMatchObject({ full_name: 'Alice New Name' });
  });

  it('inserts a new user_settings row when none exists (never upsert)', async () => {
    currentFake = makeFakeSupabase({ userSettingsRow: null });
    const { useSaveAdminAccountSettings } = await import('./useAdminAccountSettings');
    const { result } = renderHook(() => useSaveAdminAccountSettings(), { wrapper });

    result.current.mutate({ fullName: 'Alice New Name', language: 'en' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const settingsCalls = currentFake.calls.filter((c) => c.table === 'user_settings');
    expect(settingsCalls.some((c) => c.op === 'insert')).toBe(true);
    expect(settingsCalls.some((c) => c.op === 'update')).toBe(false);
    const insertCall = settingsCalls.find((c) => c.op === 'insert');
    expect(insertCall?.payload).toMatchObject({ id: 'user-1', language: 'en' });
  });

  it('propagates a save error and never silently succeeds', async () => {
    currentFake = makeFakeSupabase({ userSettingsRow: { id: 'user-1', language: 'de' }, failUpdate: true });
    const { useSaveAdminAccountSettings } = await import('./useAdminAccountSettings');
    const { result } = renderHook(() => useSaveAdminAccountSettings(), { wrapper });

    result.current.mutate({ fullName: 'Alice New Name', language: 'en' });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
