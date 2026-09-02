/**
 * Clears app-lock state left behind by a previous install.
 *
 * iOS keychain items OUTLIVE app deletion — that is the documented behaviour,
 * not a bug in expo-secure-store. Both the PIN credential and the failed-attempt
 * counter live there (`pinHash.ts`, `pinAttempts.ts` via SecureStore), so
 * deleting and reinstalling the app restores the lockout instead of clearing it:
 * a rep who is locked out of a build has no route back in, and re-sideloading —
 * the obvious thing to try — changes nothing.
 *
 * The marker below lives in MMKV, which is app-container storage and IS removed
 * on uninstall. Absent marker therefore means "first launch of a fresh install",
 * and any keychain state found at that moment belongs to an install that no
 * longer exists.
 *
 * Deliberately NOT fail-secure in the usual sense: a fresh install has no local
 * data to protect yet: PowerSync's database went with the old container. The
 * Supabase session is what gates access to anything real, and it is gone too.
 */
const MARKER_ID = 'app-lock-install';
const MARKER_KEY = 'installed';

export interface FreshInstallDeps {
  storage: { getString(key: string): string | undefined; set(key: string, value: string): void };
  clearPin(): Promise<void>;
  clearAttempts(): Promise<void>;
}

/** True when this launch was the first of a fresh install (state was cleared). */
export async function resetAppLockOnFreshInstall(deps: FreshInstallDeps): Promise<boolean> {
  let alreadyInstalled: boolean;
  try {
    alreadyInstalled = deps.storage.getString(MARKER_KEY) !== undefined;
  } catch {
    // An unreadable marker store must not wipe a working install's PIN.
    return false;
  }
  if (alreadyInstalled) {
    return false;
  }
  try {
    await deps.clearPin();
    await deps.clearAttempts();
  } catch {
    // Best effort: a keychain that refuses deletion is the same situation
    // hasPinCredential already treats as "no credential".
  }
  try {
    deps.storage.set(MARKER_KEY, new Date().toISOString());
  } catch {
    // Without the marker this repeats next launch, which is harmless.
  }
  return true;
}

/** MMKV instance id for the marker; the store itself is built by the caller so
 * this module stays importable without the native layer (and unit-testable). */
export const INSTALL_MARKER_MMKV_ID = MARKER_ID;
