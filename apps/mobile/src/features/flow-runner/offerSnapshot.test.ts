import { describe, expect, it } from 'vitest';

import { buildFlowOfferSnapshot } from './offerSnapshot';

/**
 * The assertion that matters here is not "the object has five keys" — it is
 * that the offer PINS the product version it was quoted from, so a version
 * published between the door and the customer's browser cannot swap the terms
 * under a signature (see offerSnapshot.ts's header on `offer_portal_view`).
 */
const SNAPSHOT = {
  doorPrice: 34.99,
  comparisonPrice: 49.99,
  discountAmount: 15,
  termsText: '24 Monate Laufzeit',
};

describe('buildFlowOfferSnapshot', () => {
  it('pins productDefinitionId + productVersion so the portal never falls back to slug resolution', () => {
    const result = buildFlowOfferSnapshot({
      snapshot: SNAPSHOT,
      productSlug: 'strom-24',
      productDefinitionId: 'b0000000-0000-4000-8000-0000000000f1',
      productVersion: 3,
    });
    expect(result).toEqual({
      doorPrice: 34.99,
      comparisonPrice: 49.99,
      discountAmount: 15,
      termsText: '24 Monate Laufzeit',
      productSlug: 'strom-24',
      productDefinitionId: 'b0000000-0000-4000-8000-0000000000f1',
      productVersion: 3,
    });
  });

  it('keeps carrying the frozen price/terms the rep actually showed', () => {
    const result = buildFlowOfferSnapshot({
      snapshot: { ...SNAPSHOT, comparisonPrice: null, discountAmount: null },
      productSlug: 'strom-24',
      productDefinitionId: 'b0000000-0000-4000-8000-0000000000f1',
      productVersion: 1,
    });
    expect(result.doorPrice).toBe(34.99);
    expect(result.comparisonPrice).toBeNull();
    expect(result.discountAmount).toBeNull();
    expect(result.termsText).toBe('24 Monate Laufzeit');
  });

  it('OMITS both pin keys when the version has not resolved — a null-valued key passes the view\'s presence guard and then resolves to nothing', () => {
    const result = buildFlowOfferSnapshot({
      snapshot: SNAPSHOT,
      productSlug: 'strom-24',
      productDefinitionId: null,
      productVersion: null,
    });
    expect('productDefinitionId' in result).toBe(false);
    expect('productVersion' in result).toBe(false);
    expect(result.productSlug).toBe('strom-24');
  });

  it('pins all-or-nothing — half a pin is worse than none', () => {
    const half = buildFlowOfferSnapshot({
      snapshot: SNAPSHOT,
      productSlug: 'strom-24',
      productDefinitionId: 'b0000000-0000-4000-8000-0000000000f1',
      productVersion: null,
    });
    expect('productDefinitionId' in half).toBe(false);
    expect('productVersion' in half).toBe(false);
  });
});
