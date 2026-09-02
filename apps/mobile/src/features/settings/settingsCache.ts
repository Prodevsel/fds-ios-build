import { createMMKV } from 'react-native-mmkv';

/**
 * settingsCache — the D-16 MMKV boot-time mirror for a rep's theme/language/
 * accessibility preferences (SET-01). This cache is WRITE-THROUGH ONLY and is
 * NEVER THE SOURCE OF TRUTH: the synced Postgres `user_settings` row (via
 * PowerSync, see `db/settingsRepo.ts`) is authoritative. This module exists
 * solely so `useSettings()` can return a usable snapshot on the very first
 * rendered frame, before `DbBoundary`/PowerSync resolves — every real
 * preference change goes through `settingsRepo` first, and this mirror is
 * refreshed only from the `db.watch` callback in `useSettings.ts`, never
 * written directly by a user action.
 *
 * Copies `leaderboardCache.ts`'s structure verbatim (DI'd `CacheStorage` seam,
 * lazy-singleton default storage, try/catch JSON guard) with a DISTINCT MMKV
 * `id` so the two keyspaces can never collide (see `createMMKV` call below).
 */

/** The rep's preference snapshot mirrored from the synced `user_settings` row. */
export interface SettingsSnapshot {
  language: string;
  theme: 'light' | 'dark' | 'system';
  textSize: 'default' | 'large' | 'extra_large';
  highContrast: boolean;
}

/** The minimal subset of MMKV's instance API this module depends on —
 * injectable for tests (fake Map-backed storage), never the native module
 * directly (mirrors leaderboardCache.ts's CacheStorage). */
export interface CacheStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove?(key: string): void;
}

export interface CreateSettingsCacheOptions {
  storage?: CacheStorage;
}

export interface SettingsCache {
  get(): SettingsSnapshot | null;
  set(snapshot: SettingsSnapshot): void;
}

const SNAPSHOT_KEY = 'snapshot';

// Lazily-constructed singleton (mirrors leaderboardCache.ts's getDefaultStorage())
// — the native MMKV instance is only ever touched on first real use, never at
// import time, so this module stays test-safe under vitest/node.
let defaultStorage: CacheStorage | null = null;
function getDefaultStorage(): CacheStorage {
  if (!defaultStorage) {
    // Distinct id from leaderboardCache.ts's MMKV instance so the two keyspaces
    // can never collide.
    defaultStorage = createMMKV({ id: 'settings-cache' });
  }
  return defaultStorage;
}

/** Injectable options-object DI (mirrors createLeaderboardCache). */
export function createSettingsCache(options: CreateSettingsCacheOptions = {}): SettingsCache {
  const storage = options.storage ?? getDefaultStorage();

  return {
    get() {
      const raw = storage.getString(SNAPSHOT_KEY);
      if (raw === undefined) return null;
      try {
        return JSON.parse(raw) as SettingsSnapshot;
      } catch {
        return null;
      }
    },
    set(snapshot) {
      storage.set(SNAPSHOT_KEY, JSON.stringify(snapshot));
    },
  };
}
