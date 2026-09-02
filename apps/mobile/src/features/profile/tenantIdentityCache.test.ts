import { beforeEach, describe, expect, it, vi } from 'vitest';

// Node test environment: react-native-mmkv is a native Nitro module — never
// loaded in this test, since every test injects a fake storage (mirrors
// leaderboardCache.test.ts's fake-db pattern). If a test accidentally hits
// the default storage path this mock keeps the suite from crashing while
// still making the miss obvious (constructor throws would fail loudly
// instead).
vi.mock('react-native-mmkv', () => ({
  createMMKV: vi.fn(() => {
    throw new Error('MMKV native module must never be constructed in unit tests');
  }),
}));

import { createTenantIdentityCache, type CacheStorage, type TenantIdentityRow } from './tenantIdentityCache';

function fakeStorage(): CacheStorage & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getString: vi.fn((key: string) => store.get(key)),
    set: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    remove: vi.fn((key: string) => {
      store.delete(key);
    }),
  };
}

const rowA: TenantIdentityRow = { tenantKind: 'company', tenantId: 'company-1', tenantName: 'Acme GmbH' };
const rowB: TenantIdentityRow = { tenantKind: 'sales_org', tenantId: 'org-1', tenantName: 'Vertriebsteam Ost' };

describe('tenantIdentityCache (non-PowerSync local store, D-16)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('round-trips a TenantIdentityRow[] through the injected storage', () => {
    const storage = fakeStorage();
    const cache = createTenantIdentityCache({ storage });

    cache.set('user-1', [rowA]);
    const result = cache.get('user-1');

    expect(result).toEqual([rowA]);
  });

  it('returns null for a cache miss', () => {
    const storage = fakeStorage();
    const cache = createTenantIdentityCache({ storage });

    expect(cache.get('user-1')).toBeNull();
  });

  it('keys separately per user id — writing as user A never leaks to a read as user B', () => {
    const storage = fakeStorage();
    const cache = createTenantIdentityCache({ storage });

    cache.set('user-a', [rowA]);

    expect(cache.get('user-a')).toEqual([rowA]);
    expect(cache.get('user-b')).toBeNull();
    expect(storage.store.size).toBe(1);
  });

  it('never throws on malformed stored JSON — falls back to a cache miss', () => {
    const storage = fakeStorage();
    storage.store.set('tenant-identity:user-1', 'not-json{{');
    const cache = createTenantIdentityCache({ storage });

    expect(cache.get('user-1')).toBeNull();
  });

  it('rejects a malformed row shape (missing tenantName) rather than returning it', () => {
    const storage = fakeStorage();
    storage.store.set('tenant-identity:user-1', JSON.stringify([{ tenantKind: 'company', tenantId: 'x' }]));
    const cache = createTenantIdentityCache({ storage });

    expect(cache.get('user-1')).toBeNull();
  });

  it('rejects an empty-array stored value as a cache miss', () => {
    const storage = fakeStorage();
    storage.store.set('tenant-identity:user-1', JSON.stringify([]));
    const cache = createTenantIdentityCache({ storage });

    expect(cache.get('user-1')).toBeNull();
  });

  it('invalidate clears the cached snapshot for that user id only', () => {
    const storage = fakeStorage();
    const cache = createTenantIdentityCache({ storage });
    cache.set('user-a', [rowA]);
    cache.set('user-b', [rowB]);

    cache.invalidate('user-a');

    expect(cache.get('user-a')).toBeNull();
    expect(cache.get('user-b')).toEqual([rowB]);
  });

  it('preserves multiple rows and their order for the same user id', () => {
    const storage = fakeStorage();
    const cache = createTenantIdentityCache({ storage });

    cache.set('user-1', [rowA, rowB]);

    expect(cache.get('user-1')).toEqual([rowA, rowB]);
  });
});
