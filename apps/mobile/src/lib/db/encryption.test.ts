import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SYNC-03: the SQLCipher key is generated once (32 random bytes), stored in the
 * OS keychain/keystore via expo-secure-store with
 * WHEN_UNLOCKED_THIS_DEVICE_ONLY, and returned unchanged on every later call.
 * Never hardcoded, never derived from a synced value (01-RESEARCH.md Pattern 2).
 */

// In-memory keychain double — expo-secure-store is a native module and must
// never load in the Node test environment.
const keychain = new Map<string, string>();

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (key: string) => keychain.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    keychain.set(key, value);
  }),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));

let randomCallCount = 0;
vi.mock('expo-crypto', () => ({
  getRandomBytesAsync: vi.fn(async (byteCount: number) => {
    // Distinct bytes per call so a second (buggy) generation would be detected.
    randomCallCount += 1;
    return new Uint8Array(byteCount).map((_, i) => (i + randomCallCount) % 256);
  }),
}));

import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { SQLCIPHER_KEY_ALIAS, getOrCreateEncryptionKey, regenerateEncryptionKey } from './encryption';

describe('getOrCreateEncryptionKey (SYNC-03)', () => {
  beforeEach(() => {
    keychain.clear();
    randomCallCount = 0;
    vi.clearAllMocks();
  });

  it('generates a 32-byte (64 hex chars) random key on first call', async () => {
    const key = await getOrCreateEncryptionKey();

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(Crypto.getRandomBytesAsync).toHaveBeenCalledExactlyOnceWith(32);
  });

  it('stores the key under the stable alias with WHEN_UNLOCKED_THIS_DEVICE_ONLY', async () => {
    const key = await getOrCreateEncryptionKey();

    expect(SecureStore.setItemAsync).toHaveBeenCalledExactlyOnceWith(SQLCIPHER_KEY_ALIAS, key, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  });

  it('is idempotent: a second call returns the SAME key without regenerating', async () => {
    const first = await getOrCreateEncryptionKey();
    const second = await getOrCreateEncryptionKey();

    expect(second).toBe(first);
    // Random generation and keychain write happen exactly once, on first call.
    expect(Crypto.getRandomBytesAsync).toHaveBeenCalledTimes(1);
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
  });

  it('returns an existing keychain key without generating a new one', async () => {
    keychain.set(SQLCIPHER_KEY_ALIAS, 'a'.repeat(64));

    const key = await getOrCreateEncryptionKey();

    expect(key).toBe('a'.repeat(64));
    expect(Crypto.getRandomBytesAsync).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });
});

describe('regenerateEncryptionKey (SEC-07/SEC-08, D-01/D-04, Pitfall 1/T-15-10-04)', () => {
  beforeEach(() => {
    keychain.clear();
    randomCallCount = 0;
    vi.clearAllMocks();
  });

  it('always generates a fresh key, even when one already exists (NO return-existing branch)', async () => {
    keychain.set(SQLCIPHER_KEY_ALIAS, 'a'.repeat(64));

    const key = await regenerateEncryptionKey();

    expect(key).not.toBe('a'.repeat(64));
    expect(Crypto.getRandomBytesAsync).toHaveBeenCalledExactlyOnceWith(32);
  });

  it('overwrites the stored key under the SAME stable alias with WHEN_UNLOCKED_THIS_DEVICE_ONLY', async () => {
    const key = await regenerateEncryptionKey();

    expect(SecureStore.setItemAsync).toHaveBeenCalledExactlyOnceWith(SQLCIPHER_KEY_ALIAS, key, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    expect(await SecureStore.getItemAsync(SQLCIPHER_KEY_ALIAS)).toBe(key);
  });

  it('two successive calls produce DIFFERENT keys — never reuses (T-15-10-04)', async () => {
    const first = await regenerateEncryptionKey();
    const second = await regenerateEncryptionKey();

    expect(second).not.toBe(first);
    expect(Crypto.getRandomBytesAsync).toHaveBeenCalledTimes(2);
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(2);
  });
});
