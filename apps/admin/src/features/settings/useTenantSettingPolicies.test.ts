import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Proves the SET-07/SET-08 admin-half data layer: `useTenantSettingPolicies`
 * reads ALL of the tenant's policy rows (not `.maybeSingle()`, this table
 * has one row per `setting_key`), and `useSaveTenantSettingPolicy` branches
 * to `update()` when a row for that key already exists and `insert()` when
 * it does not — mirroring `useLeaderboardConfig.ts`'s read-then-branch idiom
 * verbatim, and NEVER calling `upsert`. Also proves the local D-04 ceiling
 * guard throws before any Supabase call for a non-ceilingable key.
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
  salesOrgId?: string | null;
  policyRows?: Array<{ id: string; setting_key: string; policy_kind: string; policy_value: unknown }>;
  failUpdate?: boolean;
  failInsert?: boolean;
} = {}) {
  const calls: FakeCall[] = [];
  const salesOrgId = options.salesOrgId === undefined ? 'org-1' : options.salesOrgId;
  const policyRows = options.policyRows ?? [];

  const supabase = {
    from(table: string) {
      return {
        select(_cols: string) {
          calls.push({ table, op: 'select' });
          if (table === 'org_admins') {
            return {
              eq(_col: string, _val: string) {
                return {
                  limit(_n: number) {
                    return {
                      async maybeSingle() {
                        return { data: salesOrgId ? { sales_org_id: salesOrgId } : null, error: null };
                      },
                    };
                  },
                };
              },
            };
          }
          // tenant_setting_policies: select('*...').eq('sales_org_id', id) -- returns ALL rows, no maybeSingle.
          return {
            eq(_col: string, _val: string) {
              return Promise.resolve({ data: policyRows, error: null });
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

describe('useOwnSalesOrgId', () => {
  it('resolves the signed-in operator sales_org_id via org_admins', async () => {
    currentFake = makeFakeSupabase({ salesOrgId: 'org-42' });
    const { useOwnSalesOrgId } = await import('./useTenantSettingPolicies');
    const { result } = renderHook(() => useOwnSalesOrgId(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe('org-42');
  });
});

describe('useTenantSettingPolicies', () => {
  it('reads ALL policy rows for the tenant and indexes them by setting_key (not maybeSingle)', async () => {
    currentFake = makeFakeSupabase({
      policyRows: [
        { id: 'p-1', setting_key: 'auto_lock_timeout_minutes', policy_kind: 'ceiling', policy_value: 15 },
      ],
    });
    const { useTenantSettingPolicies } = await import('./useTenantSettingPolicies');
    const { result } = renderHook(() => useTenantSettingPolicies('org-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      auto_lock_timeout_minutes: { id: 'p-1', setting_key: 'auto_lock_timeout_minutes', policy_kind: 'ceiling', policy_value: 15 },
    });
  });

  it('returns an empty index when the tenant has no policy rows yet', async () => {
    currentFake = makeFakeSupabase({ policyRows: [] });
    const { useTenantSettingPolicies } = await import('./useTenantSettingPolicies');
    const { result } = renderHook(() => useTenantSettingPolicies('org-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({});
  });
});

describe('useSaveTenantSettingPolicy', () => {
  it('updates an existing policy row (never upsert)', async () => {
    currentFake = makeFakeSupabase();
    const { useSaveTenantSettingPolicy } = await import('./useTenantSettingPolicies');
    const { result } = renderHook(() => useSaveTenantSettingPolicy(), { wrapper });

    result.current.mutate({
      salesOrgId: 'org-1',
      existingId: 'p-1',
      settingKey: 'auto_lock_timeout_minutes',
      policyKind: 'ceiling',
      policyValue: 30,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const calls = currentFake.calls.filter((c) => c.table === 'tenant_setting_policies');
    expect(calls.some((c) => c.op === 'update')).toBe(true);
    expect(calls.some((c) => c.op === 'insert')).toBe(false);
    const updateCall = calls.find((c) => c.op === 'update');
    expect(updateCall?.payload).toMatchObject({ policy_kind: 'ceiling', policy_value: 30 });
  });

  it('inserts a new policy row when none exists for that key (never upsert)', async () => {
    currentFake = makeFakeSupabase();
    const { useSaveTenantSettingPolicy } = await import('./useTenantSettingPolicies');
    const { result } = renderHook(() => useSaveTenantSettingPolicy(), { wrapper });

    result.current.mutate({
      salesOrgId: 'org-1',
      existingId: null,
      settingKey: 'auto_lock_timeout_minutes',
      policyKind: 'ceiling',
      policyValue: 15,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const calls = currentFake.calls.filter((c) => c.table === 'tenant_setting_policies');
    expect(calls.some((c) => c.op === 'insert')).toBe(true);
    expect(calls.some((c) => c.op === 'update')).toBe(false);
    const insertCall = calls.find((c) => c.op === 'insert');
    expect(insertCall?.payload).toMatchObject({
      sales_org_id: 'org-1',
      setting_key: 'auto_lock_timeout_minutes',
      policy_kind: 'ceiling',
      policy_value: 15,
    });
  });

  it('propagates a save error and never silently succeeds', async () => {
    currentFake = makeFakeSupabase({ failInsert: true });
    const { useSaveTenantSettingPolicy } = await import('./useTenantSettingPolicies');
    const { result } = renderHook(() => useSaveTenantSettingPolicy(), { wrapper });

    result.current.mutate({
      salesOrgId: 'org-1',
      existingId: null,
      settingKey: 'auto_lock_timeout_minutes',
      policyKind: 'ceiling',
      policyValue: 15,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('throws client-side for a ceiling write against notification_quiet_hours (D-04/NOTIF-04/§ 84 HGB), never calling Supabase', async () => {
    currentFake = makeFakeSupabase();
    const { useSaveTenantSettingPolicy } = await import('./useTenantSettingPolicies');
    const { result } = renderHook(() => useSaveTenantSettingPolicy(), { wrapper });

    result.current.mutate({
      salesOrgId: 'org-1',
      existingId: null,
      settingKey: 'notification_quiet_hours',
      policyKind: 'ceiling',
      policyValue: { start: '20:00', end: '08:00' },
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    const calls = currentFake.calls.filter((c) => c.table === 'tenant_setting_policies');
    expect(calls).toHaveLength(0);
  });
});
