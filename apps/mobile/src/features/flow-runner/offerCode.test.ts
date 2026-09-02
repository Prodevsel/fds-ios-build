import { describe, expect, it } from 'vitest';
import {
  type OfferLookupDb,
  formatOfferCode,
  generateOfferCode,
  lookupOffer,
  normalizeOfferCode,
  offerExpiryIso,
} from './offerCode';

const ROW = {
  id: 'lead-1',
  product_interest: 'smaica-social-media',
  contact_name: 'Frau Sommer',
  contact_phone: null,
  contact_email: 'kundin@example.de',
  offer_expires_at: '2026-09-09T10:00:00.000Z',
  offer_snapshot: '{"doorPrice":249}',
  redeemed_by: null as string | null,
};

function dbReturning(rows: unknown[]): OfferLookupDb {
  return { getAll: <T>() => Promise.resolve(rows as T[]) };
}

describe('offer code format', () => {
  it('renders 40 bits as FDS-XXXX-XXXX from the unambiguous alphabet', () => {
    expect(formatOfferCode(0n)).toBe('FDS-2222-2222');
    expect(generateOfferCode('a1b2c3d4-e5f6-4789-8abc-def012345678')).toMatch(
      /^FDS-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/,
    );
  });

  it('never emits the characters a customer reads back wrongly', () => {
    const codes = Array.from({ length: 64 }, (_, i) =>
      generateOfferCode(`${i.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`),
    );
    expect(codes.join('').replace('FDS', '')).not.toMatch(/[01OI]/);
  });

  it('accepts what a rep actually types back', () => {
    expect(normalizeOfferCode('fds-abcd-2345')).toBe('FDS-ABCD-2345');
    expect(normalizeOfferCode(' ABCD2345 ')).toBe('FDS-ABCD-2345');
    expect(normalizeOfferCode('ABCD-234')).toBeNull();
    // 0/1 are not in the alphabet — a typo, not a code.
    expect(normalizeOfferCode('FDS-ABCD-2340')).toBeNull();
  });

  it('dates the deadline the configured number of days out', () => {
    expect(offerExpiryIso(new Date('2026-08-26T10:00:00.000Z'), 14)).toBe(
      '2026-09-09T10:00:00.000Z',
    );
  });
});

describe('offer lookup', () => {
  const now = new Date('2026-08-26T10:00:00.000Z');

  it('resolves a live offer', async () => {
    const result = await lookupOffer(dbReturning([ROW]), 'fds-abcd-2345', now);
    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.offer.contactEmail).toBe('kundin@example.de');
    expect(result.status === 'ok' && result.offer.snapshot).toEqual({ doorPrice: 249 });
  });

  it('reports an unknown code without pretending it expired', async () => {
    expect((await lookupOffer(dbReturning([]), 'FDS-ABCD-2345', now)).status).toBe('unknown');
    // Malformed input short-circuits before the query.
    expect((await lookupOffer(dbReturning([ROW]), 'nope', now)).status).toBe('unknown');
  });

  it('reports an expired offer, and still returns it so the rep can explain', async () => {
    const result = await lookupOffer(
      dbReturning([ROW]),
      'FDS-ABCD-2345',
      new Date('2026-09-10T10:00:00.000Z'),
    );
    expect(result.status).toBe('expired');
    expect(result.status === 'expired' && result.offer.contactName).toBe('Frau Sommer');
  });

  it('reports an offer a contract already redeemed', async () => {
    const result = await lookupOffer(
      dbReturning([{ ...ROW, redeemed_by: 'contract-9' }]),
      'FDS-ABCD-2345',
      now,
    );
    expect(result.status).toBe('already_redeemed');
  });

  it('survives a malformed snapshot rather than blocking the redemption', async () => {
    const result = await lookupOffer(
      dbReturning([{ ...ROW, offer_snapshot: '{oops' }]),
      'FDS-ABCD-2345',
      now,
    );
    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.offer.snapshot).toBeNull();
  });
});
