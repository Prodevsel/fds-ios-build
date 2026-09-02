import { describe, expect, it, vi } from 'vitest';

// Node test environment (vitest.config.ts): never load the native
// expo-secure-store/expo-crypto modules — only `defaultPinDeps` references
// them, and every test here exercises the exported functions against fully
// injected fakes (getDeviceId.test.ts precedent).
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));
vi.mock('expo-crypto', () => ({
  getRandomBytesAsync: vi.fn(),
  digestStringAsync: vi.fn(),
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
}));

import {
  clearPinCredential,
  createPinCredential,
  hasPinCredential,
  isValidPinFormat,
  PIN_HASH_ALIAS,
  PIN_SALT_ALIAS,
  verifyPin,
  type PinCrypto,
  type PinDeps,
  type PinStore,
} from './pinHash';

interface RecordedWrite {
  key: string;
  value: string;
  options?: unknown;
}

function makeFakeStore() {
  const entries = new Map<string, string>();
  const writes: RecordedWrite[] = [];
  const store: PinStore = {
    async getItemAsync(key: string) {
      return entries.get(key) ?? null;
    },
    async setItemAsync(key: string, value: string) {
      entries.set(key, value);
      writes.push({ key, value });
    },
    async deleteItemAsync(key: string) {
      entries.delete(key);
    },
  };
  return { store, entries, writes };
}

/** Simple, deterministic SHA-256-shaped fake — not real crypto, but salt-and-pin-sensitive like the real digest. */
function fakeDigestHex(input: string): Promise<string> {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Promise.resolve(`fakehash_${(h >>> 0).toString(16)}`);
}

let randomByteSeed = 0;
function makeFakeCrypto(): PinCrypto {
  return {
    async getRandomBytesAsync(n: number) {
      randomByteSeed += 1;
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        bytes[i] = (randomByteSeed * 7 + i) % 256;
      }
      return bytes;
    },
    digestHex: fakeDigestHex,
  };
}

function makeDeps(): PinDeps {
  const { store } = makeFakeStore();
  return { store, crypto: makeFakeCrypto() };
}

describe('isValidPinFormat', () => {
  it('accepts exactly 6 digits', () => {
    expect(isValidPinFormat('123456')).toBe(true);
  });

  it('rejects too short, too long, non-digit, empty and spaced input', () => {
    expect(isValidPinFormat('12345')).toBe(false);
    expect(isValidPinFormat('1234567')).toBe(false);
    expect(isValidPinFormat('12345a')).toBe(false);
    expect(isValidPinFormat('')).toBe(false);
    expect(isValidPinFormat('12 456')).toBe(false);
  });
});

describe('createPinCredential', () => {
  it('writes exactly two SecureStore keys and the hash never contains the plaintext pin', async () => {
    const { store, writes } = makeFakeStore();
    const deps: PinDeps = { store, crypto: makeFakeCrypto() };

    await createPinCredential('123456', deps);

    expect(writes).toHaveLength(2);
    expect(writes.map((w) => w.key).sort()).toEqual([PIN_HASH_ALIAS, PIN_SALT_ALIAS].sort());
    const hashWrite = writes.find((w) => w.key === PIN_HASH_ALIAS);
    expect(hashWrite?.value).toBeDefined();
    expect(hashWrite?.value).not.toContain('123456');
  });

  it('two credentials created from the SAME pin with different random salts produce DIFFERENT stored hashes', async () => {
    const { store: storeA } = makeFakeStore();
    const { store: storeB } = makeFakeStore();
    randomByteSeed = 0;

    await createPinCredential('123456', { store: storeA, crypto: makeFakeCrypto() });
    await createPinCredential('123456', { store: storeB, crypto: makeFakeCrypto() });

    const hashA = await storeA.getItemAsync(PIN_HASH_ALIAS);
    const hashB = await storeB.getItemAsync(PIN_HASH_ALIAS);
    const saltA = await storeA.getItemAsync(PIN_SALT_ALIAS);
    const saltB = await storeB.getItemAsync(PIN_SALT_ALIAS);

    expect(saltA).not.toBe(saltB);
    expect(hashA).not.toBe(hashB);
  });

  it('throws on a pin failing isValidPinFormat before touching the store (zero writes)', async () => {
    const { store, writes } = makeFakeStore();
    const deps: PinDeps = { store, crypto: makeFakeCrypto() };

    await expect(createPinCredential('12ab', deps)).rejects.toThrow();
    expect(writes).toHaveLength(0);
  });

  it('every setItemAsync call receives WHEN_UNLOCKED_THIS_DEVICE_ONLY in its options (via defaultPinDeps.store, the only real SecureStore call site)', async () => {
    const SecureStore = await import('expo-secure-store');
    const { defaultPinDeps } = await import('./pinHash');

    await defaultPinDeps.store.setItemAsync('some-key', 'some-value');

    const setItemAsyncMock = SecureStore.setItemAsync as unknown as ReturnType<typeof vi.fn>;
    expect(setItemAsyncMock).toHaveBeenCalledWith(
      'some-key',
      'some-value',
      expect.objectContaining({ keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
    );
  });
});

describe('verifyPin', () => {
  it('is true after creating with the same pin, false for a wrong pin', async () => {
    const deps = makeDeps();
    await createPinCredential('123456', deps);

    expect(await verifyPin('123456', deps)).toBe(true);
    expect(await verifyPin('654321', deps)).toBe(false);
  });

  it('resolves false (does not throw) with no stored credential', async () => {
    const deps = makeDeps();
    await expect(verifyPin('123456', deps)).resolves.toBe(false);
  });
});

describe('hasPinCredential / clearPinCredential', () => {
  it('clearPinCredential deletes both aliases and afterwards hasPinCredential is false', async () => {
    const deps = makeDeps();
    await createPinCredential('123456', deps);
    expect(await hasPinCredential(deps)).toBe(true);

    await clearPinCredential(deps);

    expect(await hasPinCredential(deps)).toBe(false);
  });

  // Re-signing an .ipa changes the keychain access group, and expo-secure-store
  // then REJECTS rather than resolving null. This used to propagate, leaving
  // AppLockProvider on its fail-secure isLocked:true default forever: a keypad
  // demanding a PIN that was never set, with no route to the setup screen.
  it('reports no credential when the keychain read throws, instead of rejecting', async () => {
    const deps = {
      ...makeDeps(),
      store: {
        getItemAsync: () => Promise.reject(new Error('keychain access group mismatch')),
        setItemAsync: () => Promise.resolve(),
        deleteItemAsync: () => Promise.resolve(),
      },
    } as unknown as Parameters<typeof hasPinCredential>[0];

    await expect(hasPinCredential(deps)).resolves.toBe(false);
  });
});

describe('production wiring (defaultPinDeps) — WHEN_UNLOCKED_THIS_DEVICE_ONLY on every write', () => {
  it('every setItemAsync call in the module source passes keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./pinHash.ts', import.meta.url));
    const source = readFileSync(sourcePath, 'utf-8');
    const setItemCalls = source.match(/SecureStore\.setItemAsync\([^)]*\)/gs) ?? [];
    expect(setItemCalls.length).toBeGreaterThan(0);
    for (const call of setItemCalls) {
      expect(call).toMatch(/WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
    }
  });

  it('the only expo-secure-store / expo-crypto imports are consumed exclusively by defaultPinDeps', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./pinHash.ts', import.meta.url));
    const source = readFileSync(sourcePath, 'utf-8');
    expect(source).toMatch(/import \* as Crypto from 'expo-crypto';/);
    expect(source).toMatch(/import \* as SecureStore from 'expo-secure-store';/);
    // Only defaultPinDeps' object literal references SecureStore./Crypto.
    const nonDefaultDepsSource = source.split('export const defaultPinDeps')[0] ?? '';
    expect(nonDefaultDepsSource).not.toMatch(/SecureStore\./);
    expect(nonDefaultDepsSource).not.toMatch(/Crypto\./);
  });
});

describe('header comment (D-11 / Android residual)', () => {
  it('contains D-11, Keystore, and 15-SECURITY.md', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./pinHash.ts', import.meta.url));
    const source = readFileSync(sourcePath, 'utf-8');
    expect(source).toContain('D-11');
    expect(source).toContain('Keystore');
    expect(source).toContain('15-SECURITY.md');
  });

  it('never console.logs a pin, salt, or hash', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./pinHash.ts', import.meta.url));
    const source = readFileSync(sourcePath, 'utf-8');
    expect(source).not.toMatch(/console\./);
  });
});
