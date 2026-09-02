import * as LocalAuthentication from 'expo-local-authentication';

/**
 * Biometric fast-path capability probe and error classification (D-10,
 * 15-UI-SPEC.md §1's "Biometric fast path" row).
 *
 * D-09 (15-CONTEXT.md, non-negotiable on these shared company tablets): the
 * app owns the PIN, never the OS passcode. `authenticateAsync` is ALWAYS
 * called with `disableDeviceFallback: true` — delegating to
 * `LAPolicyDeviceOwnerAuthentication` (the OS-passcode fallback Apple/Android
 * offer after repeated biometric failures) would make the app lock identical
 * to unlocking the tablet itself, defeating SEC-03 outright and pre-empting
 * Phase 19's rep-to-rep handover model, which depends on the app lock being a
 * SEPARATE credential from the device's own passcode.
 *
 * D-10, load-bearing for every caller of this module: NO outcome produced
 * here may ever advance `pinAttempts.ts`'s failed-attempt counter. A
 * `{kind:'unavailable', ...}` or `{kind:'failed', ...}` outcome is a sensor
 * problem (no hardware, nothing enrolled, a cancelled/failed system prompt) —
 * not a wrong PIN. The caller (`AppLockGate.tsx`) must route every non-
 * success outcome straight to the PIN keypad fallback with
 * `sec.biometricFallbackHint`, and must NEVER call `pinAttempts.recordFailure`
 * for it. This module deliberately exposes no such counter-advancing entry
 * point itself — the discipline lives entirely in the caller, which is why
 * this rule is repeated here in the one place a future edit is most likely to
 * violate it by accident.
 *
 * `BiometricDeps` is structural (mirrors `pinHash.ts`'s `PinStore`/`PinCrypto`
 * and `getDeviceId.ts`'s `SecureStoreLike`) so every function below except
 * `defaultBiometricDeps` unit-tests under vitest/node with plain fakes — no
 * native mock required. `defaultBiometricDeps` is the ONLY place
 * `expo-local-authentication` is imported for actual use.
 */

export type BiometricOutcome =
  | { kind: 'success' }
  | { kind: 'unavailable'; reason: 'no_hardware' | 'not_enrolled' }
  | { kind: 'failed'; reason: 'user_cancel' | 'system_cancel' | 'lockout' | 'sensor_error' };

export interface BiometricDeps {
  hasHardwareAsync(): Promise<boolean>;
  isEnrolledAsync(): Promise<boolean>;
  supportedTypesAsync(): Promise<number[]>;
  authenticateAsync(opts: { disableDeviceFallback: boolean }): Promise<{ success: boolean; error?: string }>;
}

/**
 * Maps `expo-local-authentication@56.0.5`'s verified `LocalAuthenticationError`
 * union (`LocalAuthentication.types.d.ts` — 'not_enrolled' | 'user_cancel' |
 * 'app_cancel' | 'not_available' | 'lockout' | 'no_space' | 'timeout' |
 * 'unable_to_process' | 'unknown' | 'system_cancel' | 'user_fallback' |
 * 'invalid_context' | 'passcode_not_set' | 'authentication_failed') onto the
 * narrower `BiometricOutcome` this module publishes. `BiometricOutcome` only
 * distinguishes the cases callers act on differently (D-10); everything else
 * — including every unrecognized/undefined value — collapses to
 * `{kind:'failed', reason:'sensor_error'}`, which is the SAME fallback route
 * as a genuine sensor error (straight to the PIN keypad). This is a
 * deliberate fail-safe: an outcome from this function is NEVER `success`
 * unless `authenticateAsync` itself reported `success: true` — there is no
 * path from an unrecognized error string to a false "unlocked".
 */
export function classifyBiometricError(error: string | undefined): BiometricOutcome {
  switch (error) {
    case 'not_enrolled':
      return { kind: 'unavailable', reason: 'not_enrolled' };
    case 'not_available':
      return { kind: 'unavailable', reason: 'no_hardware' };
    case 'lockout':
      return { kind: 'failed', reason: 'lockout' };
    case 'user_cancel':
      return { kind: 'failed', reason: 'user_cancel' };
    case 'system_cancel':
      return { kind: 'failed', reason: 'system_cancel' };
    default:
      return { kind: 'failed', reason: 'sensor_error' };
  }
}

/**
 * Capability probe + prompt, in that order. Hardware/enrollment are checked
 * BEFORE ever calling `authenticateAsync`, so a device with no sensor or
 * nothing enrolled never shows a system biometric dialog at all — both
 * short-circuits return directly, matching `<behavior>`'s "never calls
 * authenticateAsync" requirement.
 */
export async function attemptBiometricUnlock(deps: BiometricDeps): Promise<BiometricOutcome> {
  const hasHardware = await deps.hasHardwareAsync();
  if (!hasHardware) {
    return { kind: 'unavailable', reason: 'no_hardware' };
  }

  const isEnrolled = await deps.isEnrolledAsync();
  if (!isEnrolled) {
    return { kind: 'unavailable', reason: 'not_enrolled' };
  }

  // D-09: disableDeviceFallback is ALWAYS true — see file header. Never
  // pass false here, even conditionally; the OS passcode must never
  // satisfy this app's lock on a shared company tablet.
  const result = await deps.authenticateAsync({ disableDeviceFallback: true });
  if (result.success) {
    return { kind: 'success' };
  }
  return classifyBiometricError(result.error);
}

/**
 * German biometric label for `sec.biometricUnlockCta`'s `{{biometricLabel}}`
 * interpolation, sourced from the device's REPORTED enrolled type — never a
 * hardcoded platform name chosen without reading `supportedTypesAsync`.
 * `AuthenticationType.FACIAL_RECOGNITION = 2`, `FINGERPRINT = 1`
 * (`expo-local-authentication@56.0.5`'s verified `AuthenticationType` enum).
 * Android always reads "Fingerabdruck" per 15-UI-SPEC.md §1 regardless of
 * which type is reported (the platform's system prompt itself already
 * disambiguates fingerprint vs. face/iris; the CTA copy does not need to).
 */
export function biometricLabelFor(supportedTypes: number[], platform: 'ios' | 'android'): string {
  if (platform === 'android') {
    return 'Fingerabdruck';
  }
  // iOS: FACIAL_RECOGNITION (2) takes precedence when both are somehow
  // reported, since Face ID devices never also carry Touch ID hardware.
  if (supportedTypes.includes(2)) {
    return 'Face ID';
  }
  if (supportedTypes.includes(1)) {
    return 'Touch ID';
  }
  // Defensive fallback — reachable only if `attemptBiometricUnlock` somehow
  // gets called after enrollment without a recognized type; never a bare
  // English/platform-internal string.
  return 'Biometrie';
}

/**
 * Production wiring — the ONLY place `expo-local-authentication` is imported
 * for actual use, so the rest of this module unit-tests under vitest/node
 * with plain fakes (`pinHash.ts`'s `defaultPinDeps` precedent).
 */
export const defaultBiometricDeps: BiometricDeps = {
  hasHardwareAsync: () => LocalAuthentication.hasHardwareAsync(),
  isEnrolledAsync: () => LocalAuthentication.isEnrolledAsync(),
  supportedTypesAsync: () => LocalAuthentication.supportedAuthenticationTypesAsync(),
  authenticateAsync: async ({ disableDeviceFallback }) => {
    const result = await LocalAuthentication.authenticateAsync({ disableDeviceFallback });
    return result.success ? { success: true } : { success: false, error: result.error };
  },
};
