import { useEffect, useState } from 'react';
import type { SettingsCache, SettingsSnapshot } from './settingsCache';
import type { SettingsRepo, Theme, TextSize, UpdateSettingsPatch, UserSettings } from './db/settingsRepo';
import { deriveSettingRowState, type LockableSettingKey, type SettingRowState, type TenantSettingPolicy } from './settingRowState';

export type { TenantSettingPolicy } from './settingRowState';

/**
 * useSettings — composes the D-16 MMKV boot cache (`settingsCache.ts`) with
 * the D-17 PowerSync-backed repo (`db/settingsRepo.ts`) into the one hook
 * every settings-consuming screen uses (SET-01).
 *
 * D-16 discipline: the cache is refreshed EXCLUSIVELY from the `watchSettings`
 * callback below, never from a setter. A setter writing the cache directly
 * would make MMKV a second source of truth, which D-16 forbids — every
 * setter here delegates to `repo.updateSettings` ONLY, and the synced row
 * (re-emitted by the watch) is what eventually refreshes the cache.
 *
 * The initial `useState` read is synchronous (`cache.get()` runs inside the
 * initializer, not an effect) so the very first rendered frame already has
 * the rep's theme/language, before `DbBoundary`/PowerSync resolves — that is
 * the entire reason the MMKV mirror exists.
 *
 * SET-07 (13-03) extension: an OPTIONAL second watch subscription composes
 * in the rep's synced `tenant_setting_policies` snapshot (via any object
 * shaping `PolicyRepo` below — `db/settingsPolicyRepo.ts`'s
 * `SettingsPolicyRepo` satisfies it structurally, no import needed here,
 * which keeps this file's only compile-time dependency on the new SET-07
 * surface pointed at the pure `settingRowState.ts`, not the DB-backed repo).
 * Policies are deliberately NEVER written to the MMKV boot cache (unlike the
 * rep's own settings snapshot above): the cache exists so the very first
 * frame has a value before PowerSync resolves, but a STALE cached ceiling is
 * worse than no ceiling — a rep could be shown (or held to) a boundary the
 * org already lifted. `policies`/`rowState` therefore start empty/'free' on
 * every cold boot and only reflect live synced rows once the second watch
 * emits, never a persisted guess.
 */

/** Documented defaults when the cache is empty (first-ever boot, no prior snapshot). */
export const DEFAULT_SETTINGS_SNAPSHOT: SettingsSnapshot = {
  language: 'de',
  theme: 'system',
  textSize: 'default',
  highContrast: false,
};

/**
 * Structural shape this module needs from a policy repo — satisfied by
 * `db/settingsPolicyRepo.ts`'s `SettingsPolicyRepo` (13-03 Task 1) without
 * an import, so this file's only SET-07 compile-time dependency stays on
 * the pure `settingRowState.ts` module.
 */
export interface PolicyRepo {
  watchPolicies(
    onChange: (policies: readonly TenantSettingPolicy[]) => void,
    onError?: (error: unknown) => void,
  ): () => void;
}

export interface UseSettingsOptions {
  cache: SettingsCache;
  repo: SettingsRepo;
  /** The signed-in rep's own id (user_settings.id), or null before session resolves. */
  userId: string | null;
  /** Optional — omit to render without policy-derived row states (e.g. screens with no lockable rows). */
  policyRepo?: PolicyRepo;
}

export interface UseSettingsResult extends SettingsSnapshot {
  setTheme(theme: Theme): void;
  setTextSize(textSize: TextSize): void;
  setHighContrast(highContrast: boolean): void;
  setLanguage(language: string): void;
  /** The rep's live synced tenant policy snapshot — never MMKV-cached (see file header). */
  policies: readonly TenantSettingPolicy[];
  /** SET-07: derives this key's free/proposed/ceiling state from `policies`. */
  rowState(key: LockableSettingKey): SettingRowState;
}

function toSnapshot(settings: UserSettings): SettingsSnapshot {
  return {
    language: settings.language,
    theme: settings.theme,
    textSize: settings.textSize,
    highContrast: settings.highContrast,
  };
}

/**
 * Pure: resolves the synchronous first-render snapshot from the injected
 * cache, falling back to the documented defaults when nothing is cached yet
 * (very first boot). Called inside the `useState` initializer below so it
 * runs before any async work — the entire reason the MMKV mirror exists
 * (D-16). Exported separately so it is directly unit-tested.
 */
export function resolveInitialSnapshot(cache: SettingsCache): SettingsSnapshot {
  return cache.get() ?? DEFAULT_SETTINGS_SNAPSHOT;
}

/**
 * Pure/DI'd subscription core (mirrors `useMarkFirstSync.ts`'s
 * `attachMarkFirstSync` shape) — subscribes to `repo.watchSettings`, and on
 * every emission writes the cache (write-through, D-16) and reports the new
 * snapshot via `setSnapshot`. A `cancelled` closure guard ensures no update
 * fires after the returned cleanup runs. Tested directly against fakes,
 * never via a component renderer (no react-native-testing-library in this
 * repo — mirrors the `attachMarkFirstSync` precedent).
 */
export function attachSettingsWatch(
  { cache, repo, userId }: UseSettingsOptions,
  setSnapshot: (snapshot: SettingsSnapshot) => void,
): () => void {
  if (!userId) return () => {};

  let cancelled = false;
  const unsubscribe = repo.watchSettings(userId, (settings) => {
    if (cancelled) return;
    if (!settings) return;
    const snapshot = toSnapshot(settings);
    cache.set(snapshot);
    setSnapshot(snapshot);
  });

  return () => {
    cancelled = true;
    unsubscribe();
  };
}

/**
 * Pure/DI'd subscription core for the SET-07 policy snapshot — same shape as
 * `attachSettingsWatch` above (cancelled-flag guard, returns an unsubscribe
 * function), but deliberately does NOT touch `cache`/MMKV (see file header:
 * a stale cached ceiling is worse than no ceiling). A no-op when no
 * `policyRepo` was supplied.
 */
export function attachPoliciesWatch(
  { policyRepo }: Pick<UseSettingsOptions, 'policyRepo'>,
  setPolicies: (policies: readonly TenantSettingPolicy[]) => void,
): () => void {
  if (!policyRepo) return () => {};

  let cancelled = false;
  const unsubscribe = policyRepo.watchPolicies((policies) => {
    if (cancelled) return;
    setPolicies(policies);
  });

  return () => {
    cancelled = true;
    unsubscribe();
  };
}

/**
 * Pure: builds the four typed setters, each delegating to
 * `repo.updateSettings` ONLY. Deliberately does NOT close over `cache` — it
 * is structurally impossible for these setters to write the cache directly,
 * which is the D-16 guarantee (T-12-04-02) made concrete rather than just
 * documented. The cache is refreshed exclusively by `attachSettingsWatch`
 * above, from the watch callback.
 */
export function createSettingsSetters(
  repo: SettingsRepo,
  userId: string | null,
): Pick<UseSettingsResult, 'setTheme' | 'setTextSize' | 'setHighContrast' | 'setLanguage'> {
  const applyPatch = (patch: UpdateSettingsPatch) => {
    if (!userId) return;
    void repo.updateSettings(userId, patch);
  };

  return {
    setTheme: (theme) => applyPatch({ theme }),
    setTextSize: (textSize) => applyPatch({ textSize }),
    setHighContrast: (highContrast) => applyPatch({ highContrast }),
    setLanguage: (language) => applyPatch({ language }),
  };
}

export function useSettings({ cache, repo, userId, policyRepo }: UseSettingsOptions): UseSettingsResult {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot>(() => resolveInitialSnapshot(cache));
  const [policies, setPolicies] = useState<readonly TenantSettingPolicy[]>([]);

  useEffect(() => {
    return attachSettingsWatch({ cache, repo, userId }, setSnapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cache/repo are stable DI instances, only userId changes identity
  }, [cache, repo, userId]);

  useEffect(() => {
    return attachPoliciesWatch({ policyRepo }, setPolicies);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- policyRepo is a stable DI instance
  }, [policyRepo]);

  return {
    ...snapshot,
    ...createSettingsSetters(repo, userId),
    policies,
    rowState: (key) => deriveSettingRowState(key, policies),
  };
}
