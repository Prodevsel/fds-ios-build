import { describe, expect, it, vi } from 'vitest';

// Node test environment (vitest.config.ts): never load the native
// expo-application/expo-secure-store/expo-crypto/react-native modules —
// only the default-wiring functions reference them, and every test here
// exercises getDeviceId() with fully injected deps (mirrors
// flowDraftsRepo.test.ts's expo-crypto stub pattern).
vi.mock('expo-application', () => ({ getAndroidId: vi.fn(), getIosIdForVendorAsync: vi.fn() }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'unused-default-uuid') }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

import { getDeviceId, type GetDeviceIdDeps, type NativeIdResult } from './getDeviceId';

/**
 * D-21: device-identity race must never block signing. getDeviceId retries
 * a nil native id once, then falls back to a persisted UUID — and never
 * throws to the caller regardless of what the injected deps do.
 */

function makeFakeSecureStore() {
  const entries = new Map<string, string>();
  return {
    entries,
    store: {
      async getItemAsync(key: string) {
        return entries.get(key) ?? null;
      },
      async setItemAsync(key: string, value: string) {
        entries.set(key, value);
      },
      async deleteItemAsync(key: string) {
        entries.delete(key);
      },
    },
  };
}

function makeDeps(overrides: Partial<GetDeviceIdDeps> = {}): GetDeviceIdDeps {
  const { store } = makeFakeSecureStore();
  return {
    getNativeId: async () => ({ id: 'native-id-1', source: 'idfv' as const }),
    secureStore: store,
    generateUuid: () => 'generated-uuid-1',
    ...overrides,
  };
}

describe('getDeviceId', () => {
  it('returns the native id + source when it resolves on the first call', async () => {
    const result = await getDeviceId(makeDeps());
    expect(result).toEqual({ deviceId: 'native-id-1', deviceIdSource: 'idfv' });
  });

  it('retries once on a nil native id and succeeds on the retry', async () => {
    let calls = 0;
    const deps = makeDeps({
      getNativeId: async (): Promise<NativeIdResult | null> => {
        calls += 1;
        if (calls === 1) return null;
        return { id: 'android-id-1', source: 'androidId' };
      },
    });
    const result = await getDeviceId(deps);
    expect(calls).toBe(2);
    expect(result).toEqual({ deviceId: 'android-id-1', deviceIdSource: 'androidId' });
  });

  it('falls back to a generated + persisted uuid when the native id stays nil after one retry', async () => {
    const { store, entries } = makeFakeSecureStore();
    const deps = makeDeps({ getNativeId: async () => null, secureStore: store });
    const result = await getDeviceId(deps);
    expect(result).toEqual({ deviceId: 'generated-uuid-1', deviceIdSource: 'fallback-uuid' });
    expect(entries.size).toBe(1);
  });

  it('reuses a previously-persisted fallback uuid instead of generating a new one', async () => {
    const { store, entries } = makeFakeSecureStore();
    entries.set('fds_device_id_fallback_uuid', 'already-persisted-uuid');
    let generateCalls = 0;
    const deps = makeDeps({
      getNativeId: async () => null,
      secureStore: store,
      generateUuid: () => {
        generateCalls += 1;
        return 'should-not-be-used';
      },
    });
    const result = await getDeviceId(deps);
    expect(result).toEqual({ deviceId: 'already-persisted-uuid', deviceIdSource: 'fallback-uuid' });
    expect(generateCalls).toBe(0);
  });

  it('never throws even when getNativeId rejects on every call', async () => {
    const deps = makeDeps({
      getNativeId: async () => {
        throw new Error('native id reader exploded');
      },
    });
    await expect(getDeviceId(deps)).resolves.toEqual({
      deviceId: 'generated-uuid-1',
      deviceIdSource: 'fallback-uuid',
    });
  });

  it('never throws even when the secure store rejects on every call', async () => {
    const deps = makeDeps({
      getNativeId: async () => null,
      secureStore: {
        async getItemAsync() {
          throw new Error('secure store read failed');
        },
        async setItemAsync() {
          throw new Error('secure store write failed');
        },
        async deleteItemAsync() {
          throw new Error('secure store delete failed');
        },
      },
    });
    const result = await getDeviceId(deps);
    expect(result.deviceIdSource).toBe('fallback-uuid');
    expect(typeof result.deviceId).toBe('string');
  });
});
