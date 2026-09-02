import { describe, expect, it } from 'vitest';
import { buildCustomers } from './customerSearch';
import { matchesKundenFilter, offerState } from './customerOffers';

/**
 * The offer half of the customer list. The rules live in `customerOffers.ts`,
 * not in the screen: importing the screen would pull in react-native, whose
 * Flow-typed entry point this harness cannot parse — the same reason
 * `customerSearch.ts` is React-free.
 */

/** Index access is checked in this project, so the tests unwrap explicitly
 * rather than sprinkling `!` — a missing element should fail loudly here. */
function one<T>(xs: readonly T[]): T {
  const x = xs[0];
  if (x === undefined) throw new Error('erwartete genau einen Eintrag, bekam keinen');
  return x;
}

const NOW = '2026-09-01T12:00:00.000Z';

const lead = (over: Record<string, unknown> = {}) => ({
  id: 'lead-1',
  contact_name: 'Frau Beispiel',
  contact_email: 'b@example.de',
  offer_code: 'FDS-PRTA-2345',
  offer_expires_at: '2026-09-15T00:00:00.000Z',
  created_at: '2026-09-01T09:00:00.000Z',
  ...over,
});

describe('offerState', () => {
  it('is open while the deadline is in the future', () => {
    const c = one(buildCustomers([], [lead()]));
    expect(offerState(one(c.offers), NOW)).toBe('open');
  });

  it('is expired once the deadline has passed', () => {
    const c = one(buildCustomers([], [lead({ offer_expires_at: '2026-08-20T00:00:00.000Z' })]));
    expect(offerState(one(c.offers), NOW)).toBe('expired');
  });

  it('an offer with no deadline never expires — it does not invent one', () => {
    const c = one(buildCustomers([], [lead({ offer_expires_at: null })]));
    expect(offerState(one(c.offers), NOW)).toBe('open');
  });

  it('accepted beats expired: signing on the last day is an acceptance', () => {
    const contracts = [{ id: 'k1', redeemed_lead_id: 'lead-1', customer_name: 'Frau Beispiel', signed_at: NOW }];
    const c = one(buildCustomers(contracts, [lead({ offer_expires_at: '2026-08-20T00:00:00.000Z' })]));
    expect(offerState(one(c.offers), NOW)).toBe('redeemed');
  });
});

describe('buildCustomers carries the offer', () => {
  it('reads the code and the deadline off the lead', () => {
    const c = one(buildCustomers([], [lead()]));
    expect(c.offers).toHaveLength(1);
    expect(one(c.offers).code).toBe('FDS-PRTA-2345');
    expect(one(c.offers).expiresAtIso).toBe('2026-09-15T00:00:00.000Z');
  });

  it('a lead WITHOUT a code produces no offer — nothing was left with the customer', () => {
    const c = one(buildCustomers([], [lead({ offer_code: null })]));
    expect(c.offers).toHaveLength(0);
  });

  it('redeemed is derived from the local contracts, never from the lead row', () => {
    // `leads.converted_contract_id` is not in the device schema, so a lead
    // claiming conversion must not be believed; the contract is the evidence.
    const claiming = lead({ converted_contract_id: 'k1' });
    const without = one(buildCustomers([], [claiming]));
    expect(one(without.offers).redeemed).toBe(false);

    const contracts = [{ id: 'k1', redeemed_lead_id: 'lead-1', customer_name: 'Frau Beispiel', signed_at: NOW }];
    const wit = one(buildCustomers(contracts, [claiming]));
    expect(one(wit.offers).redeemed).toBe(true);
  });
});

describe('matchesKundenFilter', () => {
  const openOffer = one(buildCustomers([], [lead()]));
  const expiredOffer = one(buildCustomers([], [lead({ offer_expires_at: '2026-08-01T00:00:00.000Z' })]));
  const buyer = one(buildCustomers(
    [{ id: 'k9', customer_name: 'Herr Kunde', signed_at: NOW, deal_reference: 'FDS-1' }],
    [],
  ));

  it('"Alle" hides nobody', () => {
    for (const c of [openOffer, expiredOffer, buyer]) {
      expect(matchesKundenFilter(c, 'all', NOW)).toBe(true);
    }
  });

  it('"Angebote offen" is only who is still deciding', () => {
    expect(matchesKundenFilter(openOffer, 'offers', NOW)).toBe(true);
    // History, not a to-do: an expired offer is not something to chase.
    expect(matchesKundenFilter(expiredOffer, 'offers', NOW)).toBe(false);
    expect(matchesKundenFilter(buyer, 'offers', NOW)).toBe(false);
  });

  it('"Mit Abschluss" is only who actually signed', () => {
    expect(matchesKundenFilter(buyer, 'customers', NOW)).toBe(true);
    expect(matchesKundenFilter(openOffer, 'customers', NOW)).toBe(false);
  });
});
