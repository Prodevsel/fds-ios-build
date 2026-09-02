import { describe, expect, it } from 'vitest';

import { computeCommissionEur } from './computeCommissionEur';

describe('computeCommissionEur (D-07, flat vs percent, NaN-safe)', () => {
  it('returns the flat rate directly for flat_eur (base is ignored)', () => {
    expect(computeCommissionEur('flat_eur', 100, null)).toBe(100);
    expect(computeCommissionEur('flat_eur', 100, 2000)).toBe(100);
  });

  it('returns base * rate / 100 for percent', () => {
    expect(computeCommissionEur('percent', 10, 2000)).toBe(200);
    expect(computeCommissionEur('percent', 2.5, 1000)).toBe(25);
  });

  it('returns null for percent when the base is missing', () => {
    expect(computeCommissionEur('percent', 10, null)).toBeNull();
  });

  it('returns null when the rate_type is null', () => {
    expect(computeCommissionEur(null, 100, 2000)).toBeNull();
  });

  it('returns null when the rate is null', () => {
    expect(computeCommissionEur('flat_eur', null, null)).toBeNull();
    expect(computeCommissionEur('percent', null, 2000)).toBeNull();
  });

  it('returns null (never NaN) when a numeric input is NaN', () => {
    expect(computeCommissionEur('flat_eur', Number.NaN, null)).toBeNull();
    expect(computeCommissionEur('percent', Number.NaN, 2000)).toBeNull();
    expect(computeCommissionEur('percent', 10, Number.NaN)).toBeNull();
  });

  it('never returns NaN across a matrix of degenerate inputs', () => {
    const rateTypes: Array<'flat_eur' | 'percent' | null> = ['flat_eur', 'percent', null];
    const values: Array<number | null> = [0, 10, Number.NaN, null];
    for (const rateType of rateTypes) {
      for (const rate of values) {
        for (const base of values) {
          const result = computeCommissionEur(rateType, rate, base);
          if (result !== null) {
            expect(Number.isNaN(result)).toBe(false);
          }
        }
      }
    }
  });
});
