import { describe, expect, it, vi } from 'vitest';

// This repo has no react-native-testing-library — `useAppStateLock` (the
// thin `useEffect` shell) is not rendered here; only its exported pure
// functions (`shouldLockOnAppStateChange`, `shouldLockOnBackgroundReturn`)
// and its DI'd attach function (`attachAppStateLock`, driven by a fake
// subscribe, a fake clock and a fake schedule) are tested directly,
// mirroring `ThemeProvider.test.tsx`'s `subscribeToAppearance` and
// `useIdleTimer.test.ts`'s `attachIdleTimer` precedents.
// `useAppStateLock.ts` imports `AppState` from `react-native` (Flow-syntax
// source, unparseable under vitest/node) at module scope — mock it at the
// module boundary (`ThemeProvider.test.tsx`'s `Appearance` mock precedent)
// so this file can import the module's pure exports without loading RN's
// own native-module bootstrapping.
vi.mock('react-native', () => ({
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));

import { BACKGROUND_GRACE_MS } from './autoLockConstants';
import {
  attachAppStateLock,
  normalizeAppStateStatus,
  shouldLockOnAppStateChange,
  shouldLockOnBackgroundReturn,
  type AppStateValue,
  type BackgroundAnchor,
} from './useAppStateLock';

describe('shouldLockOnAppStateChange (D-05, overruled 2026-08-27 — now starts the grace window)', () => {
  it("starts the window on 'active' -> 'background'", () => {
    expect(shouldLockOnAppStateChange('active', 'background')).toBe(true);
  });

  // Reversed deliberately. 'inactive' is what iOS raises for every system
  // dialog drawn OVER the app — the location permission prompt above all — so
  // locking on it threw the rep onto the PIN screen the first time the map
  // asked for a location. The app-switcher snapshot that 'inactive' was
  // guarding is covered by expo-screen-capture's app-switcher blur.
  it("does NOT lock on 'active' -> 'inactive' — a permission dialog is not a backgrounding", () => {
    expect(shouldLockOnAppStateChange('active', 'inactive')).toBe(false);
  });

  it("does NOT start the window on 'background' -> 'active' (returning to foreground never starts it)", () => {
    expect(shouldLockOnAppStateChange('background', 'active')).toBe(false);
  });

  // Also reversed: since 'inactive' no longer locks, the previous transition
  // did NOT already lock, and iOS routes every real backgrounding through
  // 'inactive' first. Returning false here would leave the app unlocked after
  // "dialog, then phone into the pocket".
  it("DOES start the window on 'inactive' -> 'background' — nothing locked before it", () => {
    expect(shouldLockOnAppStateChange('inactive', 'background')).toBe(true);
  });

  it("does NOT start the window on 'active' -> 'active' (no transition)", () => {
    expect(shouldLockOnAppStateChange('active', 'active')).toBe(false);
  });
});

describe('normalizeAppStateStatus', () => {
  it("passes through 'active' and 'background' unchanged", () => {
    expect(normalizeAppStateStatus('active')).toBe('active');
    expect(normalizeAppStateStatus('background')).toBe('background');
  });

  it("passes through 'inactive' unchanged", () => {
    expect(normalizeAppStateStatus('inactive')).toBe('inactive');
  });

  it("folds RN's rarer 'unknown'/'extension' iOS states into 'inactive' — conservative, lock-favoring default (D-05)", () => {
    expect(normalizeAppStateStatus('unknown')).toBe('inactive');
    expect(normalizeAppStateStatus('extension')).toBe('inactive');
  });
});

describe('shouldLockOnBackgroundReturn (T-f98-02: the device clock is untrusted input)', () => {
  const anchor: BackgroundAnchor = { monotonicMs: 1_000, wallMs: 1_700_000_000_000 };

  it('does not lock when BOTH readings are inside the grace window', () => {
    expect(shouldLockOnBackgroundReturn(anchor, anchor.monotonicMs + 59_000, anchor.wallMs + 59_000)).toBe(false);
  });

  it('locks the instant either reading REACHES the grace (boundary is inclusive)', () => {
    expect(
      shouldLockOnBackgroundReturn(
        anchor,
        anchor.monotonicMs + BACKGROUND_GRACE_MS,
        anchor.wallMs + BACKGROUND_GRACE_MS,
      ),
    ).toBe(true);
  });

  it('locks when only the MONOTONIC reading is past the grace (a wall clock rolled BACKWARD cannot extend it)', () => {
    // Rep sets the device clock back an hour while backgrounded: wall elapsed
    // is deeply negative, monotonic elapsed still decides.
    expect(shouldLockOnBackgroundReturn(anchor, anchor.monotonicMs + 61_000, anchor.wallMs - 3_600_000)).toBe(true);
  });

  it('locks when only the WALL reading is past the grace (a suspended monotonic clock under-counts)', () => {
    // iOS suspended the process: performance.now() barely advanced, but an
    // hour of real time passed. Failing OPEN here is the dangerous case.
    expect(shouldLockOnBackgroundReturn(anchor, anchor.monotonicMs + 200, anchor.wallMs + 3_600_000)).toBe(true);
  });

  it('locks immediately when the wall clock is jumped FORWARD past the grace — locking sooner is always safe', () => {
    expect(shouldLockOnBackgroundReturn(anchor, anchor.monotonicMs + 10, anchor.wallMs + 999_999)).toBe(true);
  });

  it('a backward wall clock can only ever SHORTEN the window, never lengthen it', () => {
    // Same monotonic reading, sabotaged wall clock: the decision is identical
    // to the honest one. That is the invariant, in one assertion.
    const monotonicNow = anchor.monotonicMs + BACKGROUND_GRACE_MS + 1;
    const honest = shouldLockOnBackgroundReturn(anchor, monotonicNow, anchor.wallMs + BACKGROUND_GRACE_MS + 1);
    const sabotaged = shouldLockOnBackgroundReturn(anchor, monotonicNow, anchor.wallMs - 10_000_000);
    expect(sabotaged).toBe(honest);
    expect(sabotaged).toBe(true);
  });

  it('fails SECURE on a null anchor — a state it cannot reason about locks', () => {
    expect(shouldLockOnBackgroundReturn(null, 1_000_000, 1_700_000_060_000)).toBe(true);
  });

  it('fails SECURE on non-finite stamps (a NaN clock read) rather than comparing garbage', () => {
    expect(shouldLockOnBackgroundReturn({ monotonicMs: Number.NaN, wallMs: anchor.wallMs }, 1, 2)).toBe(true);
    expect(shouldLockOnBackgroundReturn(anchor, Number.NaN, anchor.wallMs)).toBe(true);
    expect(shouldLockOnBackgroundReturn(anchor, anchor.monotonicMs, Number.NaN)).toBe(true);
  });
});

/** Fake subscribe function capturing the registered callback, mirroring RN's `AppState.addEventListener` shape. */
function createFakeSubscribe(): {
  subscribe: (cb: (next: AppStateValue) => void) => () => void;
  emit(next: AppStateValue): void;
  unsubscribeSpy: ReturnType<typeof vi.fn>;
} {
  let listener: ((next: AppStateValue) => void) | undefined;
  const unsubscribeSpy = vi.fn();
  return {
    subscribe(cb) {
      listener = cb;
      return unsubscribeSpy;
    },
    emit(next) {
      listener?.(next);
    },
    unsubscribeSpy,
  };
}

/** Fake clock: both readings advance together unless a test skews them deliberately. */
function createFakeClock(): {
  clock: () => { monotonicMs: number; wallMs: number };
  advance(ms: number): void;
  skewWall(ms: number): void;
} {
  let monotonicMs = 5_000;
  let wallMs = 1_700_000_000_000;
  return {
    clock: () => ({ monotonicMs, wallMs }),
    advance(ms) {
      monotonicMs += ms;
      wallMs += ms;
    },
    skewWall(ms) {
      wallMs += ms;
    },
  };
}

/** Fake `(ms, cb) => cancel` scheduler — `attachIdleTimer`'s injected shape, reused verbatim. */
function createFakeSchedule(): {
  schedule: (ms: number, cb: () => void) => () => void;
  fire(): void;
  lastDelayMs: () => number | undefined;
  cancelSpy: ReturnType<typeof vi.fn>;
} {
  let pending: (() => void) | undefined;
  let lastDelay: number | undefined;
  const cancelSpy = vi.fn();
  return {
    schedule(ms, cb) {
      lastDelay = ms;
      pending = cb;
      return () => {
        cancelSpy();
        pending = undefined;
      };
    },
    fire() {
      const cb = pending;
      pending = undefined;
      cb?.();
    },
    lastDelayMs: () => lastDelay,
    cancelSpy,
  };
}

function attach(lock: (reason: 'background') => void) {
  const fakeSubscribe = createFakeSubscribe();
  const fakeClock = createFakeClock();
  const fakeSchedule = createFakeSchedule();
  const detach = attachAppStateLock(fakeSubscribe.subscribe, lock, fakeClock.clock, fakeSchedule.schedule);
  return { ...fakeSubscribe, ...fakeClock, ...fakeSchedule, detach };
}

describe('attachAppStateLock (grace window)', () => {
  it('a step out and back INSIDE the grace never locks — the whole point of the 2026-08-27 overrule', () => {
    const lock = vi.fn();
    const h = attach(lock);

    h.emit('background');
    expect(lock).not.toHaveBeenCalled();
    h.advance(30_000);
    h.emit('active');
    expect(lock).not.toHaveBeenCalled();
  });

  it("a return PAST the grace calls lock('background') exactly once", () => {
    const lock = vi.fn();
    const h = attach(lock);

    h.emit('background');
    h.advance(BACKGROUND_GRACE_MS + 1);
    h.emit('active');
    expect(lock).toHaveBeenCalledWith('background');
    expect(lock).toHaveBeenCalledTimes(1);
  });

  it('evaluates on the FIRST non-background event — iOS resumes through inactive before active', () => {
    const lock = vi.fn();
    const h = attach(lock);

    h.emit('background');
    h.advance(BACKGROUND_GRACE_MS + 1);
    h.emit('inactive'); // the lock must land here, before the UI is interactive
    expect(lock).toHaveBeenCalledTimes(1);

    h.emit('active');
    expect(lock).toHaveBeenCalledTimes(1); // and not a second time on the follow-up event
  });

  it('arms a backstop at grace expiry that locks while still backgrounded', () => {
    const lock = vi.fn();
    const h = attach(lock);

    h.emit('background');
    expect(h.lastDelayMs()).toBe(BACKGROUND_GRACE_MS);
    h.fire();
    expect(lock).toHaveBeenCalledWith('background');
  });

  it('cancels the backstop on a return inside the window', () => {
    const lock = vi.fn();
    const h = attach(lock);

    h.emit('background');
    h.advance(1_000);
    h.emit('active');
    expect(h.cancelSpy).toHaveBeenCalled();
    h.fire(); // nothing pending any more
    expect(lock).not.toHaveBeenCalled();
  });

  it('a wall clock rolled BACKWARD while backgrounded does not buy extra unlocked time', () => {
    const lock = vi.fn();
    const h = attach(lock);

    h.emit('background');
    h.advance(BACKGROUND_GRACE_MS + 5_000);
    h.skewWall(-86_400_000); // clock set back a day
    h.emit('active');
    expect(lock).toHaveBeenCalledWith('background');
  });

  it("does not lock on an 'active' -> 'inactive' transition (system dialog over the app)", () => {
    const lock = vi.fn();
    const h = attach(lock);

    h.emit('inactive');
    expect(lock).not.toHaveBeenCalled();
    expect(h.lastDelayMs()).toBeUndefined(); // no window started either
  });

  it('still starts the window when an interruption goes on to real backgrounding', () => {
    const lock = vi.fn();
    const h = attach(lock);

    h.emit('inactive');
    h.emit('background');
    h.advance(BACKGROUND_GRACE_MS);
    h.emit('active');
    expect(lock).toHaveBeenCalledWith('background');
  });

  it('does not lock when returning to active without ever having backgrounded', () => {
    const lock = vi.fn();
    const h = attach(lock);

    h.emit('inactive');
    h.advance(10 * BACKGROUND_GRACE_MS);
    h.emit('active');
    expect(lock).not.toHaveBeenCalled();
  });

  it('returns a detach function that unsubscribes and cancels any armed backstop', () => {
    const lock = vi.fn();
    const h = attach(lock);

    h.emit('background');
    h.detach();
    expect(h.unsubscribeSpy).toHaveBeenCalledTimes(1);
    expect(h.cancelSpy).toHaveBeenCalledTimes(1);
    h.fire();
    expect(lock).not.toHaveBeenCalled();
  });
});

/**
 * Replaces the previous `.length === 2` arity assertions on
 * `shouldLockOnAppStateChange` and `attachAppStateLock`. Adding the DI'd
 * clock and schedule parameters changed the arity, but NOT the guarantee
 * those assertions encoded: no parameter of this module names or selects a
 * screen, route or flow, so there is no seam through which a caller could
 * exempt one. These assertions check the parameter LIST itself, not merely
 * its length, which is strictly stronger than what they replace.
 */
function parameterNames(fn: (...args: never[]) => unknown): string[] {
  const source = fn.toString();
  const open = source.indexOf('(');
  const close = source.indexOf(')', open);
  return source
    .slice(open + 1, close)
    .split(',')
    .map((part) => part.trim().split(/[\s:=]/)[0] ?? '')
    .filter((name) => name.length > 0);
}

const CARVE_OUT_SHAPED = /screen|route|flow|checkout|signature|handover|exempt|skip|bypass|suppress|disable|opt/i;

describe('no per-screen or per-flow carve-out seam (T-f98-03)', () => {
  it("attachAppStateLock's parameters are exactly subscribe, lock, clock, schedule", () => {
    expect(parameterNames(attachAppStateLock)).toEqual(['subscribe', 'lock', 'clock', 'schedule']);
    expect(attachAppStateLock.length).toBe(4);
  });

  it('no parameter of any exported function names or selects a screen, route or flow', () => {
    for (const fn of [attachAppStateLock, shouldLockOnAppStateChange, shouldLockOnBackgroundReturn]) {
      for (const name of parameterNames(fn)) {
        expect(name).not.toMatch(CARVE_OUT_SHAPED);
      }
    }
  });

  it('the pure decision functions take only states and clock readings — nothing app-structural', () => {
    expect(parameterNames(shouldLockOnAppStateChange)).toEqual(['prev', 'next']);
    expect(parameterNames(shouldLockOnBackgroundReturn)).toEqual(['anchor', 'monotonicNowMs', 'wallNowMs']);
  });

  it('the grace is a single global duration, not a per-call argument', () => {
    // If a future edit made the grace injectable, the parameter list asserted
    // above would change and this file would fail — that is the point.
    expect(BACKGROUND_GRACE_MS).toBe(60 * 1000);
  });
});
