import { describe, expect, it } from 'vitest';
import {
  AUTO_LOCK_DEFAULT_MINUTES,
  BACKGROUND_GRACE_MS,
  HANDOVER_SUSPENSION_CAP_MS,
  HANDOVER_WARNING_LEAD_MS,
} from './autoLockConstants';
import { AUTO_LOCK_TIMEOUT_MINUTES_OPTIONS } from '../../settings/autoLockOptions';

describe('AUTO_LOCK_DEFAULT_MINUTES', () => {
  it('is literally 5 (D-17 provisional default)', () => {
    expect(AUTO_LOCK_DEFAULT_MINUTES).toBe(5);
  });

  it('is a member of the existing closed AUTO_LOCK_TIMEOUT_MINUTES_OPTIONS set — a future edit to either constant fails loudly', () => {
    expect(AUTO_LOCK_TIMEOUT_MINUTES_OPTIONS).toContain(AUTO_LOCK_DEFAULT_MINUTES);
  });
});

describe('HANDOVER_SUSPENSION_CAP_MS', () => {
  it('is exactly 10 minutes (D-08 hard cap)', () => {
    expect(HANDOVER_SUSPENSION_CAP_MS).toBe(10 * 60 * 1000);
  });
});

describe('HANDOVER_WARNING_LEAD_MS', () => {
  it('is exactly 2 minutes before the cap (UI-SPEC §3, the 8-minute heads-up mark)', () => {
    expect(HANDOVER_WARNING_LEAD_MS).toBe(2 * 60 * 1000);
    expect(HANDOVER_SUSPENSION_CAP_MS - HANDOVER_WARNING_LEAD_MS).toBe(8 * 60 * 1000);
  });
});

describe('BACKGROUND_GRACE_MS', () => {
  // Asserted as a literal, never via a grep on the header prose above it:
  // the operator overruled D-05 on 2026-08-27 with a SPECIFIC duration, and
  // a silent drift of that duration is exactly the regression this catches.
  it('is exactly 60 seconds (the 2026-08-27 overrule of D-05)', () => {
    expect(BACKGROUND_GRACE_MS).toBe(60 * 1000);
  });

  it('is far shorter than the idle-timeout default — the grace is a step-out window, not a second idle timer', () => {
    expect(BACKGROUND_GRACE_MS).toBeLessThan(AUTO_LOCK_DEFAULT_MINUTES * 60 * 1000);
  });
});
