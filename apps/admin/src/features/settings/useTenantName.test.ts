import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Proves SEC-10/D-15's `useTenantName` data layer against a fake Supabase
 * client: it calls `my_tenant_identity` with NO arguments (T-14-12-01's
 * client-side half of the cross-tenant-exposure mitigation), resolves the
 * deterministic first-row display value on a multi-row result, and treats
 * zero rows as an explicit unknown state rather than an error.
 */

const mocks = vi.hoisted(() => ({
  session: { session: { user: { id: 'user-1', email: 'operator@fixture.test' } }, role: 'operator', loading: false },
}));

vi.mock('@/lib/auth/useSession', () => ({ useSession: () => mocks.session }));

interface FakeRpcCall {
  fn: string;
  args: unknown;
}

function makeFakeSupabase(options: {
  rows?: Array<{ tenant_kind: string; tenant_id: string; tenant_name: string }>;
  error?: Error | null;
} = {}) {
  const calls: FakeRpcCall[] = [];
  const rows = options.rows ?? [];
  const error = options.error ?? null;

  const supabase = {
    rpc(fn: string, args?: unknown) {
      calls.push({ fn, args });
      return Promise.resolve(error ? { data: null, error } : { data: rows, error: null });
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

describe('useTenantName', () => {
  it('calls my_tenant_identity with no arguments', async () => {
    currentFake = makeFakeSupabase({
      rows: [{ tenant_kind: 'sales_org', tenant_id: 'org-1', tenant_name: 'Distinctive Org GmbH' }],
    });
    const { useTenantName } = await import('./useTenantName');
    const { result } = renderHook(() => useTenantName(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(currentFake.calls).toHaveLength(1);
    expect(currentFake.calls[0]).toEqual({ fn: 'my_tenant_identity', args: undefined });
  });

  it('exposes the real tenant name from a single-row result', async () => {
    currentFake = makeFakeSupabase({
      rows: [{ tenant_kind: 'company', tenant_id: 'company-1', tenant_name: 'Distinctive Org GmbH' }],
    });
    const { useTenantName } = await import('./useTenantName');
    const { result } = renderHook(() => useTenantName(), { wrapper });

    await waitFor(() => expect(result.current.tenantName).toBe('Distinctive Org GmbH'));
    expect(result.current.tenantKind).toBe('company');
  });

  it('resolves a multi-row result to the first row, deterministically', async () => {
    currentFake = makeFakeSupabase({
      rows: [
        { tenant_kind: 'company', tenant_id: 'company-1', tenant_name: 'Alpha Company' },
        { tenant_kind: 'sales_org', tenant_id: 'org-2', tenant_name: 'Beta Org' },
      ],
    });
    const { useTenantName } = await import('./useTenantName');
    const { result } = renderHook(() => useTenantName(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.tenantName).toBe('Alpha Company');
    expect(result.current.tenants).toHaveLength(2);
  });

  it('treats zero rows as an explicit unknown state, never a fabricated name', async () => {
    currentFake = makeFakeSupabase({ rows: [] });
    const { useTenantName } = await import('./useTenantName');
    const { result } = renderHook(() => useTenantName(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.tenantName).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  it('surfaces an RPC error via isError', async () => {
    currentFake = makeFakeSupabase({ error: new Error('rpc failed') });
    const { useTenantName } = await import('./useTenantName');
    const { result } = renderHook(() => useTenantName(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
