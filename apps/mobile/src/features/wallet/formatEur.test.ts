import { describe, expect, it } from 'vitest';

import { formatEur } from './formatEur';

describe('formatEur (Hermes-safe de-DE currency)', () => {
  it('groups thousands with "." and uses "," as the decimal separator', () => {
    expect(formatEur(1234.5)).toBe('1.234,50 €');
  });

  it('adds no separator below 1000', () => {
    expect(formatEur(12)).toBe('12,00 €');
    expect(formatEur(999.9)).toBe('999,90 €');
  });

  it('formats zero as "0,00 €"', () => {
    expect(formatEur(0)).toBe('0,00 €');
  });

  it('groups every three digits for large values (millions)', () => {
    expect(formatEur(1000000)).toBe('1.000.000,00 €');
  });

  it('renders negative reversal amounts with a leading minus and grouping', () => {
    expect(formatEur(-1234.5)).toBe('-1.234,50 €');
  });

  it('always keeps exactly two fractional digits (rounds like toFixed)', () => {
    expect(formatEur(2.005)).toBe('2,00 €');
    expect(formatEur(1234)).toBe('1.234,00 €');
  });
});
