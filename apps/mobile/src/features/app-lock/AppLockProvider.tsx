import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSessionDb } from '../../app/useSessionDb';
import { createMMKV } from 'react-native-mmkv';
import { clearPinCredential, defaultPinDeps, hasPinCredential } from './pin/pinHash';
import { CLEARED_ATTEMPT_STATE, saveAttemptState } from './pin/pinAttempts';
import {
  INSTALL_MARKER_MMKV_ID,
  resetAppLockOnFreshInstall,
} from './freshInstallReset';
import { useAppStateLock } from './autoLock/useAppStateLock';
import { useIdleTimer } from './autoLock/useIdleTimer';
import { attachRemoteWipeConnector, createDefaultRemoteWipeDeps } from './wipe/remoteWipeConnector';

/**
 * AppLockProvider — the SEC-03 lock primitive every later app-lock plan
 * drives (15-07 auto-lock/idle, 15-10 local wipe, 15-11 remote wipe, 15-14
 * revoke-own-session). Published interface, do not change its shape without
 * updating every consuming plan.
 *
 * Follows `AccessibilityProvider.tsx`'s shape (12-PATTERNS.md "No Analog
 * Found" precedent this repo reuses): self-resolving, no props beyond
 * `children`, degrades to a documented default before its one async
 * dependency (`hasPinCredential`, backed by `expo-secure-store`) resolves.
 *
 * FAIL-SECURE DEFAULT (deliberate, not an oversight): unlike
 * `AccessibilityProvider`'s inert default (which never blocks rendering),
 * this provider's pre-resolution default is `isLocked: true` —
 * `resolveInitialLockState(true)` — regardless of whether a credential
 * actually exists. The alternative (defaulting to unlocked while the
 * SecureStore read is in flight) would render the navigation tree, even
 * briefly, before this provider can possibly know whether it should be
 * gated — exactly the leak D-05's "no exemption" rule exists to prevent.
 * Once `hasPinCredential` resolves, a rep who has never set up a PIN
 * transitions to unlocked automatically (see `resolveInitialLockState`) —
 * this is a brief, self-clearing render, never a trap: `AppLockGate` cannot
 * be exited any other way than a real credential, so if the rep were
 * genuinely stuck the gate would have nothing to unlock against.
 *
 * `lock()`/`unlock()` call discipline (T-15-06-06, enforced by convention,
 * not by the type system — TypeScript cannot express "caller must be
 * AppLockGate.tsx"):
 *   - `unlock()` is callable ONLY from `AppLockGate.tsx`, and only after a
 *     successful biometric or PIN verification. No other module may call it.
 *   - `lock(reason)` is driven by every OTHER app-lock plan (background/idle
 *     detection, session revocation, remote-wipe delivery) — `AppLockGate`
 *     itself never calls `lock()`, only `unlock()`.
 *   - `lock()` is idempotent and preserves the FIRST reason: once locked,
 *     a second `lock()` call (e.g. a background event firing while the app
 *     is already locked for `remote-wipe`) must never downgrade or mask a
 *     more severe reason.
 *
 * 15-07 (SEC-04): this provider is also where the two standing lock timers
 * live -- `useAppStateLock(lock)` (D-05/D-06, backgrounding) and
 * `useIdleTimer(lock)` (D-07/D-08, the handover-suspended idle timeout),
 * both mounted exactly once, here, for the whole app. Their own modules
 * (`autoLock/useAppStateLock.ts`, `autoLock/useIdleTimer.ts`) own the pure
 * D-05 through D-08 rules and are unit-tested directly; this provider only
 * wires them to `lock`.
 *
 * 15-11 (SEC-08): this provider is also where `attachRemoteWipeConnector`
 * (wipe/remoteWipeConnector.ts) is mounted exactly once, once the PowerSync
 * db singleton (`useSessionDb()`) is ready — it drives the D-01 lock-then-
 * drain-then-purge sequence for a synced `device_wipe_orders` row, wired to
 * THIS provider's own `lock`, never a second lock state.
 *
 * D-01's irreversibility, enforced HERE (not just by the connector never
 * calling `unlock()`): `unlock()` below REFUSES to clear a lock whose reason
 * is `'remote-wipe'` — entering the wipe-pending state is a one-way door,
 * and a correct PIN does not open it. `applyUnlock` takes the CURRENT
 * `LockState` for exactly this check.
 *
 * D-06, restated at the one place a reader would otherwise be tempted to
 * "fix" it: when `isLocked` flips to `true`, this provider does NOT capture,
 * queue, or otherwise preserve any in-flight screen state (an in-progress
 * signature stroke included) before gating the UI. A half-drawn signature
 * has no legal value -- losing it costs the rep one restarted step. An
 * unlocked tablet holding ID documents in a stranger's hand costs far more.
 * Do not add a draft-preservation hook here or anywhere else; that would
 * defeat the reason D-06 exists.
 */

export type LockReason = 'background' | 'idle' | 'manual' | 'session-revoked' | 'remote-wipe';

export interface AppLockApi {
  isLocked: boolean;
  lockReason: LockReason | null;
  /** A PIN credential exists (`pinHash.hasPinCredential`). */
  hasPin: boolean;
  lock(reason: LockReason): void;
  /** Called only by AppLockGate after a successful auth. */
  unlock(): void;
  refreshCredentialState(): Promise<void>;
  /** 15-07: resets the D-07/D-08 idle clock — any screen that observes real activity may call this. */
  noteInteraction(): void;
}

interface LockState {
  isLocked: boolean;
  lockReason: LockReason | null;
}

/**
 * Pure: the lock state a rep should see once the credential check resolves.
 * No credential → never locked out of an app they have not set a PIN for.
 * A credential exists → the app opens locked on cold start (this is what
 * makes SEC-03 real, per this plan's own `must_haves.truths`). `'idle'` is
 * reused as the cold-start reason — `AppLockGate` renders identical copy for
 * every `LockReason` (15-UI-SPEC.md §2 has no reason-specific text), so no
 * new reason value is needed for this case alone.
 */
export function resolveInitialLockState(hasPin: boolean): LockState {
  return hasPin ? { isLocked: true, lockReason: 'idle' } : { isLocked: false, lockReason: null };
}

/**
 * Pure: applies a `lock(reason)` call. Idempotent — if already locked, the
 * FIRST reason wins and `reason` is discarded (T-15-06-06).
 */
export function applyLock(current: LockState, reason: LockReason): LockState {
  if (current.isLocked) return current;
  return { isLocked: true, lockReason: reason };
}

/**
 * Pure: applies an `unlock()` call — clears both `isLocked` and
 * `lockReason`, UNLESS the current lock reason is `'remote-wipe'` (D-01):
 * that state is irreversible, and a correct PIN/biometric must not clear
 * it. Returns `current` unchanged in that case.
 */
export function applyUnlock(current: LockState): LockState {
  if (current.lockReason === 'remote-wipe') return current;
  return { isLocked: false, lockReason: null };
}

const AppLockContext = createContext<AppLockApi | undefined>(undefined);

/** Mirrors `AccessibilityProvider.tsx`'s `resolveAccessibilityContext` — a pure, directly-testable guard. */
export function resolveAppLockContext(ctx: AppLockApi | undefined): AppLockApi {
  if (!ctx) {
    throw new Error(
      'useAppLock must be used within an AppLockProvider — mount <AppLockProvider> above this screen (RootNavigator.tsx does this app-wide).',
    );
  }
  return ctx;
}

export function useAppLock(): AppLockApi {
  return resolveAppLockContext(useContext(AppLockContext));
}

export interface AppLockProviderProps {
  children: ReactNode;
}

export function AppLockProvider({ children }: AppLockProviderProps) {
  // Fail-secure default — see header comment. `hasPin: false` here is just
  // the pre-resolution placeholder; `isLocked` is what actually gates the
  // UI, and it defaults to `true` regardless of this placeholder value.
  const [lockState, setLockState] = useState<LockState>(() => resolveInitialLockState(true));
  const [hasPin, setHasPin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // The reinstall escape hatch runs FIRST: iOS keychain items survive app
    // deletion, so both the PIN and the failed-attempt counter come back with a
    // fresh install. Without this, a locked-out rep who deletes and re-sideloads
    // the app lands straight back on the same countdown.
    //
    // Belt and braces on the lookup itself: hasPinCredential swallows keychain
    // errors, but an unhandled rejection here would strand lockState on its
    // fail-secure default of isLocked:true with no way for the rep to unlock.
    void resetAppLockOnFreshInstall({
      storage: createMMKV({ id: INSTALL_MARKER_MMKV_ID }),
      clearPin: () => clearPinCredential(defaultPinDeps),
      clearAttempts: () => saveAttemptState(CLEARED_ATTEMPT_STATE, defaultPinDeps.store),
    })
      .catch(() => false)
      .then(() => hasPinCredential(defaultPinDeps))
      .catch(() => false)
      .then((resolved) => {
        if (cancelled) return;
        setHasPin(resolved);
        setLockState(resolveInitialLockState(resolved));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const lock = useCallback((reason: LockReason) => {
    setLockState((prev) => applyLock(prev, reason));
  }, []);

  const unlock = useCallback(() => {
    setLockState((prev) => applyUnlock(prev));
  }, []);

  const refreshCredentialState = useCallback(async () => {
    const resolved = await hasPinCredential(defaultPinDeps);
    setHasPin(resolved);
  }, []);

  // 15-07 (SEC-04): the two standing lock timers, mounted exactly once for
  // the whole app. `useAppStateLock` starts a grace window on any transition
  // INTO 'background' and calls `lock('background')` once
  // `BACKGROUND_GRACE_MS` (60 s) has elapsed — whether the app is still
  // backgrounded or has just come back. 'inactive' (a permission dialog, a
  // notification banner) neither locks nor starts a window. This replaces
  // D-05's original immediate, unconditional background lock, which the
  // operator overruled on 2026-08-27 after a field test; see
  // `autoLock/useAppStateLock.ts`'s header for the decision record and for
  // the four guarantees that still hold (no per-screen/per-flow exception
  // among them). `useIdleTimer` calls `lock('idle')` once its own D-07/D-08
  // deadline elapses, and returns `noteInteraction` for real-activity resets.
  useAppStateLock(lock);
  const { noteInteraction } = useIdleTimer(lock);

  // 15-11 (SEC-08): the remote-wipe connector, mounted exactly once, once the
  // PowerSync db singleton is ready. `db` is `null` until `useSessionDb()`
  // resolves (app cold start, or signed-out) — the connector attaches only
  // once a real db handle exists, and is torn down/re-attached if that
  // handle ever changes (a fresh sign-in after a sign-out, for example).
  const { db } = useSessionDb();
  useEffect(() => {
    if (!db) return;
    const wipeDeps = createDefaultRemoteWipeDeps({ db, lock });
    return attachRemoteWipeConnector(wipeDeps);
  }, [db, lock]);

  const value = useMemo<AppLockApi>(
    () => ({
      isLocked: lockState.isLocked,
      lockReason: lockState.lockReason,
      hasPin,
      lock,
      unlock,
      refreshCredentialState,
      noteInteraction,
    }),
    [lockState, hasPin, lock, unlock, refreshCredentialState, noteInteraction],
  );

  return <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>;
}
