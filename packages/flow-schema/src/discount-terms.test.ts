import { describe, expect, it } from 'vitest';
import { discountTermsSchema } from './discount-terms';

describe('discountTermsSchema', () => {
  it('validates the markdown variant (existing online tariff, comparisonPrice required)', () => {
    const result = discountTermsSchema.safeParse({
      id: 'terms-1',
      type: 'markdown',
      productSlug: 'fiber-basic',
      version: 1,
      doorPrice: 29.99,
      comparisonPrice: 39.99,
      termsText: 'Only at your door: 10 EUR off for 12 months.',
    });
    expect(result.success).toBe(true);
  });

  it('validates the standalone variant (channel-only, comparisonPrice optional)', () => {
    const result = discountTermsSchema.safeParse({
      id: 'terms-2',
      type: 'standalone',
      productSlug: 'fiber-exclusive',
      version: 1,
      doorPrice: 24.99,
      termsText: 'A door-exclusive tariff, not available online.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects the markdown variant without a comparisonPrice', () => {
    const result = discountTermsSchema.safeParse({
      id: 'terms-3',
      type: 'markdown',
      productSlug: 'fiber-basic',
      version: 1,
      doorPrice: 29.99,
      termsText: 'Missing comparison price.',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown type', () => {
    const result = discountTermsSchema.safeParse({
      id: 'terms-4',
      type: 'bogus',
      productSlug: 'fiber-basic',
      version: 1,
      doorPrice: 29.99,
      termsText: 'x',
    });
    expect(result.success).toBe(false);
  });
});

/**
 * H02 (quick-260827-h02) — the one-time / term / disclosure positions.
 *
 * The monthly `doorPrice` / `comparisonPrice` pair structurally cannot carry a
 * one-time setup fee, a minimum term, or a net-price disclosure. These fields
 * were added to the TERMS entity (not the discount block, D-1) precisely so
 * every already-published product keeps pointing at exactly the row it pointed
 * at, and every already-published terms row stays valid.
 */
describe('discountTermsSchema — setup fee / minimum term / price note (H02, D-1)', () => {
  function baseTerms(extra: Record<string, unknown> = {}) {
    return {
      id: 'terms-h02',
      type: 'markdown',
      productSlug: 'smaica-social-media',
      version: 5,
      doorPrice: 99,
      comparisonPrice: 198,
      termsText: 'Paket Basic.',
      ...extra,
    };
  }

  it('still accepts a terms object WITHOUT any of the new fields (every v1..v4 file stays valid)', () => {
    const result = discountTermsSchema.safeParse(baseTerms());
    expect(result.success).toBe(true);
    if (result.success) {
      // Optional, never defaulted to a number — an absent one-time fee is
      // "there is none", not "it is zero".
      expect(result.data.setupFee).toBeUndefined();
      expect(result.data.minimumTermMonths).toBeUndefined();
      expect(result.data.priceNote).toBeUndefined();
    }
  });

  it('accepts the full one-time/term/disclosure set', () => {
    const result = discountTermsSchema.safeParse(
      baseTerms({
        setupFee: 499,
        setupFeeComparison: 999,
        minimumTermMonths: 12,
        priceNote: 'Alle Preise zzgl. USt.',
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.setupFee).toBe(499);
      expect(result.data.setupFeeComparison).toBe(999);
      expect(result.data.minimumTermMonths).toBe(12);
      expect(result.data.priceNote).toBe('Alle Preise zzgl. USt.');
    }
  });

  it('rejects a negative setupFee', () => {
    expect(discountTermsSchema.safeParse(baseTerms({ setupFee: -1 })).success).toBe(false);
  });

  it('rejects a negative setupFeeComparison', () => {
    expect(discountTermsSchema.safeParse(baseTerms({ setupFeeComparison: -0.01 })).success).toBe(false);
  });

  it('rejects a minimumTermMonths that is not a positive integer', () => {
    expect(discountTermsSchema.safeParse(baseTerms({ minimumTermMonths: 0 })).success).toBe(false);
    expect(discountTermsSchema.safeParse(baseTerms({ minimumTermMonths: -12 })).success).toBe(false);
    expect(discountTermsSchema.safeParse(baseTerms({ minimumTermMonths: 12.5 })).success).toBe(false);
  });

  it('carries the new fields on the standalone variant too (they live on the shared base)', () => {
    const result = discountTermsSchema.safeParse({
      id: 'terms-standalone-h02',
      type: 'standalone',
      productSlug: 'fiber-exclusive',
      version: 1,
      doorPrice: 24.99,
      termsText: 'A door-exclusive tariff.',
      setupFee: 0,
      minimumTermMonths: 24,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // 0 is a MEANINGFUL value — "we waive the setup fee" — and must not be
      // rejected by a truthiness check anywhere downstream.
      expect(result.data.setupFee).toBe(0);
    }
  });
});
