import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { BACKGROUND_GRACE_MS } from './autoLockConstants';

/**
 * D-05 (15-CONTEXT.md) as originally written: backgrounding the app locks it
 * IMMEDIATELY and UNCONDITIONALLY, with no flow — not checkout, not
 * signature — allowed an exemption, and adding one declared a DEFECT to be
 * escalated rather than implemented here.
 *
 * THAT ESCALATION HAPPENED. THE OPERATOR OVERRULED D-05 ON 2026-08-27.
 * Grounds: a real-device field test showed the rule made the app unusable.
 * Not even banking apps lock this aggressively, and on iOS a brief step out
 * — the Control-Centre pull, a notification banner, an incoming call, a
 * glance at the app switcher — backgrounds the app, so every one of them
 * threw the rep onto the PIN screen mid-door. The replacement rule is a
 * single global grace window (`BACKGROUND_GRACE_MS`, 60 s,
 * `autoLockConstants.ts`): backgrounding STARTS the window; returning inside
 * it leaves the app unlocked; reaching it locks.
 *
 * WHAT STILL HOLDS — this is a bounded change to ONE time parameter, not a
 * licence to weaken the lock further:
 *   1. The lock is still immediate and unconditional once
 *      `BACKGROUND_GRACE_MS` has elapsed — including while the app is still
 *      backgrounded, via the backstop `attachAppStateLock` arms. The rep
 *      does not have to come back for the lock to happen.
 *   2. There are still NO per-screen and NO per-flow exceptions. This module
 *      exposes no parameter, option, or flag that names or selects a screen,
 *      route or flow; adding one is still a DEFECT to escalate, not a
 *      feature request.
 *   3. Checkout and signature capture are explicitly NOT softened. They get
 *      the same 60 s every other screen gets — no longer, and with no way to
 *      ask for longer.
 *   4. The idle timer (D-07/D-08, `useIdleTimer.ts`) is untouched, as are
 *      `AppLockProvider.tsx`'s fail-secure cold-start default and
 *      expo-screen-capture's app-switcher blur. The accepted residual risk
 *      is bounded by all three.
 *
 * On this file's own acceptance grep: `15-07-PLAN.md`'s `<threat_model>`
 * (T-15-07-01) states the grep's real intent — "a grep for exemption-shaped
 * IDENTIFIERS must return nothing", i.e. no parameter/option/function name
 * that could suppress the lock, not a ban on the word appearing in prose.
 * That guarantee is intact: `BACKGROUND_GRACE_MS` and
 * `shouldLockOnBackgroundReturn` are a DURATION and a TIMING decision, not
 * carve-outs — neither can be pointed at a particular screen or flow.
 * `useAppStateLock.test.ts` asserts the full parameter list of every
 * exported function for exactly this reason (it replaced the older
 * `.length === 2` arity assertions, which the DI'd clock/schedule
 * parameters made impossible to keep literally).
 *
 * D-06: this module only decides WHEN to lock, never what to preserve. An
 * in-progress signature stroke is discarded on lock, not persisted — see
 * `AppLockProvider.tsx`'s header for where that rule is enforced.
 *
 * Testing shape mirrors `ThemeProvider.tsx`'s `AppearanceLike`/
 * `subscribeToAppearance` split and `useIdleTimer.ts`'s `attachIdleTimer`:
 * pure decision functions (`shouldLockOnAppStateChange`,
 * `shouldLockOnBackgroundReturn`) plus a DI'd attach function
 * (`attachAppStateLock`) that a test drives with a fake subscribe, a fake
 * clock and a fake schedule, plus a thin `useEffect` shell
 * (`useAppStateLock`) that wires the real `AppState`, `performance.now()`/
 * `Date.now()` and `setTimeout`.
 */

/**
 * The three-value contract this module and `AppLockProvider` reason about.
 * RN's real `AppStateStatus` is wider (`'active' | 'background' | 'inactive'
 * | 'unknown' | 'extension'`, see `AppState.d.ts`) — `normalizeAppStateStatus`
 * below folds the two rarer iOS-only values into this narrower set.
 */
export type AppStateValue = 'active' | 'background' | 'inactive';

/**
 * Both clock readings taken at the moment of backgrounding. Two stamps, not
 * one, because neither clock alone is trustworthy — see
 * `shouldLockOnBackgroundReturn`.
 */
export interface BackgroundAnchor {
  /** `performance.now()` at backgrounding — monotonic, immune to wall-clock edits, but pauses while iOS suspends the process. */
  monotonicMs: number;
  /** `Date.now()` at backgrounding — keeps counting through suspension, but is rep-adjustable. */
  wallMs: number;
}

/**
 * Pure: RN's real `AppStateStatus` union has two more members than this
 * module's contract (`'unknown'`, the pre-launch initial value; `'extension'`,
 * an iOS app-extension context). Neither is `'active'`, so both fold into
 * `'inactive'`, the conservative choice: an app state that is not
 * confirmed-foregrounded is treated exactly like the interruption state.
 */
export function normalizeAppStateStatus(status: AppStateStatus): AppStateValue {
  if (status === 'active' || status === 'background') return status;
  return 'inactive';
}

/**
 * Pure: detects a transition INTO `'background'`. Its MEANING is unchanged
 * from the original D-05 implementation, but its ROLE is not: it no longer
 * says "lock now", it says "START THE GRACE WINDOW now" (2026-08-27
 * overrule, see the module header). Whether that window has run out is
 * `shouldLockOnBackgroundReturn`'s decision.
 *
 * - A transition INTO `'background'` starts the window.
 * - `'inactive'` does NOT start it and does NOT lock. On iOS that state is
 *   raised by every system interruption that draws over the app WITHOUT
 *   backgrounding it: the location/camera/notification permission dialogs,
 *   the Control-Centre pull, an incoming-call banner. The original rule
 *   treated it as a backgrounding and locked, which made the app unusable —
 *   granting location access, the very first thing the map asks for, threw
 *   the rep onto the PIN screen every single time. The app-switcher snapshot
 *   `'inactive'` was protecting against is covered by a mechanism built for
 *   it: expo-screen-capture's `enableAppSwitcherProtectionAsync`
 *   (features/app-lock/screenProtection/useScreenCapture.ts).
 *
 *   CEILING: an interruption that never becomes `'background'` leaves the app
 *   unlocked behind the dialog. The idle timer (`useIdleTimer`) is the
 *   backstop there.
 * - Returning to `'active'` never starts a window by itself.
 * - Entering `'background'` starts one from ANY prior state, not just
 *   `'active'`. iOS routes a real backgrounding through `'inactive'` first,
 *   so gating on `prev === 'active'` would have let "permission dialog, then
 *   the rep puts the phone in a pocket" through with no window at all.
 * - `'background'` -> `'background'` cannot restart the window (which would
 *   otherwise re-anchor it and extend the unlocked time).
 */
export function shouldLockOnAppStateChange(prev: AppStateValue, next: AppStateValue): boolean {
  return prev !== 'background' && next === 'background';
}

/**
 * Pure: has the grace window run out? `true` means lock.
 *
 * The rule is `Math.max(monotonicElapsed, wallElapsed) >= BACKGROUND_GRACE_MS`
 * — deliberately NOT `performance.now()` alone, which is what
 * `useIdleTimer.ts` uses. Both clocks are individually unsafe here, in
 * OPPOSITE directions:
 *
 *   - The wall clock (`Date.now()`) is rep-adjustable. Rolled backward while
 *     the app is backgrounded, it would make the window never expire —
 *     failing OPEN.
 *   - The monotonic clock (`performance.now()`) cannot be tampered with, but
 *     it can UNDER-count while iOS has the process suspended: an hour in a
 *     pocket can read as a few hundred milliseconds — also failing OPEN.
 *
 * Taking the MAXIMUM of the two elapsed readings is the same shape as
 * `WalletScreen.tsx:149-161`'s server-time floor, applied to elapsed time
 * instead of an absolute stamp: whichever source says MORE time has passed
 * wins. A backward clock yields a small or negative wall elapsed and the
 * monotonic reading decides; a suspended monotonic clock loses to the wall
 * reading; a clock rolled forward locks EARLIER.
 *
 * INVARIANT, stated plainly: clock manipulation can only ever make the app
 * lock SOONER, never later. `useAppStateLock.test.ts` asserts this directly
 * rather than leaving it to inspection (T-f98-02).
 *
 * Fail-secure: a missing anchor, or any non-finite stamp, means this
 * function cannot reason about the elapsed time at all — it returns `true`
 * (lock) rather than comparing garbage.
 */
export function shouldLockOnBackgroundReturn(
  anchor: BackgroundAnchor | null,
  monotonicNowMs: number,
  wallNowMs: number,
): boolean {
  if (anchor === null) return true;
  if (
    !Number.isFinite(anchor.monotonicMs) ||
    !Number.isFinite(anchor.wallMs) ||
    !Number.isFinite(monotonicNowMs) ||
    !Number.isFinite(wallNowMs)
  ) {
    return true;
  }

  const monotonicElapsedMs = monotonicNowMs - anchor.monotonicMs;
  const wallElapsedMs = wallNowMs - anchor.wallMs;
  return Math.max(monotonicElapsedMs, wallElapsedMs) >= BACKGROUND_GRACE_MS;
}

/** Both clock readings, taken together. Injected so tests drive time directly (`attachIdleTimer`'s `now` precedent). */
export type LockClock = () => { monotonicMs: number; wallMs: number };

/**
 * DI'd: subscribes to app-state transitions via the injected `subscribe`
 * function and runs the grace window (test drives this with fakes;
 * production wiring is `useAppStateLock` below). `schedule` is
 * `attachIdleTimer`'s `(ms, cb) => cancel` shape, reused verbatim — there is
 * deliberately only one scheduling shape in this directory.
 *
 * On entering `'background'`: capture the anchor and ARM A BACKSTOP that
 * calls `lock('background')` at grace expiry. The backstop is what keeps
 * guarantee (1) in the module header true — a device left behind locks on
 * its own, without the rep ever returning.
 *
 * On the FIRST non-background event: cancel the backstop and evaluate
 * `shouldLockOnBackgroundReturn`. First, not "on `'active'`", because iOS
 * routes a resume through `'inactive'` before `'active'` — evaluating on
 * `'inactive'` lands the lock before the UI is interactive. (JS timers do
 * not fire while the process is suspended, so the backstop cannot be relied
 * on to have already run by the time the app resumes; the return-path
 * evaluation is the one that actually catches a long absence.)
 *
 * Returns a detach function that unsubscribes AND cancels any armed backstop.
 */
export function attachAppStateLock(
  subscribe: (cb: (next: AppStateValue) => void) => () => void,
  lock: (reason: 'background') => void,
  clock: LockClock,
  schedule: (ms: number, cb: () => void) => () => void,
): () => void {
  let prev: AppStateValue = 'active';
  let anchor: BackgroundAnchor | null = null;
  let cancelBackstop: (() => void) | null = null;

  const clearBackstop = (): void => {
    if (cancelBackstop === null) return;
    const cancel = cancelBackstop;
    cancelBackstop = null;
    cancel();
  };

  const unsubscribe = subscribe((next) => {
    if (shouldLockOnAppStateChange(prev, next)) {
      const { monotonicMs, wallMs } = clock();
      anchor = { monotonicMs, wallMs };
      clearBackstop();
      cancelBackstop = schedule(BACKGROUND_GRACE_MS, () => {
        cancelBackstop = null;
        anchor = null;
        lock('background');
      });
    } else if (next !== 'background' && anchor !== null) {
      clearBackstop();
      const { monotonicMs, wallMs } = clock();
      const expired = shouldLockOnBackgroundReturn(anchor, monotonicMs, wallMs);
      anchor = null;
      if (expired) lock('background');
    }
    prev = next;
  });

  return () => {
    clearBackstop();
    unsubscribe();
  };
}

/**
 * Thin `useEffect` shell — the only site in this module that touches RN's
 * real `AppState`, the real clocks, or the real timer. Its exported
 * signature is unchanged: `AppLockProvider.tsx` still calls
 * `useAppStateLock(lock)`.
 */
export function useAppStateLock(lock: (reason: 'background') => void): void {
  useEffect(() => {
    return attachAppStateLock(
      (cb) => {
        const subscription = AppState.addEventListener('change', (status) => cb(normalizeAppStateStatus(status)));
        return () => subscription.remove();
      },
      lock,
      () => ({ monotonicMs: performance.now(), wallMs: Date.now() }),
      (ms, cb) => {
        const id = setTimeout(cb, ms);
        return () => clearTimeout(id);
      },
    );
  }, [lock]);
}
