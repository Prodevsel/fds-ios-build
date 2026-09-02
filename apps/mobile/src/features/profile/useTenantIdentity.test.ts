import { describe, expect, it, vi } from 'vitest';

// Node test environment: useTenantIdentity.ts transitively imports
// getSupabase (lib/auth/supabase), which reaches into native modules — mock
// it so these tests never load the native react-native chain (mirrors
// sessionsRepo.test.ts's mocking pattern). `resolveTenantIdentity` is
// exercised directly against fakes below, so the mocked getSupabase is
// never actually invoked.
vi.mock('../../lib/auth/supabase', () => ({ getSupabase: vi.fn() }));
// Same reasoning for the tenantIdentityCache.ts -> react-native-mmkv chain
// (mirrors tenantIdentityCache.test.ts's own mock) — the default storage
// singleton is never touched since `resolveTenantIdentity` here is always
// called with an injected fake cache.
vi.mock('react-native-mmkv', () => ({
  createMMKV: vi.fn(() => {
    throw new Error('MMKV native module must never be constructed in unit tests');
  }),
}));

import type { TenantIdentityCache, TenantIdentityRow } from './tenantIdentityCache';
import { parseTenantIdentityRow, resolveTenantIdentity } from './useTenantIdentity';

const cachedRow: TenantIdentityRow = { tenantKind: 'company', tenantId: 'company-1', tenantName: 'Acme GmbH' };
const rpcRowCompany = { tenant_kind: 'company', tenant_id: 'company-2', tenant_name: 'Vertrieb West' };
const rpcRowSalesOrg = { tenant_kind: 'sales_org', tenant_id: 'org-9', tenant_name: 'Alpha Vertrieb' };

function fakeCache(initial: Record<string, TenantIdentityRow[]> = {}): TenantIdentityCache & {
  setCalls: Array<[string, TenantIdentityRow[]]>;
} {
  const store = new Map<string, TenantIdentityRow[]>(Object.entries(initial));
  const setCalls: Array<[string, TenantIdentityRow[]]> = [];
  return {
    setCalls,
    get(userId) {
      return store.get(userId) ?? null;
    },
    set(userId, rows) {
      store.set(userId, rows);
      setCalls.push([userId, rows]);
    },
    invalidate(userId) {
      store.delete(userId);
    },
  };
}

describe('resolveTenantIdentity (SEC-10/D-16 cache-first + RPC refresh, no component mounting)', () => {
  it('warm cache + no network (rpc rejects) returns the cached name immediately, reported as cached', async () => {
    const cache = fakeCache({ 'user-1': [cachedRow] });
    const rpc = vi.fn().mockRejectedValue(new Error('network unreachable'));

    const result = await resolveTenantIdentity({ cache, rpc, userId: 'user-1' });

    expect(result).toEqual({
      ready: true,
      tenantName: 'Acme GmbH',
      tenantKind: 'company',
      all: [cachedRow],
      fromCache: true,
    });
    // A failed RPC must never write to the cache.
    expect(cache.setCalls).toHaveLength(0);
  });

  it('cold cache + successful RPC resolves to the RPC result, not cached', async () => {
    const cache = fakeCache();
    const rpc = vi.fn().mockResolvedValue({ data: [rpcRowCompany], error: null });

    const result = await resolveTenantIdentity({ cache, rpc, userId: 'user-1' });

    expect(result.ready).toBe(true);
    expect(result.tenantName).toBe('Vertrieb West');
    expect(result.tenantKind).toBe('company');
    expect(result.fromCache).toBe(false);
  });

  it('a successful RPC result overwrites the cache', async () => {
    const cache = fakeCache({ 'user-1': [cachedRow] });
    const rpc = vi.fn().mockResolvedValue({ data: [rpcRowCompany], error: null });

    await resolveTenantIdentity({ cache, rpc, userId: 'user-1' });

    expect(cache.get('user-1')).toEqual([
      { tenantKind: 'company', tenantId: 'company-2', tenantName: 'Vertrieb West' },
    ]);
  });

  it('cold cache + failed RPC never invents a default — resolves to the unready/unknown state', async () => {
    const cache = fakeCache();
    const rpc = vi.fn().mockResolvedValue({ data: null, error: new Error('boom') });

    const result = await resolveTenantIdentity({ cache, rpc, userId: 'user-1' });

    expect(result.ready).toBe(false);
    expect(result.tenantName).toBeNull();
    expect(cache.setCalls).toHaveLength(0);
  });

  it('a zero-row RPC result is NOT cached and leaves the surface in the unready/unknown state', async () => {
    const cache = fakeCache({ 'user-1': [cachedRow] });
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });

    const result = await resolveTenantIdentity({ cache, rpc, userId: 'user-1' });

    expect(result.ready).toBe(false);
    expect(result.tenantName).toBeNull();
    expect(cache.setCalls).toHaveLength(0);
  });

  it('multiple returned rows produce a deterministic display value (first row, RPC order) while keeping the full list', async () => {
    const cache = fakeCache();
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: [rpcRowSalesOrg, rpcRowCompany], error: null });

    const result = await resolveTenantIdentity({ cache, rpc, userId: 'user-1' });

    expect(result.tenantName).toBe('Alpha Vertrieb');
    expect(result.tenantKind).toBe('sales_org');
    expect(result.all).toEqual([
      { tenantKind: 'sales_org', tenantId: 'org-9', tenantName: 'Alpha Vertrieb' },
      { tenantKind: 'company', tenantId: 'company-2', tenantName: 'Vertrieb West' },
    ]);
  });

  it('the cache is keyed per user id — resolving as a different user never sees the first user\'s cached name', async () => {
    const cache = fakeCache({ 'user-a': [cachedRow] });
    const rpc = vi.fn().mockRejectedValue(new Error('offline'));

    const result = await resolveTenantIdentity({ cache, rpc, userId: 'user-b' });

    expect(result.ready).toBe(false);
    expect(result.tenantName).toBeNull();
  });

  it('an empty tenant_name row is dropped, never treated as a valid blank name', async () => {
    const cache = fakeCache();
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: [{ tenant_kind: 'company', tenant_id: 'company-3', tenant_name: '' }], error: null });

    const result = await resolveTenantIdentity({ cache, rpc, userId: 'user-1' });

    expect(result.ready).toBe(false);
    expect(result.tenantName).toBeNull();
    expect(cache.setCalls).toHaveLength(0);
  });
});

describe('parseTenantIdentityRow', () => {
  it('parses a well-formed raw row', () => {
    expect(parseTenantIdentityRow(rpcRowCompany)).toEqual({
      tenantKind: 'company',
      tenantId: 'company-2',
      tenantName: 'Vertrieb West',
    });
  });

  it('drops a row with an unrecognized tenant_kind', () => {
    expect(
      parseTenantIdentityRow({ tenant_kind: 'other', tenant_id: 'x', tenant_name: 'X' }),
    ).toBeNull();
  });

  it('drops a row missing tenant_id', () => {
    expect(parseTenantIdentityRow({ tenant_kind: 'company', tenant_name: 'X' })).toBeNull();
  });
});
