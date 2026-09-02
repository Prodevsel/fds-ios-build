import { describe, expect, it, vi } from 'vitest';
import {
  attachPoliciesWatch,
  attachSettingsWatch,
  createSettingsSetters,
  DEFAULT_SETTINGS_SNAPSHOT,
  resolveInitialSnapshot,
  type PolicyRepo,
} from './useSettings';
import type { SettingsCache, SettingsSnapshot } from './settingsCache';
import type { SettingsRepo, UserSettings } from './db/settingsRepo';
import { deriveSettingRowState, type TenantSettingPolicy } from './settingRowState';

// Node test environment: no react-native-testing-library in this repo (see
// useMarkFirstSync.test.ts precedent) — every hook here is decomposed into
// pure/DI'd core functions and tested directly against fakes, never via a
// component renderer.

function fakeCache(initial: SettingsSnapshot | null = null): SettingsCache & { setCalls: SettingsSnapshot[] } {
  let stored = initial;
  const setCalls: SettingsSnapshot[] = [];
  return {
    setCalls,
    get: vi.fn(() => stored),
    set: vi.fn((snapshot: SettingsSnapshot) => {
      stored = snapshot;
      setCalls.push(snapshot);
    }),
  };
}

function fakeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    id: 'rep-1',
    language: 'de',
    theme: 'dark',
    textSize: 'large',
    highContrast: true,
    autoLockTimeoutMinutes: null,
    updatedAt: '2026-08-11T00:00:00.000Z',
    ...overrides,
  };
}

function fakePolicy(overrides: Partial<TenantSettingPolicy> = {}): TenantSettingPolicy {
  return {
    id: 'policy-1',
    settingKey: 'auto_lock_timeout_minutes',
    policyKind: 'ceiling',
    policyValue: '15',
    ...overrides,
  };
}

function fakePolicyRepo(): PolicyRepo & { emit: (policies: readonly TenantSettingPolicy[]) => void; unsubscribeSpy: ReturnType<typeof vi.fn> } {
  let onChangeCb: ((policies: readonly TenantSettingPolicy[]) => void) | null = null;
  const unsubscribeSpy = vi.fn();
  return {
    unsubscribeSpy,
    emit: (policies) => onChangeCb?.(policies),
    watchPolicies: vi.fn((onChange: (policies: readonly TenantSettingPolicy[]) => void) => {
      onChangeCb = onChange;
      return unsubscribeSpy;
    }),
  };
}

function fakeRepo(): SettingsRepo & { emit: (settings: UserSettings | null) => void; unsubscribeSpy: ReturnType<typeof vi.fn> } {
  let onChangeCb: ((settings: UserSettings | null) => void) | null = null;
  const unsubscribeSpy = vi.fn();
  return {
    unsubscribeSpy,
    emit: (settings) => onChangeCb?.(settings),
    getSettings: vi.fn(async () => null),
    ensureSettingsRow: vi.fn(async () => undefined),
    updateSettings: vi.fn(async () => undefined),
    watchSettings: vi.fn((_userId, onChange) => {
      onChangeCb = onChange;
      return unsubscribeSpy;
    }),
  };
}

describe('resolveInitialSnapshot (D-16 synchronous boot read)', () => {
  it('returns the cached snapshot synchronously when one exists', () => {
    const cached: SettingsSnapshot = { language: 'en', theme: 'dark', textSize: 'large', highContrast: true };
    const cache = fakeCache(cached);

    expect(resolveInitialSnapshot(cache)).toEqual(cached);
  });

  it('falls back to the documented defaults when the cache is empty', () => {
    const cache = fakeCache(null);

    expect(resolveInitialSnapshot(cache)).toEqual(DEFAULT_SETTINGS_SNAPSHOT);
    expect(DEFAULT_SETTINGS_SNAPSHOT).toEqual({
      language: 'de',
      theme: 'system',
      textSize: 'default',
      highContrast: false,
    });
  });
});

describe('attachSettingsWatch (watch -> cache write-through -> state update)', () => {
  it('on a watch emission, writes the cache exactly once and reports the new snapshot', () => {
    const cache = fakeCache();
    const repo = fakeRepo();
    const setSnapshot = vi.fn();

    attachSettingsWatch({ cache, repo, userId: 'rep-1' }, setSnapshot);
    repo.emit(fakeSettings());

    expect(cache.set).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith({ language: 'de', theme: 'dark', textSize: 'large', highContrast: true });
    expect(setSnapshot).toHaveBeenCalledTimes(1);
    expect(setSnapshot).toHaveBeenCalledWith({ language: 'de', theme: 'dark', textSize: 'large', highContrast: true });
  });

  it('a null emission (no row yet) updates neither the cache nor the state', () => {
    const cache = fakeCache();
    const repo = fakeRepo();
    const setSnapshot = vi.fn();

    attachSettingsWatch({ cache, repo, userId: 'rep-1' }, setSnapshot);
    repo.emit(null);

    expect(cache.set).not.toHaveBeenCalled();
    expect(setSnapshot).not.toHaveBeenCalled();
  });

  it('calling the returned cleanup unsubscribes the watch', () => {
    const cache = fakeCache();
    const repo = fakeRepo();
    const cleanup = attachSettingsWatch({ cache, repo, userId: 'rep-1' }, vi.fn());

    cleanup();

    expect(repo.unsubscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('no state update lands after unmount even if the watch fires late', () => {
    const cache = fakeCache();
    const repo = fakeRepo();
    const setSnapshot = vi.fn();
    const cleanup = attachSettingsWatch({ cache, repo, userId: 'rep-1' }, setSnapshot);

    cleanup();
    repo.emit(fakeSettings());

    expect(setSnapshot).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('with no userId, is a no-op that never subscribes', () => {
    const cache = fakeCache();
    const repo = fakeRepo();

    const cleanup = attachSettingsWatch({ cache, repo, userId: null }, vi.fn());

    expect(repo.watchSettings).not.toHaveBeenCalled();
    expect(() => cleanup()).not.toThrow();
  });
});

describe('createSettingsSetters (D-16: delegate to repo.updateSettings ONLY, never cache.set)', () => {
  it('calling a setter produces exactly 0 cache.set calls and exactly 1 repo.updateSettings call', () => {
    const cache = fakeCache();
    const repo = fakeRepo();
    const setters = createSettingsSetters(repo, 'rep-1');

    setters.setTheme('dark');

    expect(cache.set).toHaveBeenCalledTimes(0);
    expect(repo.updateSettings).toHaveBeenCalledTimes(1);
    expect(repo.updateSettings).toHaveBeenCalledWith('rep-1', { theme: 'dark' });
  });

  it('setTextSize/setHighContrast/setLanguage each delegate a single-key patch', () => {
    const repo = fakeRepo();
    const setters = createSettingsSetters(repo, 'rep-1');

    setters.setTextSize('large');
    setters.setHighContrast(true);
    setters.setLanguage('en');

    expect(repo.updateSettings).toHaveBeenNthCalledWith(1, 'rep-1', { textSize: 'large' });
    expect(repo.updateSettings).toHaveBeenNthCalledWith(2, 'rep-1', { highContrast: true });
    expect(repo.updateSettings).toHaveBeenNthCalledWith(3, 'rep-1', { language: 'en' });
  });

  it('with no userId, setters are a no-op (never call repo.updateSettings)', () => {
    const repo = fakeRepo();
    const setters = createSettingsSetters(repo, null);

    setters.setTheme('light');

    expect(repo.updateSettings).not.toHaveBeenCalled();
  });
});

describe('attachPoliciesWatch (SET-07 second subscription, 13-03) — composed alongside attachSettingsWatch, never MMKV-cached', () => {
  it('on a watch emission, reports the new policy snapshot', () => {
    const policyRepo = fakePolicyRepo();
    const setPolicies = vi.fn();

    attachPoliciesWatch({ policyRepo }, setPolicies);
    const policies = [fakePolicy()];
    policyRepo.emit(policies);

    expect(setPolicies).toHaveBeenCalledTimes(1);
    expect(setPolicies).toHaveBeenCalledWith(policies);
  });

  it('calling the returned cleanup unsubscribes the watch', () => {
    const policyRepo = fakePolicyRepo();
    const cleanup = attachPoliciesWatch({ policyRepo }, vi.fn());

    cleanup();

    expect(policyRepo.unsubscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('no state update lands after unmount even if the watch fires late', () => {
    const policyRepo = fakePolicyRepo();
    const setPolicies = vi.fn();
    const cleanup = attachPoliciesWatch({ policyRepo }, setPolicies);

    cleanup();
    policyRepo.emit([fakePolicy()]);

    expect(setPolicies).not.toHaveBeenCalled();
  });

  it('with no policyRepo, is a no-op that never subscribes', () => {
    const cleanup = attachPoliciesWatch({ policyRepo: undefined }, vi.fn());

    expect(() => cleanup()).not.toThrow();
  });
});

describe('useSettings composition — both watchers attach/unsubscribe, rowState reflects the latest policy emission', () => {
  it('both attachSettingsWatch and attachPoliciesWatch attach on the same options, and both unsubscribe on their own cleanup', () => {
    const cache = fakeCache();
    const repo = fakeRepo();
    const policyRepo = fakePolicyRepo();

    const cleanupSettings = attachSettingsWatch({ cache, repo, userId: 'rep-1' }, vi.fn());
    const cleanupPolicies = attachPoliciesWatch({ policyRepo }, vi.fn());

    expect(repo.watchSettings).toHaveBeenCalledTimes(1);
    expect(policyRepo.watchPolicies).toHaveBeenCalledTimes(1);

    cleanupSettings();
    cleanupPolicies();

    expect(repo.unsubscribeSpy).toHaveBeenCalledTimes(1);
    expect(policyRepo.unsubscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('rowState (via deriveSettingRowState) reflects the latest emitted policy snapshot', () => {
    const policyRepo = fakePolicyRepo();
    let policies: readonly TenantSettingPolicy[] = [];
    attachPoliciesWatch({ policyRepo }, (next) => {
      policies = next;
    });

    expect(deriveSettingRowState('auto_lock_timeout_minutes', policies)).toEqual({ kind: 'free' });

    policyRepo.emit([fakePolicy({ policyKind: 'ceiling', policyValue: '15' })]);

    expect(deriveSettingRowState('auto_lock_timeout_minutes', policies)).toEqual({ kind: 'ceiling', value: '15' });
  });
});
