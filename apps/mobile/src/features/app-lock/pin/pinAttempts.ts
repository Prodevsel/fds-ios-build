import type { PinStore } from './pinHash';

/**
 * D-12 failed-attempt policy — exponential backoff from the 5th failure,
 * terminal local wipe at the 10th. Maps 1:1 onto 15-UI-SPEC.md §1's four
 * visual bands: attempts 1-4 (inline error only), 5-9 (backoff countdown),
 * 8-9 (an ADDITIONAL persistent non-dismissible pre-wipe banner layered on
 * top of the backoff copy), 10 (wipe).
 *
 * Every exported function except `loadAttemptState`/`saveAttemptState` is
 * pure and takes `nowEpochMs` as an explicit parameter — this module never
 * reads the system clock itself, so the whole schedule is deterministically
 * testable without fake timers.
 *
 * `{kind: 'wipe'}` is TERMINAL: once `failedAttempts >= WIPE_AT_ATTEMPT`,
 * `deriveGateState` returns `{kind: 'wipe'}` unconditionally, regardless of
 * the clock — nothing about the passage of time can clear it. D-04 requires
 * its consumer (plan 15-10) to route this into the SAME drain-then-purge
 * wipe machinery used by the rep-triggered local wipe and the remote wipe —
 * never a second, parallel wipe implementation for the PIN-lockout entry
 * point.
 *
 * D-10: a biometric sensor read failure (wet/gloved hands, sensor error) is
 * NOT a wrong PIN. This module's counter is advanced ONLY by a wrong PIN —
 * `recordFailure` must never be called for a biometric error. Enforcing
 * that call discipline is 15-06's job (the gate screen); this module simply
 * never exposes a biometric-specific entry point that could tempt a caller
 * into wiring it wrong.
 */

export const BACKOFF_START_ATTEMPT = 5;
export const WIPE_WARNING_FROM_ATTEMPT = 8;
export const WIPE_AT_ATTEMPT = 10;

/** Seconds, index 0 = the 5th failure's backoff, index 4 = the 9th's. */
export const BACKOFF_SCHEDULE_SECONDS = [30, 60, 120, 240, 480] as const;

export const PIN_ATTEMPTS_ALIAS = 'fds_pin_attempts_v1';

export interface AttemptState {
  failedAttempts: number;
  backoffUntilEpochMs: number | null;
}

export type GateState =
  | { kind: 'ready' }
  | { kind: 'backoff'; secondsRemaining: number }
  | { kind: 'wipe' };

export const CLEARED_ATTEMPT_STATE: AttemptState = {
  failedAttempts: 0,
  backoffUntilEpochMs: null,
};

/**
 * Records one failed PIN attempt. Pure: takes `nowEpochMs` explicitly, never
 * reads the clock itself. Attempts 1-4 leave `backoffUntilEpochMs` null;
 * from the 5th (`BACKOFF_START_ATTEMPT`) onward, sets a backoff window per
 * `BACKOFF_SCHEDULE_SECONDS`, indexed by `failedAttempts - BACKOFF_START_ATTEMPT`.
 * Once `failedAttempts` reaches `WIPE_AT_ATTEMPT`, further calls are inert —
 * the wipe state is terminal, there is no attempt 11 behavior to compute.
 */
export function recordFailure(prev: AttemptState, nowEpochMs: number): AttemptState {
  if (prev.failedAttempts >= WIPE_AT_ATTEMPT) {
    return prev;
  }

  const failedAttempts = prev.failedAttempts + 1;
  const scheduleIndex = failedAttempts - BACKOFF_START_ATTEMPT;
  const backoffSeconds =
    scheduleIndex >= 0 && scheduleIndex < BACKOFF_SCHEDULE_SECONDS.length
      ? BACKOFF_SCHEDULE_SECONDS[scheduleIndex]
      : undefined;

  return {
    failedAttempts,
    backoffUntilEpochMs: backoffSeconds !== undefined ? nowEpochMs + backoffSeconds * 1000 : null,
  };
}

/**
 * Derives the current gate UI state from `state` at `nowEpochMs`. `{kind:
 * 'wipe'}` is checked FIRST and is terminal — a past `backoffUntilEpochMs`
 * never overrides it. Otherwise: an active backoff window (now < until)
 * yields `{kind: 'backoff', secondsRemaining}`, rounded UP via `Math.ceil`
 * so the countdown never displays `0s` while still actually locked; once
 * the window has elapsed, `{kind: 'ready'}`.
 */
export function deriveGateState(state: AttemptState, nowEpochMs: number): GateState {
  if (state.failedAttempts >= WIPE_AT_ATTEMPT) {
    return { kind: 'wipe' };
  }

  if (state.backoffUntilEpochMs !== null && nowEpochMs < state.backoffUntilEpochMs) {
    const secondsRemaining = Math.ceil((state.backoffUntilEpochMs - nowEpochMs) / 1000);
    return { kind: 'backoff', secondsRemaining };
  }

  return { kind: 'ready' };
}

/** How many more failures until the terminal wipe (never negative, 0 once already at/past it). */
export function attemptsUntilWipe(state: AttemptState): number {
  return Math.max(0, WIPE_AT_ATTEMPT - state.failedAttempts);
}

/** True from `WIPE_WARNING_FROM_ATTEMPT` (8) through the attempt just before the wipe (9) — the mandatory pre-wipe banner window. */
export function shouldShowWipeWarning(state: AttemptState): boolean {
  return state.failedAttempts >= WIPE_WARNING_FROM_ATTEMPT && state.failedAttempts < WIPE_AT_ATTEMPT;
}

/** Narrowing guard — never `any` (CLAUDE.md: `unknown` + narrowing). */
function isValidAttemptState(value: unknown): value is AttemptState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const { failedAttempts, backoffUntilEpochMs } = candidate;
  const failedAttemptsValid =
    typeof failedAttempts === 'number' && Number.isInteger(failedAttempts) && failedAttempts >= 0;
  const backoffValid = backoffUntilEpochMs === null || typeof backoffUntilEpochMs === 'number';
  return failedAttemptsValid && backoffValid;
}

/**
 * Loads the persisted attempt state. Defensive: an absent value, an
 * unparseable value, or a value that does not conform to `AttemptState`'s
 * shape (including a forged negative or non-numeric `failedAttempts`) all
 * normalize to `CLEARED_ATTEMPT_STATE` rather than being trusted — never
 * throws.
 */
export async function loadAttemptState(store: PinStore): Promise<AttemptState> {
  const raw = await store.getItemAsync(PIN_ATTEMPTS_ALIAS);
  if (!raw) {
    return CLEARED_ATTEMPT_STATE;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return CLEARED_ATTEMPT_STATE;
  }

  if (!isValidAttemptState(parsed)) {
    return CLEARED_ATTEMPT_STATE;
  }

  return parsed;
}

/** Persists `state` as JSON via the shared `PinStore` (WHEN_UNLOCKED_THIS_DEVICE_ONLY on the real wiring, applied by `defaultPinDeps.store`). */
export async function saveAttemptState(state: AttemptState, store: PinStore): Promise<void> {
  await store.setItemAsync(PIN_ATTEMPTS_ALIAS, JSON.stringify(state));
}
