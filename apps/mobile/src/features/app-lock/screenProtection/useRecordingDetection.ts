import { useEffect, useState } from 'react';

import {
  addCaptureChangeListener,
  isCaptured,
  isSupported,
  type CaptureChangeSubscription,
} from '../../../../modules/screen-recording-detector';

/**
 * D-14b (SEC-05, 15-CONTEXT.md; plan 15-09): the field-blanking rule for an
 * active screen recording on iOS. `'unsupported'` deliberately collapses TWO
 * distinct runtime situations into one state:
 *
 *   1. Android — nothing blanks because `FLAG_SECURE` (D-13, plan 15-08)
 *      already makes the window un-capturable; there is nothing for a
 *      recording to see.
 *   2. iOS before the pending dev-client rebuild lands (or any build where
 *      the native module cannot load) — nothing blanks because detection
 *      genuinely does not exist yet on that binary; see
 *      `15-D14B-RECORDING-DETECTION.md`'s Named Fallback section.
 *
 * Both cases resolve to the exact same state and the exact same "blank
 * nothing" behavior — never a placeholder implying protection that is not
 * there (T-15-09-02). Only `'recording'` (real iOS detection, real native
 * module, real active capture) ever blanks a field.
 */
export type RecordingState = 'unsupported' | 'idle' | 'recording';

/** Pure: the whole D-14b state derivation, testable without any native module. */
export function deriveRecordingState(supported: boolean, captured: boolean): RecordingState {
  if (!supported) {
    return 'unsupported';
  }
  return captured ? 'recording' : 'idle';
}

/** Pure: true only while a recording is genuinely active and detected. */
export function shouldBlankField(state: RecordingState): boolean {
  return state === 'recording';
}

export interface RecordingDetectorDeps {
  isSupported(): boolean;
  isCaptured(): boolean;
  addCaptureChangeListener(cb: (captured: boolean) => void): CaptureChangeSubscription;
}

/**
 * DI'd core (mirrors `useScreenCapture.ts`'s `ScreenCaptureDeps` split and
 * `useAppStateLock.ts`'s `attachAppStateLock` shape): subscribes via the
 * injected deps, reports the initial state synchronously through `setState`,
 * then reports every subsequent capture-change event through the SAME
 * `deriveRecordingState` rule. Returns a detach function.
 *
 * `active` guards against a late listener callback firing after `detach()`
 * has already been called — the subscription's own `remove()` is called
 * too, but a native event that was already in flight when `remove()` ran
 * must still not reach `setState` (T-15-09-05's "no stale write" half).
 * This is the ONLY place that guard lives — kept in the pure/DI'd core
 * rather than the `useEffect` shell so it is directly testable without a
 * component renderer (no react-native-testing-library in this repo).
 */
export function attachRecordingDetection(
  deps: RecordingDetectorDeps,
  setState: (state: RecordingState) => void,
): () => void {
  let active = true;
  const supported = deps.isSupported();
  setState(deriveRecordingState(supported, deps.isCaptured()));

  if (!supported) {
    return () => {
      active = false;
    };
  }

  const subscription = deps.addCaptureChangeListener((captured) => {
    if (!active) return;
    setState(deriveRecordingState(supported, captured));
  });

  return () => {
    active = false;
    subscription.remove();
  };
}

/** Production wiring — the ONLY place the native module is imported for actual use. */
const defaultRecordingDetectorDeps: RecordingDetectorDeps = {
  isSupported,
  isCaptured,
  addCaptureChangeListener,
};

/**
 * Boot/screen-level hook: mounts `attachRecordingDetection` for the
 * lifetime of the calling component (`IdScanBlockContent`/
 * `IbanScanBlockContent`) and returns the live `RecordingState`. Thin
 * `useEffect` shell — untested directly, per this repo's "test the pure
 * core, not the hook shell" convention (`useAppStateLock.test.ts`,
 * `sensitiveScreen.test.ts`).
 */
export function useRecordingDetection(): RecordingState {
  const [state, setState] = useState<RecordingState>(() =>
    deriveRecordingState(
      defaultRecordingDetectorDeps.isSupported(),
      defaultRecordingDetectorDeps.isCaptured(),
    ),
  );

  useEffect(() => {
    return attachRecordingDetection(defaultRecordingDetectorDeps, setState);
  }, []);

  return state;
}
