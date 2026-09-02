import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

/**
 * SQLCipher key management (SYNC-03, 01-RESEARCH.md Pattern 2).
 *
 * The local database encryption key is:
 * - generated ONCE on first app launch (32 cryptographically random bytes),
 * - stored exclusively in the OS keychain/keystore via expo-secure-store with
 *   WHEN_UNLOCKED_THIS_DEVICE_ONLY (hardware-backed on Android, non-migratable
 *   on iOS — threat T-01-17: device theft),
 * - NEVER hardcoded, NEVER derived from a synced/server value (that would
 *   break offline-first and create a circular key-to-open-DB dependency),
 *   NEVER written to AsyncStorage or any PowerSync-synced table.
 */

/**
 * Stable keychain alias. Versioned so a future key-rotation scheme can
 * introduce `_v2` alongside without clobbering the existing key.
 */
export const SQLCIPHER_KEY_ALIAS = 'fds_sqlcipher_key_v1';

const KEY_BYTE_LENGTH = 32;

function toHex(bytes: Uint8Array): string {
  // No Buffer in React Native — manual hex encoding.
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Returns the existing SQLCipher key from the OS keychain/keystore, or
 * generates, persists, and returns a new one. Idempotent: every call after
 * the first returns the same key.
 */
export async function getOrCreateEncryptionKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(SQLCIPHER_KEY_ALIAS);
  if (existing) {
    return existing;
  }

  const bytes = await Crypto.getRandomBytesAsync(KEY_BYTE_LENGTH);
  const key = toHex(bytes);
  await SecureStore.setItemAsync(SQLCIPHER_KEY_ALIAS, key, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return key;
}

/**
 * SEC-07/SEC-08 (D-01/D-04, 15-RESEARCH.md Pitfall 1): unconditionally
 * generates and persists a FRESH SQLCipher key, overwriting whatever key
 * (if any) currently lives under `SQLCIPHER_KEY_ALIAS` — this is
 * `getOrCreateEncryptionKey`'s exact body MINUS the "return existing" branch.
 *
 * This is the reason a surviving fragment of a wiped SQLite file stays
 * unreadable: `wipeMachinery.ts`'s drain-then-purge sequence deletes the
 * main/-wal/-shm files and THEN calls this function last, so even if some
 * byte range of the old encrypted file somehow survives on disk (a free-list
 * page, an OS filesystem quirk), the key that could have decrypted it no
 * longer exists anywhere. A wipe that reused `getOrCreateEncryptionKey`
 * instead would silently keep the OLD key valid — precisely the key-reuse
 * gap Pitfall 1/T-15-10-04 warn about. Never call this outside a wipe flow.
 */
export async function regenerateEncryptionKey(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(KEY_BYTE_LENGTH);
  const key = toHex(bytes);
  await SecureStore.setItemAsync(SQLCIPHER_KEY_ALIAS, key, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return key;
}
