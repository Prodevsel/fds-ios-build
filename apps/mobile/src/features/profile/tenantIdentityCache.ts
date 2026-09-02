import { createMMKV } from 'react-native-mmkv';

/**
 * tenantIdentityCache — the D-16 non-PowerSync local cache backing SEC-10's
 * "which tenant am I logged into" chrome. Mirrors
 * `leaderboardCache.ts`'s DI'd `CacheStorage` seam (`react-native-mmkv`,
 * `createMMKV(...)`, NOT `new MMKV()`) so this module is unit-testable
 * without loading the native module.
 *
 * Deliberately NOT PowerSync/SQLCipher: no client `Table`, no sync-stream
 * entry — see D-16's rationale recorded in
 * `supabase/migrations/0078_my_tenant_identity_rpc.sql`'s header. Per the
 * STATE.md 12-04 rule ("a cache must never become a second source of
 * truth"), this store is a render accelerator only — `useTenantIdentity.ts`'s
 * `resolveTenantIdentity` always lets a successful RPC result overwrite
 * whatever is cached here.
 *
 * Keyed per user id (T-14-09-02): switching accounts on one device must
 * never surface the previous account's tenant name.
 */

export type TenantKind = 'company' | 'sales_org';

/** Mirrors `public.my_tenant_identity()`'s projected columns (camelCase). */
export interface TenantIdentityRow {
  tenantKind: TenantKind;
  tenantId: string;
  tenantName: string;
}

/** The minimal subset of MMKV's instance API this module depends on —
 * injectable for tests (fake Map-backed storage), never the native module
 * directly. Mirrors `leaderboardCache.ts`'s `CacheStorage`. */
export interface CacheStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove?(key: string): void;
}

export interface CreateTenantIdentityCacheOptions {
  storage?: CacheStorage;
}

export interface TenantIdentityCache {
  get(userId: string): TenantIdentityRow[] | null;
  set(userId: string, rows: TenantIdentityRow[]): void;
  /** Clears the cached snapshot for this exact user id. */
  invalidate(userId: string): void;
}

function toCacheKey(userId: string): string {
  return `tenant-identity:${userId}`;
}

function isTenantIdentityRow(value: unknown): value is TenantIdentityRow {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    (row.tenantKind === 'company' || row.tenantKind === 'sales_org') &&
    typeof row.tenantId === 'string' &&
    row.tenantId.length > 0 &&
    typeof row.tenantName === 'string' &&
    row.tenantName.length > 0
  );
}

// Lazily-constructed singleton (mirrors leaderboardCache's getDefaultStorage
// pattern) — the native MMKV instance is only ever touched on first real
// use, never at import time, so this module stays test-safe under
// vitest/node.
let defaultStorage: CacheStorage | null = null;
function getDefaultStorage(): CacheStorage {
  if (!defaultStorage) {
    defaultStorage = createMMKV({ id: 'tenant-identity-cache' });
  }
  return defaultStorage;
}

/** Injectable options-object DI (mirrors createLeaderboardCache/createSettingsCache). */
export function createTenantIdentityCache(
  options: CreateTenantIdentityCacheOptions = {},
): TenantIdentityCache {
  const storage = options.storage ?? getDefaultStorage();

  return {
    get(userId) {
      const raw = storage.getString(toCacheKey(userId));
      if (raw === undefined) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length === 0) return null;
        if (!parsed.every(isTenantIdentityRow)) return null;
        return parsed;
      } catch {
        return null;
      }
    },
    set(userId, rows) {
      storage.set(toCacheKey(userId), JSON.stringify(rows));
    },
    invalidate(userId) {
      storage.remove?.(toCacheKey(userId));
    },
  };
}
