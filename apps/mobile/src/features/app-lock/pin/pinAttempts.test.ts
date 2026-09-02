import { describe, expect, it } from 'vitest';
import {
  attemptsUntilWipe,
  BACKOFF_SCHEDULE_SECONDS,
  BACKOFF_START_ATTEMPT,
  CLEARED_ATTEMPT_STATE,
  deriveGateState,
  loadAttemptState,
  PIN_ATTEMPTS_ALIAS,
  recordFailure,
  saveAttemptState,
  shouldShowWipeWarning,
  WIPE_AT_ATTEMPT,
  WIPE_WARNING_FROM_ATTEMPT,
  type AttemptState,
} from './pinAttempts';
import type { PinStore } from './pinHash';

const t0 = Date.parse('2026-08-17T10:00:00.000Z');

function makeFakeStore(initial: Record<string, string> = {}) {
  const entries = new Map<string, string>(Object.entries(initial));
  const store: PinStore = {
    async getItemAsync(key: string) {
      return entries.get(key) ?? null;
    },
    async setItemAsync(key: string, value: string) {
      entries.set(key, value);
    },
    async deleteItemAsync(key: string) {
      entries.delete(key);
    },
  };
  return { store, entries };
}

/** Applies `n` consecutive failures starting from CLEARED_ATTEMPT_STATE, each at time `t0`. */
function failNTimes(n: number, now = t0): AttemptState {
  let state = CLEARED_ATTEMPT_STATE;
  for (let i = 0; i < n; i++) {
    state = recordFailure(state, now);
  }
  return state;
}

describe('constants', () => {
  it('pins the exact D-12 thresholds and schedule', () => {
    expect(BACKOFF_START_ATTEMPT).toBe(5);
    expect(WIPE_WARNING_FROM_ATTEMPT).toBe(8);
    expect(WIPE_AT_ATTEMPT).toBe(10);
    expect(BACKOFF_SCHEDULE_SECONDS).toEqual([30, 60, 120, 240, 480]);
  });
});

describe('recordFailure', () => {
  it('first failure: failedAttempts 1, no backoff yet', () => {
    const result = recordFailure(CLEARED_ATTEMPT_STATE, t0);
    expect(result).toEqual({ failedAttempts: 1, backoffUntilEpochMs: null });
  });

  it('failures 1 through 4 leave backoffUntilEpochMs null', () => {
    for (let n = 1; n <= 4; n++) {
      const state = failNTimes(n);
      expect(state.backoffUntilEpochMs).toBeNull();
      expect(state.failedAttempts).toBe(n);
    }
  });

  it('the 5th through 9th failures set backoffUntilEpochMs per BACKOFF_SCHEDULE_SECONDS, index-for-index', () => {
    const expectedSeconds = [30, 60, 120, 240, 480];
    for (let i = 0; i < expectedSeconds.length; i++) {
      const attemptNumber = 5 + i;
      const state = failNTimes(attemptNumber);
      expect(state.backoffUntilEpochMs).toBe(t0 + expectedSeconds[i]! * 1000);
    }
  });

  it('the 10th failure reaches WIPE_AT_ATTEMPT and further calls are inert', () => {
    const state10 = failNTimes(10);
    expect(state10.failedAttempts).toBe(10);

    const state11 = recordFailure(state10, t0 + 999_000);
    expect(state11).toEqual(state10);
  });
});

describe('deriveGateState', () => {
  it('ready for each of attempts 1-4', () => {
    for (let n = 1; n <= 4; n++) {
      const state = failNTimes(n);
      expect(deriveGateState(state, t0)).toEqual({ kind: 'ready' });
    }
  });

  it('during a backoff window returns backoff with secondsRemaining rounded UP (never 0s while still locked)', () => {
    const state = failNTimes(5); // 30s backoff
    // 29.4s remaining -> must round up to 30, never display 0s or 29 early.
    const almostExpired = deriveGateState(state, t0 + 600); // 0.6s elapsed, 29.4s left
    expect(almostExpired).toEqual({ kind: 'backoff', secondsRemaining: 30 });

    const oneSecondLeft = deriveGateState(state, t0 + 29_500); // 0.5s left
    expect(oneSecondLeft).toEqual({ kind: 'backoff', secondsRemaining: 1 });
  });

  it('once now >= backoffUntilEpochMs, returns ready', () => {
    const state = failNTimes(5); // 30s backoff
    expect(deriveGateState(state, t0 + 30_000)).toEqual({ kind: 'ready' });
    expect(deriveGateState(state, t0 + 31_000)).toEqual({ kind: 'ready' });
  });

  it('the 10th failure yields wipe regardless of the clock — terminal even when backoffUntilEpochMs is in the past', () => {
    const state = failNTimes(10);
    expect(deriveGateState(state, t0)).toEqual({ kind: 'wipe' });
    expect(deriveGateState(state, t0 + 10_000_000)).toEqual({ kind: 'wipe' });
  });
});

describe('shouldShowWipeWarning', () => {
  it('false at 7 failures, true at 8 and 9', () => {
    expect(shouldShowWipeWarning(failNTimes(7))).toBe(false);
    expect(shouldShowWipeWarning(failNTimes(8))).toBe(true);
    expect(shouldShowWipeWarning(failNTimes(9))).toBe(true);
  });

  it('false once wiped (10)', () => {
    expect(shouldShowWipeWarning(failNTimes(10))).toBe(false);
  });
});

describe('attemptsUntilWipe', () => {
  it('returns 2 at 8 failures and 1 at 9 failures', () => {
    expect(attemptsUntilWipe(failNTimes(8))).toBe(2);
    expect(attemptsUntilWipe(failNTimes(9))).toBe(1);
  });

  it('returns 0 once at or past the wipe threshold', () => {
    expect(attemptsUntilWipe(failNTimes(10))).toBe(0);
  });
});

describe('loadAttemptState / saveAttemptState', () => {
  it('a successful unlock resets to CLEARED_ATTEMPT_STATE and round-trips', async () => {
    const { store } = makeFakeStore();
    await saveAttemptState(CLEARED_ATTEMPT_STATE, store);
    const loaded = await loadAttemptState(store);
    expect(loaded).toEqual({ failedAttempts: 0, backoffUntilEpochMs: null });
  });

  it('a real attempt state round-trips through JSON', async () => {
    const { store } = makeFakeStore();
    const state = failNTimes(6);
    await saveAttemptState(state, store);
    const loaded = await loadAttemptState(store);
    expect(loaded).toEqual(state);
  });

  it('absent, empty, or unparseable stored values return CLEARED_ATTEMPT_STATE and never throw', async () => {
    const { store: absentStore } = makeFakeStore();
    await expect(loadAttemptState(absentStore)).resolves.toEqual(CLEARED_ATTEMPT_STATE);

    const { store: emptyStore } = makeFakeStore({ [PIN_ATTEMPTS_ALIAS]: '' });
    await expect(loadAttemptState(emptyStore)).resolves.toEqual(CLEARED_ATTEMPT_STATE);

    const { store: garbageStore } = makeFakeStore({ [PIN_ATTEMPTS_ALIAS]: 'not-json{{{' });
    await expect(loadAttemptState(garbageStore)).resolves.toEqual(CLEARED_ATTEMPT_STATE);
  });

  it('a forged negative or non-numeric failedAttempts normalizes rather than being trusted', async () => {
    const { store: negativeStore } = makeFakeStore({
      [PIN_ATTEMPTS_ALIAS]: JSON.stringify({ failedAttempts: -5, backoffUntilEpochMs: null }),
    });
    await expect(loadAttemptState(negativeStore)).resolves.toEqual(CLEARED_ATTEMPT_STATE);

    const { store: nonNumericStore } = makeFakeStore({
      [PIN_ATTEMPTS_ALIAS]: JSON.stringify({ failedAttempts: 'nine', backoffUntilEpochMs: null }),
    });
    await expect(loadAttemptState(nonNumericStore)).resolves.toEqual(CLEARED_ATTEMPT_STATE);
  });
});

describe('module discipline — never reads the clock itself', () => {
  it('the source never calls Date.now()', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./pinAttempts.ts', import.meta.url));
    const source = readFileSync(sourcePath, 'utf-8');
    expect(source).not.toMatch(/Date\.now\(\)/);
  });
});

describe('header comment (D-04 / D-10 / D-12)', () => {
  it('contains D-04, D-10, and D-12', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./pinAttempts.ts', import.meta.url));
    const source = readFileSync(sourcePath, 'utf-8');
    expect(source).toContain('D-04');
    expect(source).toContain('D-10');
    expect(source).toContain('D-12');
  });
});
