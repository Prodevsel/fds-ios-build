import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

/**
 * PIN credential storage — the primitive D-11 (15-CONTEXT.md) rests on.
 *
 * D-11: the PIN itself is NEVER stored, logged, or rendered in cleartext.
 * Only a salted SHA-256 digest reaches `expo-secure-store`, keyed by a
 * per-install random salt (16 random bytes, hex-encoded) — the same
 * salt+hash+SecureStore shape `lib/db/encryption.ts` already uses for the
 * SQLCipher key (`toHex` copied verbatim, `_v1`-versioned aliases,
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY` on every write).
 *
 * NO KDF (PBKDF2/Argon2/scrypt) is used here, and that is a considered
 * decision, not an oversight: `expo-crypto@56.0.4` ships no such primitive
 * (digest/HMAC + random bytes only — 15-RESEARCH.md, confirmed against the
 * shipped `.d.ts`), and per 15-RESEARCH.md Pattern 2, no iteration count
 * would change the outcome anyway. A 6-digit PIN has at most 1,000,000
 * candidates — trivial for any offline attacker who already holds the
 * salted hash, however slow the KDF. The control that actually matters
 * against that attacker is that extracting the hash+salt at all requires
 * defeating `expo-secure-store`'s hardware-backed storage (Android
 * Keystore/StrongBox, iOS Keychain) — i.e. a much stronger compromise
 * (root/jailbreak + device unlock) than the PIN is meant to resist. Against
 * an attacker who does NOT have filesystem access and is only trying PINs
 * through the app UI, D-12's exponential-backoff + wipe-at-10 policy
 * (`pinAttempts.ts`) is the real defense, not this module's hash strength.
 * Do not "fix" this by adding a KDF — it does not close the offline-
 * extraction threat and would just add latency to every unlock.
 *
 * ACCEPTED RESIDUAL (Android, 15-RESEARCH.md Pitfall 3, registered in
 * 15-SECURITY.md by plan 15-15): `expo-secure-store`'s Android
 * implementation is Keystore-backed, and Android's "clear app data" action
 * deletes ALL of the app's Keystore-tied entries at once — this PIN
 * credential (`fds_pin_hash_v1`/`fds_pin_salt_v1`), the D-12 attempt
 * counter (`fds_pin_attempts_v1`), the Supabase session, and the SQLCipher
 * key together (same SecureStore-backed storage throughout this app). The
 * practical result of "clearing app data to bypass the PIN" on Android is
 * therefore a logged-out, freshly-onboarded app with an UNDECRYPTABLE local
 * database — not an attacker reading ID/IBAN data. SEC-03's confidentiality
 * guarantee survives; only the 10-attempt lockout policy specifically does
 * not survive on Android. iOS Keychain items have historically persisted
 * across app deletion (undocumented Apple behavior, not guaranteed), so
 * this asymmetry is iOS-only.
 */

const PIN_LENGTH = 6;
const SALT_BYTE_LENGTH = 16;

export const PIN_HASH_ALIAS = 'fds_pin_hash_v1';
export const PIN_SALT_ALIAS = 'fds_pin_salt_v1';

/** Structural, NOT an import of expo-secure-store's own type — mirrors `getDeviceId.ts`'s `SecureStoreLike`. */
export interface PinStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/** Structural, NOT an import of expo-crypto's own type. */
export interface PinCrypto {
  getRandomBytesAsync(n: number): Promise<Uint8Array>;
  /** SHA-256 hex digest of `input`. */
  digestHex(input: string): Promise<string>;
}

export interface PinDeps {
  store: PinStore;
  crypto: PinCrypto;
}

/** Exactly 6 digits, 0-9 only — no letters, no separators, no other length. */
export function isValidPinFormat(pin: string): boolean {
  return typeof pin === 'string' && pin.length === PIN_LENGTH && /^\d{6}$/.test(pin);
}

function toHex(bytes: Uint8Array): string {
  // No Buffer in React Native — manual hex encoding (encryption.ts precedent).
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Creates a new PIN credential, overwriting any existing one. Throws
 * (without touching the store) if `pin` fails `isValidPinFormat` — an
 * invalid PIN must never reach storage, not even transiently.
 */
export async function createPinCredential(pin: string, deps: PinDeps): Promise<void> {
  if (!isValidPinFormat(pin)) {
    throw new Error('createPinCredential: pin must be exactly 6 digits');
  }

  const saltBytes = await deps.crypto.getRandomBytesAsync(SALT_BYTE_LENGTH);
  const salt = toHex(saltBytes);
  const hash = await deps.crypto.digestHex(salt + pin);

  await deps.store.setItemAsync(PIN_HASH_ALIAS, hash);
  await deps.store.setItemAsync(PIN_SALT_ALIAS, salt);
}

/**
 * Verifies `pin` against the stored credential. Resolves `false` (never
 * throws) when no credential exists — unlike `getOrCreateEncryptionKey`,
 * this module NEVER lazily creates a credential on read. PIN creation is an
 * explicit rep action on the setup screen only.
 */
export async function verifyPin(pin: string, deps: PinDeps): Promise<boolean> {
  const [storedHash, storedSalt] = await Promise.all([
    deps.store.getItemAsync(PIN_HASH_ALIAS),
    deps.store.getItemAsync(PIN_SALT_ALIAS),
  ]);
  if (!storedHash || !storedSalt) {
    return false;
  }

  const candidateHash = await deps.crypto.digestHex(storedSalt + pin);
  return candidateHash === storedHash;
}

export async function hasPinCredential(deps: PinDeps): Promise<boolean> {
  // A keychain read can THROW, not merely return null. Re-signing an .ipa
  // (Sideloadly, a new provisioning profile, a changed team id) changes the
  // keychain access group, and expo-secure-store then rejects instead of
  // resolving. The caller in AppLockProvider defaults to isLocked:true until
  // this resolves, so a rejection left the app locked forever behind a keypad
  // for a PIN that was never set and cannot be set from that screen.
  //
  // Reporting "no credential" is the fail-secure answer here, not the lenient
  // one: a stored hash that cannot be read also cannot be verified, so the
  // lock screen would guard nothing while making the app unusable. The rep
  // still has to authenticate against Supabase, and re-enrolling a PIN
  // re-writes both aliases.
  try {
    const [storedHash, storedSalt] = await Promise.all([
      deps.store.getItemAsync(PIN_HASH_ALIAS),
      deps.store.getItemAsync(PIN_SALT_ALIAS),
    ]);
    return storedHash !== null && storedSalt !== null;
  } catch {
    return false;
  }
}

export async function clearPinCredential(deps: PinDeps): Promise<void> {
  await deps.store.deleteItemAsync(PIN_HASH_ALIAS);
  await deps.store.deleteItemAsync(PIN_SALT_ALIAS);
}

/**
 * Production wiring — the ONLY place `expo-secure-store`/`expo-crypto` are
 * imported for actual use in this file, so the rest of the module
 * unit-tests under vitest/node with no native mock (mirrors
 * `getDeviceId.ts`'s `defaultGetDeviceIdDeps`). Every `setItemAsync` call
 * passes `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (encryption.ts precedent).
 */
export const defaultPinDeps: PinDeps = {
  store: {
    getItemAsync: (key: string) => SecureStore.getItemAsync(key),
    setItemAsync: (key: string, value: string) =>
      SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
    deleteItemAsync: (key: string) => SecureStore.deleteItemAsync(key),
  },
  crypto: {
    getRandomBytesAsync: (n: number) => Crypto.getRandomBytesAsync(n),
    digestHex: (input: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input),
  },
};
