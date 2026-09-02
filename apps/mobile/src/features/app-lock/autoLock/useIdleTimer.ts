import { useCallback, useEffect, useRef, useState } from 'react';
import { useSessionDb } from '../../../app/useSessionDb';
import { createSettingsRepo } from '../../settings/db/settingsRepo';
import { createSettingsPolicyRepo } from '../../settings/db/settingsPolicyRepo';
import { deriveSettingRowState, type SettingRowState } from '../../settings/settingRowState';
import { AUTO_LOCK_DEFAULT_MINUTES, HANDOVER_SUSPENSION_CAP_MS, HANDOVER_WARNING_LEAD_MS } from './autoLockConstants';

/**
 * D-07 (15-CONTEXT.md): the idle timeout — and ONLY the idle timeout — is
 * suspended while the customer-handover/signature-capture screen is
 * actually mounted. Scope is that screen ONLY, NOT the whole checkout flow:
 * checkout is exactly when scanned ID documents and IBANs are on screen, so
 * suspending the idle timer for all of checkout would open the confidential-
 * data window at the worst possible moment. `deriveIdleDeadline` below has
 * no "checkout mode" input at all — only `handoverMountedSinceEpochMs`,
 * which `SignatureBlock.tsx`'s `useHandoverSuspension()` sets on mount and
 * clears on unmount (back-navigation, app switch, or the step advancing).
 *
 * D-08: the suspension is HARD-CAPPED at `HANDOVER_SUSPENSION_CAP_MS`
 * (10 minutes), measured from the moment the handover screen MOUNTS, never
 * from the last interaction and never pushed later by continued signing
 * activity. A handover screen still open after ten minutes is an abandoned
 * session, not a signing — the app locks regardless of what is mounted.
 * There is no exported function, parameter, or flag anywhere in this module
 * that can push the cap later once the handover screen has mounted.
 *
 * Timer correctness: the JS `Date` wall-clock is rep-adjustable (a changed
 * system clock could make a deadline never arrive, or arrive instantly) —
 * every clock read in this module goes through `performance.now()`
 * (monotonic, immune to wall-clock changes) instead. `deriveIdleDeadline` is
 * pure and takes every timestamp explicitly, so the whole D-07/D-08 rule is
 * unit-testable without faking a global clock; `attachIdleTimer` takes `now`
 * and `schedule` as injected parameters (DI, mirrors `useSettings.ts`'s
 * `attachSettingsWatch`/`attachPoliciesWatch` and `useMarkFirstSync.ts`'s
 * `attachMarkFirstSync` precedent) so a test drives the clock directly.
 *
 * `useIdleTimer` (mounted exactly once, from `AppLockProvider.tsx`) and
 * `useHandoverSuspension` (mounted from `SignatureBlock.tsx`, deep inside a
 * completely separate part of the component tree with no common ancestor
 * below the app root) communicate through a small module-singleton
 * registry at the bottom of this file — not React context — because the two
 * hooks never share a parent below `RootNavigator`. Safe because at most one
 * `AppLockProvider` and at most one mounted handover screen ever exist at a
 * time.
 *
 * `timeoutMinutes` is the EFFECTIVE value: the rep's own
 * `user_settings.auto_lock_timeout_minutes` (via `settingsRepo.ts`,
 * unchanged, not rebuilt) resolved against any org ceiling via the existing
 * `settingRowState.ts`/`deriveSettingRowState` derivation (13-01, unchanged,
 * not rebuilt), falling back to `AUTO_LOCK_DEFAULT_MINUTES` when the
 * preference is null (`resolveEffectiveAutoLockMinutes` below).
 */

export interface IdleInput {
  /** The rep's EFFECTIVE auto-lock timeout, in minutes (`resolveEffectiveAutoLockMinutes`). */
  timeoutMinutes: number;
  /** Monotonic clock reading (NOT wall-clock) of the last recorded interaction. */
  lastInteractionEpochMs: number;
  /** Monotonic clock reading of when the handover screen mounted, or `null` while it is not mounted. */
  handoverMountedSinceEpochMs: number | null;
}

export type IdleDecision =
  | { kind: 'armed'; fireAtEpochMs: number }
  | { kind: 'suspended'; capFiresAtEpochMs: number; warnAtEpochMs: number };

/**
 * Pure: the entire D-07/D-08 rule. No wall-clock read, no hook calls — every
 * timestamp is an explicit input, so this is fully unit-testable in
 * isolation.
 *
 * - Not suspended (`handoverMountedSinceEpochMs === null`): armed at
 *   `lastInteractionEpochMs + timeoutMinutes * 60_000`.
 * - Suspended: the cap is anchored to the MOUNT time
 *   (`handoverMountedSinceEpochMs + HANDOVER_SUSPENSION_CAP_MS`) — NEVER to
 *   `lastInteractionEpochMs`, so continued signing activity cannot push the
 *   cap later. The cap is a CEILING on the suspension, never a floor that
 *   lengthens `timeoutMinutes` — a `timeoutMinutes` of 60 while suspended
 *   still fires at the 10-minute cap.
 */
export function deriveIdleDeadline(input: IdleInput): IdleDecision {
  const { timeoutMinutes, lastInteractionEpochMs, handoverMountedSinceEpochMs } = input;

  if (handoverMountedSinceEpochMs !== null) {
    const capFiresAtEpochMs = handoverMountedSinceEpochMs + HANDOVER_SUSPENSION_CAP_MS;
    return { kind: 'suspended', capFiresAtEpochMs, warnAtEpochMs: capFiresAtEpochMs - HANDOVER_WARNING_LEAD_MS };
  }

  return { kind: 'armed', fireAtEpochMs: lastInteractionEpochMs + timeoutMinutes * 60_000 };
}

/**
 * DI'd: reads the current `IdleInput` (via `read`), derives the deadline,
 * and schedules exactly one callback (via the injected `schedule`, an
 * `attachMarkFirstSync`-style `(ms, cb) => cancel` shape) that calls
 * `lock('idle')` once the deadline is reached. Returns a cleanup function
 * that cancels the scheduled callback.
 *
 * This function computes ONE deadline from the input at the moment it is
 * called — it does not itself watch for later input changes. The caller
 * (`useIdleTimer` below) re-invokes `attachIdleTimer` (tearing down the
 * previous subscription first) whenever a relevant input changes
 * (an interaction, a handover mount/unmount, or the effective timeout
 * itself changing) — the same re-subscribe-on-change shape
 * `useSettings.ts`'s `attachSettingsWatch`/`attachPoliciesWatch` already
 * use in this repo, just re-triggered from `useEffect` deps instead of a
 * DB watch callback.
 */
export function attachIdleTimer(
  read: () => IdleInput,
  now: () => number,
  schedule: (ms: number, cb: () => void) => () => void,
  lock: (reason: 'idle') => void,
): () => void {
  const decision = deriveIdleDeadline(read());
  const targetEpochMs = decision.kind === 'armed' ? decision.fireAtEpochMs : decision.capFiresAtEpochMs;
  const delayMs = Math.max(0, targetEpochMs - now());
  return schedule(delayMs, () => lock('idle'));
}

/**
 * Pure: resolves the EFFECTIVE auto-lock minutes from the rep's own stored
 * preference plus this key's `SettingRowState` (13-01's ceiling model,
 * `settingRowState.ts`, unchanged). A `null` stored preference (never set)
 * falls back to `AUTO_LOCK_DEFAULT_MINUTES` (D-17). A `'ceiling'` row state
 * can only make the effective value STRICTER (shorter) than the rep's own
 * choice — never longer — matching the server-side
 * `setting_value_within_ceiling()` invariant (0076) the client must agree
 * with.
 */
export function resolveEffectiveAutoLockMinutes(storedMinutes: number | null, rowState: SettingRowState): number {
  const base = storedMinutes ?? AUTO_LOCK_DEFAULT_MINUTES;
  if (rowState.kind === 'ceiling') {
    return Math.min(base, Number(rowState.value));
  }
  return base;
}

// --- Module-singleton handover-mount registry (see file header) ---------

type HandoverListener = (mountedAtEpochMs: number | null) => void;

let sharedHandoverMountedSinceEpochMs: number | null = null;
const handoverListeners = new Set<HandoverListener>();

function registerHandoverMount(mountedAtEpochMs: number): void {
  sharedHandoverMountedSinceEpochMs = mountedAtEpochMs;
  handoverListeners.forEach((listener) => listener(mountedAtEpochMs));
}

function unregisterHandoverMount(): void {
  sharedHandoverMountedSinceEpochMs = null;
  handoverListeners.forEach((listener) => listener(null));
}

function subscribeHandoverMount(listener: HandoverListener): () => void {
  handoverListeners.add(listener);
  return () => {
    handoverListeners.delete(listener);
  };
}

// --- Thin hook shells (untested via a renderer — no react-native-testing- --
// --- library in this repo, mirrors AppLockProvider.tsx/ThemeProvider.tsx) --

/**
 * Thin shell: resolves the EFFECTIVE `auto_lock_timeout_minutes` by
 * composing the EXISTING settings substrate (`settingsRepo.ts`,
 * `settingsPolicyRepo.ts`, `settingRowState.ts`) — mirrors
 * `EinstellungenScreen.tsx`'s own independent `auto_lock_timeout_minutes`
 * watch (that screen's own comment explains why: `useSettings.ts`'s cached
 * snapshot deliberately excludes this column). Starts at
 * `AUTO_LOCK_DEFAULT_MINUTES` before the DB/session resolve.
 */
function useEffectiveAutoLockMinutes(): number {
  const { db, userId } = useSessionDb();
  const [minutes, setMinutes] = useState<number>(AUTO_LOCK_DEFAULT_MINUTES);

  useEffect(() => {
    if (!db || !userId) return;
    const settingsRepo = createSettingsRepo({ db });
    const policyRepo = createSettingsPolicyRepo({ db });

    let storedMinutes: number | null = null;
    let rowState: SettingRowState = { kind: 'free' };
    const recompute = () => setMinutes(resolveEffectiveAutoLockMinutes(storedMinutes, rowState));

    const unsubscribeSettings = settingsRepo.watchSettings(userId, (row) => {
      storedMinutes = row?.autoLockTimeoutMinutes ?? null;
      recompute();
    });
    const unsubscribePolicies = policyRepo.watchPolicies((policies) => {
      rowState = deriveSettingRowState('auto_lock_timeout_minutes', policies);
      recompute();
    });

    return () => {
      unsubscribeSettings();
      unsubscribePolicies();
    };
  }, [db, userId]);

  return minutes;
}

export interface UseIdleTimerApi {
  /** Called by any screen that wants to reset the idle clock on real activity. */
  noteInteraction(): void;
}

/**
 * Thin shell: wires `attachIdleTimer` to RN's real `setTimeout`/
 * `performance.now()`, re-subscribing whenever the effective timeout, an
 * interaction, or the shared handover-mount state changes. Mounted exactly
 * once, from `AppLockProvider.tsx`.
 */
export function useIdleTimer(lock: (reason: 'idle') => void): UseIdleTimerApi {
  const timeoutMinutes = useEffectiveAutoLockMinutes();
  const lastInteractionRef = useRef<number>(performance.now());
  const handoverRef = useRef<number | null>(sharedHandoverMountedSinceEpochMs);
  const [handoverVersion, setHandoverVersion] = useState(0);
  const [interactionVersion, setInteractionVersion] = useState(0);

  useEffect(() => {
    return subscribeHandoverMount((mountedAtEpochMs) => {
      handoverRef.current = mountedAtEpochMs;
      setHandoverVersion((v) => v + 1);
    });
  }, []);

  const noteInteraction = useCallback(() => {
    lastInteractionRef.current = performance.now();
    setInteractionVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    return attachIdleTimer(
      () => ({
        timeoutMinutes,
        lastInteractionEpochMs: lastInteractionRef.current,
        handoverMountedSinceEpochMs: handoverRef.current,
      }),
      () => performance.now(),
      (ms, cb) => {
        const id = setTimeout(cb, ms);
        return () => clearTimeout(id);
      },
      lock,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lastInteractionRef/handoverRef are refs read at re-subscribe time; handoverVersion/interactionVersion are the deliberate re-subscribe triggers.
  }, [timeoutMinutes, handoverVersion, interactionVersion, lock]);

  return { noteInteraction };
}

export interface UseHandoverSuspensionApi {
  /** True once the D-08 cap is `HANDOVER_WARNING_LEAD_MS` away — UI-SPEC §3's single-line heads-up. */
  warningVisible: boolean;
}

/**
 * Thin shell for `SignatureBlock.tsx`: registers the handover mount on
 * mount, clears it on unmount — back-navigation, an app switch, or the step
 * advancing all unmount this component, so the suspension ends the instant
 * this hook stops being mounted (D-07). Exposes ONLY `warningVisible` — no
 * affordance of any kind for pushing the cap later or dismissing it early
 * exists here or anywhere else in this module (UI-SPEC §3, D-08's
 * unconditional cap).
 */
export function useHandoverSuspension(): UseHandoverSuspensionApi {
  const [warningVisible, setWarningVisible] = useState(false);

  useEffect(() => {
    const mountedAtEpochMs = performance.now();
    registerHandoverMount(mountedAtEpochMs);
    setWarningVisible(false);

    const warnDelayMs = Math.max(0, HANDOVER_SUSPENSION_CAP_MS - HANDOVER_WARNING_LEAD_MS);
    const warnTimer = setTimeout(() => setWarningVisible(true), warnDelayMs);

    return () => {
      clearTimeout(warnTimer);
      unregisterHandoverMount();
    };
  }, []);

  return { warningVisible };
}
