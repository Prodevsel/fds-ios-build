import { describe, expect, it } from 'vitest';

import { deriveWalletState } from './deriveWalletState';

const DAY_MS = 24 * 60 * 60 * 1000;
const WIDERRUF_MS = 14 * DAY_MS;
const SIGNED = '2026-07-01T10:00:00.000Z';
const signedMs = new Date(SIGNED).getTime();

describe('deriveWalletState (D-01, pure classifier)', () => {
  it("returns 'in_review' while the 14-day Widerrufsfrist is still running", () => {
    expect(deriveWalletState(SIGNED, signedMs + 5 * DAY_MS, null)).toBe('in_review');
  });

  it("returns 'in_review' at exactly one millisecond before 14 days", () => {
    expect(deriveWalletState(SIGNED, signedMs + WIDERRUF_MS - 1, null)).toBe('in_review');
  });

  it("returns 'secured' at exactly 14 days elapsed (boundary is inclusive)", () => {
    expect(deriveWalletState(SIGNED, signedMs + WIDERRUF_MS, null)).toBe('secured');
  });

  it("returns 'secured' after 14 days with no cancellation", () => {
    expect(deriveWalletState(SIGNED, signedMs + 30 * DAY_MS, null)).toBe('secured');
  });

  it("returns 'reversed' when cancelled inside the window", () => {
    expect(deriveWalletState(SIGNED, signedMs + 3 * DAY_MS, '2026-07-03T09:00:00.000Z')).toBe(
      'reversed',
    );
  });

  it("returns 'reversed' when cancelled EVEN after 14 days have elapsed (reversal wins first)", () => {
    // Past the Widerrufsfrist, a cancelled deal must never silently roll into 'secured'.
    expect(deriveWalletState(SIGNED, signedMs + 40 * DAY_MS, '2026-08-20T09:00:00.000Z')).toBe(
      'reversed',
    );
  });
});
