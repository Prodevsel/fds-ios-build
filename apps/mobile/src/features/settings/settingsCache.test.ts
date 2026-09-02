import { beforeEach, describe, expect, it, vi } from 'vitest';

// Node test environment: react-native-mmkv is a native Nitro module — never
// loaded in this test, since every test injects a fake storage (mirrors
// leaderboardCache.test.ts's fake-db pattern). If a test accidentally hits
// the default storage path this mock keeps the suite from crashing while
// still making the miss obvious (constructor throws would fail loudly).
vi.mock('react-native-mmkv', () => ({
  createMMKV: vi.fn(() => {
    throw new Error('MMKV native module must never be constructed in unit tests');
  }),
}));

import { createSettingsCache, type CacheStorage, type SettingsSnapshot } from './settingsCache';

function fakeStorage(): CacheStorage & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getString: vi.fn((key: string) => store.get(key)),
    set: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
  };
}

describe('settingsCache (write-through-only MMKV boot cache, D-16)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null from get() when nothing is stored', () => {
    const storage = fakeStorage();
    const cache = createSettingsCache({ storage });

    expect(cache.get()).toBeNull();
  });

  it('round-trips a SettingsSnapshot through set()/get()', () => {
    const storage = fakeStorage();
    const cache = createSettingsCache({ storage });
    const snapshot: SettingsSnapshot = {
      language: 'de',
      theme: 'dark',
      textSize: 'large',
      highContrast: true,
    };

    cache.set(snapshot);

    expect(cache.get()).toEqual(snapshot);
  });

  it('never throws on malformed stored JSON — falls back to a cache miss', () => {
    const storage = fakeStorage();
    storage.store.set('snapshot', 'not-json{{');
    const cache = createSettingsCache({ storage });

    expect(cache.get()).toBeNull();
  });

  it('does not construct the default MMKV storage when an injected storage is provided', () => {
    const storage = fakeStorage();
    expect(() => createSettingsCache({ storage })).not.toThrow();
  });

  it('importing the module under vitest/node does not construct MMKV', async () => {
    const mod = await import('./settingsCache');
    expect(mod.createSettingsCache).toBeTypeOf('function');
  });
});
