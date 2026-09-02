import { describe, expect, it, vi } from 'vitest';

// `useRecordingDetection.ts` imports the native module wrapper
// (`modules/screen-recording-detector/index.ts`) at module scope, which
// itself imports `expo-modules-core` (pulls in `react-native`, unparseable
// Flow syntax under vitest/node) — mocked at the module boundary, mirroring
// `useScreenCapture.test.ts`'s `expo-screen-capture` mock precedent. Only
// `attachRecordingDetection`'s DI'd core is exercised below, so these
// production functions are never actually called.
vi.mock('../../../../modules/screen-recording-detector', () => ({
  isSupported: () => false,
  isCaptured: () => false,
  addCaptureChangeListener: () => ({ remove: () => {} }),
}));

import type { CaptureChangeSubscription } from '../../../../modules/screen-recording-detector';
import {
  attachRecordingDetection,
  deriveRecordingState,
  shouldBlankField,
  type RecordingDetectorDeps,
} from './useRecordingDetection';

/**
 * D-14b (SEC-05, plan 15-09): `useRecordingDetection`'s thin `useEffect`
 * shell is untested directly (no react-native-testing-library in this repo
 * — mirrors `useAppStateLock.test.ts`/`useScreenCapture.test.ts`'s "test the
 * pure core, not the hook shell" precedent). `attachRecordingDetection` is
 * the DI'd core every behavior bullet below actually exercises.
 */

function makeDeps(overrides: Partial<RecordingDetectorDeps> = {}): {
  deps: RecordingDetectorDeps;
  emit: (captured: boolean) => void;
  removeSpy: ReturnType<typeof vi.fn>;
} {
  let listener: ((captured: boolean) => void) | undefined;
  const removeSpy = vi.fn();
  const deps: RecordingDetectorDeps = {
    isSupported: () => true,
    isCaptured: () => false,
    addCaptureChangeListener: vi.fn((cb: (captured: boolean) => void): CaptureChangeSubscription => {
      listener = cb;
      return { remove: removeSpy };
    }),
    ...overrides,
  };
  return {
    deps,
    emit: (captured: boolean) => listener?.(captured),
    removeSpy,
  };
}

describe('deriveRecordingState', () => {
  it("returns 'unsupported' when supported is false, regardless of captured", () => {
    expect(deriveRecordingState(false, false)).toBe('unsupported');
    expect(deriveRecordingState(false, true)).toBe('unsupported');
  });

  it("returns 'idle' when supported and not captured", () => {
    expect(deriveRecordingState(true, false)).toBe('idle');
  });

  it("returns 'recording' when supported and captured", () => {
    expect(deriveRecordingState(true, true)).toBe('recording');
  });
});

describe('shouldBlankField', () => {
  it("is true only for 'recording'", () => {
    expect(shouldBlankField('recording')).toBe(true);
    expect(shouldBlankField('idle')).toBe(false);
    expect(shouldBlankField('unsupported')).toBe(false);
  });
});

describe('attachRecordingDetection — unsupported platform (Android, or iOS before the pending rebuild)', () => {
  it("reports 'unsupported' once and never subscribes", () => {
    const setState = vi.fn();
    const { deps } = makeDeps({ isSupported: () => false, isCaptured: () => true });
    const addListenerSpy = deps.addCaptureChangeListener as ReturnType<typeof vi.fn>;

    attachRecordingDetection(deps, setState);

    expect(setState).toHaveBeenCalledTimes(1);
    expect(setState).toHaveBeenCalledWith('unsupported');
    expect(addListenerSpy).not.toHaveBeenCalled();
  });
});

describe('attachRecordingDetection — supported platform: subscribe/unsubscribe lifecycle', () => {
  it('subscribes on attach and removes the subscription on detach', () => {
    const setState = vi.fn();
    const { deps, removeSpy } = makeDeps();

    const detach = attachRecordingDetection(deps, setState);
    expect(deps.addCaptureChangeListener).toHaveBeenCalledTimes(1);
    expect(removeSpy).not.toHaveBeenCalled();

    detach();
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });

  it('reports the initial state synchronously from isSupported()/isCaptured()', () => {
    const setState = vi.fn();
    const { deps } = makeDeps({ isCaptured: () => true });

    attachRecordingDetection(deps, setState);

    expect(setState).toHaveBeenCalledWith('recording');
  });

  it("a capture-change event flipping true -> false transitions 'recording' -> 'idle' with no intermediate state", () => {
    const setState = vi.fn();
    const { deps, emit } = makeDeps();

    attachRecordingDetection(deps, setState);
    setState.mockClear();

    emit(true);
    expect(setState).toHaveBeenCalledTimes(1);
    expect(setState).toHaveBeenLastCalledWith('recording');

    emit(false);
    expect(setState).toHaveBeenCalledTimes(2);
    expect(setState).toHaveBeenLastCalledWith('idle');
  });

  it('a late callback firing after detach() performs no state write (no stale blanked field, T-15-09-05)', () => {
    const setState = vi.fn();
    const { deps, emit, removeSpy } = makeDeps();

    const detach = attachRecordingDetection(deps, setState);
    detach();
    expect(removeSpy).toHaveBeenCalledTimes(1);

    setState.mockClear();
    emit(true); // simulates an event already in flight when detach() ran
    expect(setState).not.toHaveBeenCalled();
  });
});
