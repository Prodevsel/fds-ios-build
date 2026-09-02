import { createMMKV } from 'react-native-mmkv';

/**
 * leaderboardCache — the D-05 non-PowerSync local cache for leaderboard rows
 * (GAMI-01/03). `react-native-mmkv` (Package Legitimacy Gate passed: npm
 * owner mrousavy, same author/ecosystem as this repo's already-trusted
 * `react-native-vision-camera`, MIT, zero deps, no postinstall script,
 * Nitro-based / New-Architecture-only — matches Expo SDK 56) is used ONLY
 * here, behind a small DI'd `CacheStorage` interface so this module and
 * `useLeaderboard.ts` are unit-testable without loading the native module
 * (mirrors walletRepo's fake-db pattern).
 *
 * This store is DELIBERATELY not the PowerSync SQLCipher DB: no per-rep
 * commission row from the leaderboard ever enters the encrypted sync set
 * (T-09-08). Cache entries are keyed per team+scope+period so switching the
 * rep-selected team (revised D-01) never shows another team's cached rows.
 */

/** Mirrors 0064_leaderboard_entries_rpc.sql's projected columns (camelCase). */
export interface LeaderboardEntry {
  rank: number;
  repId: string;
  displayName: string;
  dealsCount: number;
  /** null when leaderboard_config.show_commission_amounts is false — renders
   * as absent, never coerced to 0. */
  commissionEur: number | null;
}

export type LeaderboardScope = 'team' | 'org';
export type LeaderboardPeriod = 'day' | 'week' | 'month';

export interface LeaderboardCacheKey {
  teamId: string;
  scope: LeaderboardScope;
  period: LeaderboardPeriod;
}

export interface LeaderboardCacheEnvelope {
  entries: LeaderboardEntry[];
  fetchedAtIso: string;
}

/** The minimal subset of MMKV's instance API this module depends on —
 * injectable for tests (fake Map-backed storage), never the native module
 * directly (T-09-SC / New-Architecture-safe test isolation). `remove` is
 * optional so pre-existing fakes (leaderboardCache.test.ts, useLeaderboard.test.ts)
 * that only implement getString/set keep type-checking; the real MMKV
 * instance's native `remove(key)` satisfies it (09-07, GAMI-04). */
export interface CacheStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove?(key: string): void;
}

export interface CreateLeaderboardCacheOptions {
  storage?: CacheStorage;
}

export interface LeaderboardCache {
  get(key: LeaderboardCacheKey): LeaderboardCacheEnvelope | null;
  set(key: LeaderboardCacheKey, envelope: LeaderboardCacheEnvelope): void;
  /** Clears the cached snapshot for this exact key (09-07, GAMI-04) — used
   * when a live deal-closed broadcast means the cached rows are stale, so a
   * subsequent offline RPC failure never silently serves the pre-broadcast
   * snapshot as if it were current. */
  invalidate(key: LeaderboardCacheKey): void;
}

function toCacheKey(key: LeaderboardCacheKey): string {
  return `${key.teamId}:${key.scope}:${key.period}`;
}

// Lazily-constructed singleton (mirrors getSupabase()'s pattern) — the native
// MMKV instance is only ever touched on first real use, never at import time,
// so this module stays test-safe under vitest/node.
let defaultStorage: CacheStorage | null = null;
function getDefaultStorage(): CacheStorage {
  if (!defaultStorage) {
    defaultStorage = createMMKV({ id: 'leaderboard-cache' });
  }
  return defaultStorage;
}

/** Injectable options-object DI (mirrors createWalletRepo/createAssignTerritory). */
export function createLeaderboardCache(
  options: CreateLeaderboardCacheOptions = {},
): LeaderboardCache {
  const storage = options.storage ?? getDefaultStorage();

  return {
    get(key) {
      const raw = storage.getString(toCacheKey(key));
      if (raw === undefined) return null;
      try {
        const parsed = JSON.parse(raw) as LeaderboardCacheEnvelope;
        if (!Array.isArray(parsed.entries) || typeof parsed.fetchedAtIso !== 'string') {
          return null;
        }
        return parsed;
      } catch {
        return null;
      }
    },
    set(key, envelope) {
      storage.set(toCacheKey(key), JSON.stringify(envelope));
    },
    invalidate(key) {
      storage.remove?.(toCacheKey(key));
    },
  };
}
