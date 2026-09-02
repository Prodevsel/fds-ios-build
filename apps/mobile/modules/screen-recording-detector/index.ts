import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

/**
 * D-14b (SEC-05, 15-CONTEXT.md; plan 15-09): a small local Expo module
 * wrapping `UIScreen.isCaptured` + `UIScreen.capturedDidChangeNotification`
 * (iOS) — the mechanism `expo-screen-capture@56.0.5` does NOT ship at this
 * pin (15-RESEARCH.md Pitfall 5, verified against the shipped `.d.ts`).
 * Android's `isSupported()` is false (D-13 already blocks capture outright
 * via `FLAG_SECURE`, see the Kotlin module's header).
 *
 * `requireOptionalNativeModule` (never `requireNativeModule`) is the whole
 * point: the native half only exists after the next dev-client rebuild
 * (15-DEV-CLIENT-REBUILD.md). Until then — and in Expo Go, and on any build
 * predating this module — `nativeModule` resolves to `null` and every
 * export below degrades to the safe "nothing is being detected" answer.
 * NOTHING in this file may throw; a scan screen must never crash because a
 * detection module happens to be missing (T-15-09-03).
 */
interface NativeCaptureChangeEvent {
  captured: boolean;
}

interface NativeScreenRecordingDetectorModule {
  isSupported(): boolean;
  isCaptured(): boolean;
  addListener(eventName: 'onCaptureChange', listener: (event: NativeCaptureChangeEvent) => void): EventSubscription;
}

const nativeModule = requireOptionalNativeModule<NativeScreenRecordingDetectorModule>(
  'ScreenRecordingDetector',
);

/** false on any platform/build where detection is not available — never throws. */
export function isSupported(): boolean {
  try {
    return nativeModule?.isSupported() ?? false;
  } catch {
    return false;
  }
}

/** current capture state; always false when isSupported() is false. */
export function isCaptured(): boolean {
  if (!isSupported()) {
    return false;
  }
  try {
    return nativeModule?.isCaptured() ?? false;
  } catch {
    return false;
  }
}

export interface CaptureChangeSubscription {
  remove(): void;
}

/**
 * Subscribes to capture-state changes. Returns an inert (no-op) subscription
 * when the native module is absent or detection is unsupported — a caller
 * never needs to branch on `isSupported()` before subscribing.
 */
export function addCaptureChangeListener(
  cb: (captured: boolean) => void,
): CaptureChangeSubscription {
  if (!nativeModule || !isSupported()) {
    return { remove: () => {} };
  }
  try {
    const subscription = nativeModule.addListener('onCaptureChange', (event) => {
      cb(event.captured);
    });
    return { remove: () => subscription.remove() };
  } catch {
    return { remove: () => {} };
  }
}
