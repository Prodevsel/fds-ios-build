import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as ScreenCapture from 'expo-screen-capture';

/**
 * D-13/D-14a (SEC-05, 15-CONTEXT.md, plan 15-08): one-shot, app-wide screen
 * capture protection.
 *
 * ============================================================================
 * BINDING HONESTY RULE (15-UI-SPEC.md §4, "Reporting honesty"):
 * iOS cannot block screenshots, full stop. Nothing in this module or any of
 * its callers may present iOS behaviour as prevention. Android gets real
 * `FLAG_SECURE` blocking (T-15-08-01); iOS only gets (a) the app-switcher
 * snapshot covered natively (D-14a, T-15-08-02) and (c) a silent, after-the-
 * fact `scan_telemetry` record when a screenshot is detected on an ID/IBAN
 * screen (D-14c, see `sensitiveScreen.ts`). SEC-05 is reported as fully met
 * on Android, PARTIALLY met on iOS with that named residual — never rounded
 * up to "done". A future help/legal screen author MUST reuse
 * 15-UI-SPEC.md §4's exact platform-distinguishing copy, not invent new
 * wording that blurs this line.
 *
 * D-14b (screen-*recording* detection / field blanking) is NOT available at
 * the pinned `expo-screen-capture@56.0.5` — confirmed by reading the
 * installed `.d.ts` directly (no screen-recording listener export of any
 * name exists in this package at this version, per 15-RESEARCH.md Pitfall 5).
 * It is plan 15-09's own scoped native work. A caller must NOT invent a call
 * to a non-existent recording-detection API here.
 * ============================================================================
 *
 * D-13's own reasoning: `FLAG_SECURE` is per-Activity, and this Expo app is
 * effectively single-Activity, so toggling it per screen is racy and known
 * to flicker or fail outright on some OEMs. There is deliberately NO
 * per-screen enable/disable API in this module — "no screenshots anywhere"
 * is the correct default for a tool holding customer identity documents, not
 * a regression. `initScreenProtection` is called ONCE at app boot and is
 * guarded by a module-level already-initialized flag so a re-render or a
 * remount can never re-toggle the underlying native flag.
 *
 * D-14a: on iOS, `enableAppSwitcherProtectionAsync` is a NATIVE hook on the
 * OS's own "resigned active" lifecycle event — it applies the blur BEFORE
 * the OS captures its app-switcher snapshot. A JS `AppState`-driven overlay
 * must NOT be built for this: it would race the OS snapshot over a JS bridge
 * round-trip, which is exactly the class of bug this native API exists to
 * avoid (15-RESEARCH.md Pattern 1). This is a different concern from
 * `useAppStateLock` (15-07's app-LOCK-on-background mechanism) — this module
 * only ever covers the SNAPSHOT, never decides whether the app is locked.
 *
 * `ScreenCaptureDeps` is structural (mirrors `biometrics.ts`'s `BiometricDeps`
 * / `pinHash.ts`'s DI convention) so this module unit-tests under vitest/node
 * with plain fakes — no native mock required. `defaultScreenCaptureDeps` is
 * the ONLY place `expo-screen-capture` and `react-native`'s `Platform` are
 * imported.
 */

export interface ScreenshotSubscriptionLike {
  remove(): void;
}

export interface ScreenCaptureDeps {
  platform: 'ios' | 'android';
  preventScreenCaptureAsync(): Promise<void>;
  enableAppSwitcherProtectionAsync(blurIntensity: number): Promise<void>;
  addScreenshotListener(cb: () => void): ScreenshotSubscriptionLike;
}

/** D-14a: near-opaque scrim intensity (15-UI-SPEC.md's ~92% branded cover). */
export const APP_SWITCHER_BLUR_INTENSITY = 0.9;

// Module-level guard (D-13): a re-render or remount must never re-toggle the
// underlying native flag. This is intentionally NOT component state.
let initialized = false;

/**
 * Enables app-wide capture protection exactly once. Android: FLAG_SECURE via
 * `preventScreenCaptureAsync` only (D-13 — no per-screen toggling exists).
 * iOS: BOTH `preventScreenCaptureAsync` (covers screenshots/recordings where
 * the OS honors it, iOS 11+/13+) AND `enableAppSwitcherProtectionAsync`
 * (D-14a, the app-switcher-snapshot cover). A rejection from either call is
 * swallowed — this must never throw out of app boot, and a failure in the
 * app-switcher call must not prevent the screenshot-prevention call (or vice
 * versa) from having been attempted.
 */
export async function initScreenProtection(deps: ScreenCaptureDeps): Promise<void> {
  if (initialized) {
    return;
  }
  initialized = true;

  try {
    await deps.preventScreenCaptureAsync();
  } catch {
    // Best-effort: a native rejection here must not block app boot or
    // prevent the iOS app-switcher call below from being attempted.
  }

  if (deps.platform === 'ios') {
    try {
      await deps.enableAppSwitcherProtectionAsync(APP_SWITCHER_BLUR_INTENSITY);
    } catch {
      // Best-effort — see preventScreenCaptureAsync's catch above.
    }
  }
}

/** Test-only reset is deliberately NOT exported — see useScreenCapture.test.ts's vi.resetModules() convention. */

/**
 * Attaches a screenshot listener and returns a detach function. Pure
 * wiring — the actual D-14c telemetry decision (was an ID/IBAN screen
 * mounted?) lives in `sensitiveScreen.ts`'s registry, read by the caller's
 * `onScreenshot` callback, not here.
 */
export function attachScreenshotListener(
  deps: Pick<ScreenCaptureDeps, 'addScreenshotListener'>,
  onScreenshot: () => void,
): () => void {
  const subscription = deps.addScreenshotListener(onScreenshot);
  return () => subscription.remove();
}

/**
 * Boot-time hook: calls `initScreenProtection` once (idempotent) and attaches
 * the screenshot listener for the lifetime of the mounting component
 * (`RootNavigator`, mounted exactly once at boot level, outside the session
 * gate — protection must apply to the Login screen too).
 */
export function useScreenCapture(onScreenshot: () => void): void {
  useEffect(() => {
    void initScreenProtection(defaultScreenCaptureDeps);
    return attachScreenshotListener(defaultScreenCaptureDeps, onScreenshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onScreenshot is
    // read fresh via the caller's own currentSensitiveScreen() lookup inside
    // the callback body; re-subscribing on every render identity change would
    // add/remove native listeners for no behavioral benefit.
  }, []);
}

/**
 * Production wiring — the ONLY place `expo-screen-capture` and `Platform`
 * are imported for actual use.
 */
export const defaultScreenCaptureDeps: ScreenCaptureDeps = {
  platform: Platform.OS === 'ios' ? 'ios' : 'android',
  preventScreenCaptureAsync: () => ScreenCapture.preventScreenCaptureAsync(),
  enableAppSwitcherProtectionAsync: (blurIntensity) =>
    ScreenCapture.enableAppSwitcherProtectionAsync(blurIntensity),
  addScreenshotListener: (cb) => ScreenCapture.addScreenshotListener(cb),
};
