import { describe, expect, it, vi } from 'vitest';

// This repo has no react-native-testing-library — the thin hook shells
// (`useIdleTimer`, `useHandoverSuspension`) transitively pull in
// `useSessionDb.ts` (-> lib/db/powersync.ts, a native PowerSync/op-sqlite
// import) and `settingsRepo.ts`/`settingsPolicyRepo.ts`. Mock the DB/session
// boundary at the module level (`ThemeProvider.test.tsx` precedent) so this
// file can import the module's PURE exports (`deriveIdleDeadline`,
// `attachIdleTimer`, `resolveEffectiveAutoLockMinutes`) without loading any
// native module. `useIdleTimer`/`useHandoverSuspension` themselves are not
// rendered/tested here, same split as `AppLockProvider.test.tsx`.
vi.mock('../../../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('../../settings/db/settingsRepo', () => ({
  createSettingsRepo: () => ({ watchSettings: () => () => {} }),
}));
vi.mock('../../settings/db/settingsPolicyRepo', () => ({
  createSettingsPolicyRepo: () => ({ watchPolicies: () => () => {} }),
}));

import {
  attachIdleTimer,
  deriveIdleDeadline,
  resolveEffectiveAutoLockMinutes,
  type IdleInput,
} from './useIdleTimer';
import { HANDOVER_SUSPENSION_CAP_MS, HANDOVER_WARNING_LEAD_MS } from './autoLockConstants';
import type { SettingRowState } from '../../settings/settingRowState';

describe('deriveIdleDeadline (D-07/D-08)', () => {
  it('is armed at lastInteraction + timeoutMinutes when no handover is mounted', () => {
    const result = deriveIdleDeadline({
      timeoutMinutes: 5,
      lastInteractionEpochMs: 1_000,
      handoverMountedSinceEpochMs: null,
    });
    expect(result).toEqual({ kind: 'armed', fireAtEpochMs: 1_000 + 300_000 });
  });

  it('the armed deadline consumes timeoutMinutes, never a hardcoded value', () => {
    const result = deriveIdleDeadline({
      timeoutMinutes: 1,
      lastInteractionEpochMs: 1_000,
      handoverMountedSinceEpochMs: null,
    });
    expect(result).toEqual({ kind: 'armed', fireAtEpochMs: 1_000 + 60_000 });
  });

  it('is suspended, with a cap and a warn time, once a handover mount is set', () => {
    const mountedAt = 5_000;
    const result = deriveIdleDeadline({
      timeoutMinutes: 5,
      lastInteractionEpochMs: 999_999, // irrelevant while suspended
      handoverMountedSinceEpochMs: mountedAt,
    });
    expect(result).toEqual({
      kind: 'suspended',
      capFiresAtEpochMs: mountedAt + HANDOVER_SUSPENSION_CAP_MS,
      warnAtEpochMs: mountedAt + HANDOVER_SUSPENSION_CAP_MS - HANDOVER_WARNING_LEAD_MS,
    });
  });

  it('the suspended cap is anchored to the MOUNT time, unaffected by a later lastInteractionEpochMs', () => {
    const mountedAt = 5_000;
    const early = deriveIdleDeadline({
      timeoutMinutes: 5,
      lastInteractionEpochMs: mountedAt,
      handoverMountedSinceEpochMs: mountedAt,
    });
    const muchLater = deriveIdleDeadline({
      timeoutMinutes: 5,
      lastInteractionEpochMs: mountedAt + 9 * 60_000, // signing activity 9 minutes later
      handoverMountedSinceEpochMs: mountedAt,
    });
    expect(early).toEqual(muchLater);
  });

  it('a timeoutMinutes of 60 while suspended still fires at the 10-minute cap — the cap is a ceiling, never a floor', () => {
    const mountedAt = 0;
    const result = deriveIdleDeadline({
      timeoutMinutes: 60,
      lastInteractionEpochMs: 0,
      handoverMountedSinceEpochMs: mountedAt,
    });
    expect(result.kind).toBe('suspended');
    expect((result as { capFiresAtEpochMs: number }).capFiresAtEpochMs).toBe(HANDOVER_SUSPENSION_CAP_MS);
  });

  it('re-arms immediately (from the current interaction time) the instant handoverMountedSinceEpochMs returns to null', () => {
    const suspended = deriveIdleDeadline({
      timeoutMinutes: 5,
      lastInteractionEpochMs: 1_000,
      handoverMountedSinceEpochMs: 5_000,
    });
    expect(suspended.kind).toBe('suspended');

    const rearmed = deriveIdleDeadline({
      timeoutMinutes: 5,
      lastInteractionEpochMs: 1_000,
      handoverMountedSinceEpochMs: null,
    });
    expect(rearmed).toEqual({ kind: 'armed', fireAtEpochMs: 1_000 + 300_000 });
  });

  it('there is no exported function/parameter/flag that pushes the cap later once mounted (single-parameter, no options object)', () => {
    expect(deriveIdleDeadline.length).toBe(1);
  });
});

describe('attachIdleTimer', () => {
  function fakeSchedule(): { schedule: (ms: number, cb: () => void) => () => void; fire(): void; cancelSpy: ReturnType<typeof vi.fn> } {
    let captured: (() => void) | undefined;
    const cancelSpy = vi.fn();
    return {
      schedule(_ms, cb) {
        captured = cb;
        return cancelSpy;
      },
      fire() {
        captured?.();
      },
      cancelSpy,
    };
  }

  it("calls lock('idle') when the armed deadline elapses", () => {
    const input: IdleInput = { timeoutMinutes: 5, lastInteractionEpochMs: 0, handoverMountedSinceEpochMs: null };
    const { schedule, fire } = fakeSchedule();
    const lock = vi.fn();
    attachIdleTimer(() => input, () => 0, schedule, lock);

    fire();
    expect(lock).toHaveBeenCalledWith('idle');
  });

  it("calls lock('idle') when the suspended cap elapses", () => {
    const input: IdleInput = { timeoutMinutes: 60, lastInteractionEpochMs: 0, handoverMountedSinceEpochMs: 0 };
    const { schedule, fire } = fakeSchedule();
    const lock = vi.fn();
    attachIdleTimer(() => input, () => 0, schedule, lock);

    fire();
    expect(lock).toHaveBeenCalledWith('idle');
  });

  it('never calls lock while suspended and before the cap — the scheduled delay is computed to the cap, not sooner', () => {
    const mountedAt = 1_000;
    const input: IdleInput = { timeoutMinutes: 5, lastInteractionEpochMs: 1_000, handoverMountedSinceEpochMs: mountedAt };
    let scheduledDelay = -1;
    const schedule = (ms: number, _cb: () => void) => {
      scheduledDelay = ms;
      return () => {};
    };
    attachIdleTimer(() => input, () => 1_000, schedule, vi.fn());

    expect(scheduledDelay).toBe(HANDOVER_SUSPENSION_CAP_MS);
  });

  it('returns a cleanup function that cancels the scheduled callback', () => {
    const input: IdleInput = { timeoutMinutes: 5, lastInteractionEpochMs: 0, handoverMountedSinceEpochMs: null };
    const { schedule, cancelSpy } = fakeSchedule();
    const cleanup = attachIdleTimer(() => input, () => 0, schedule, vi.fn());

    cleanup();
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });
});

describe('resolveEffectiveAutoLockMinutes', () => {
  const free: SettingRowState = { kind: 'free' };

  it("falls back to AUTO_LOCK_DEFAULT_MINUTES when the stored preference is null and the row is 'free'", () => {
    expect(resolveEffectiveAutoLockMinutes(null, free)).toBe(5);
  });

  it("uses the rep's own stored value when free", () => {
    expect(resolveEffectiveAutoLockMinutes(15, free)).toBe(15);
  });

  it('a ceiling can only make the effective value STRICTER (shorter), never longer than the rep\'s own choice', () => {
    const ceiling: SettingRowState = { kind: 'ceiling', value: '5' };
    expect(resolveEffectiveAutoLockMinutes(30, ceiling)).toBe(5);
    expect(resolveEffectiveAutoLockMinutes(1, ceiling)).toBe(1); // already stricter than the ceiling — unaffected
  });
});
