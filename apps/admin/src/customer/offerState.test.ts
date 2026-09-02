import { describe, expect, it } from 'vitest';
import {
  deriveState,
  formatEuro,
  INITIAL_STATE,
  isSignatureReachable,
  parsePrice,
  type ViewResponse,
} from './offerState';

/**
 * The rules that make "the link alone shows nothing" true, tested without a DOM.
 */

const okBody: ViewResponse = {
  state: 'ok',
  companyDisplayName: 'Stadtwerke Elbufer GmbH',
  contactName: 'Frau Gueltig',
  offerExpiresAt: '2026-09-10T00:00:00Z',
  snapshot: { doorPrice: 49.9, comparisonPrice: 59.9, discountAmount: 10 },
  productKind: 'flow_form',
  productPinned: true,
  belehrungBlocks: [{ id: 'withdrawal-notice', noticeText: 'Sie haben das Recht ...' }],
};

describe('the locked start state', () => {
  it('is structurally incapable of holding offer data', () => {
    expect(INITIAL_STATE.kind).toBe('locked');
    // Not "offer is empty" — there is no such key on this variant at all.
    expect(Object.keys(INITIAL_STATE)).toEqual(['kind']);
    expect('offer' in INITIAL_STATE).toBe(false);
  });
});

describe('deriveState', () => {
  it('maps state ok onto unlocked with the snapshot the server sent', () => {
    const s = deriveState(200, okBody);
    expect(s.kind).toBe('unlocked');
    if (s.kind !== 'unlocked') throw new Error('unreachable');
    expect(s.offer.snapshot.doorPrice).toBe(49.9);
    expect(s.offer.belehrungBlocks).toEqual([
      { id: 'withdrawal-notice', noticeText: 'Sie haben das Recht ...', label: undefined },
    ]);
    expect(s.confirmedGateIds).toEqual([]);
  });

  it.each(['expired', 'redeemed', 'unavailable'] as const)(
    'maps %s onto its own state with no offer attached',
    (state) => {
      const s = deriveState(200, { ...okBody, state });
      expect(s.kind).toBe(state);
      expect('offer' in s).toBe(false);
    },
  );

  it('maps 429 onto rate_limited whatever the body says', () => {
    expect(deriveState(429, { state: 'ok' }).kind).toBe('rate_limited');
  });

  it('maps an unrecognised verdict onto invalid, never onto something permissive', () => {
    expect(deriveState(200, { state: 'definitely-fine' }).kind).toBe('invalid');
    expect(deriveState(200, {}).kind).toBe('invalid');
  });

  it('maps a 400 onto invalid and a 5xx onto network_error', () => {
    expect(deriveState(400, { error: 'malformed request' } as ViewResponse).kind).toBe('invalid');
    expect(deriveState(500, null).kind).toBe('network_error');
  });

  it('produces one indistinguishable state for an unknown identifier and a wrong code', () => {
    // Both come back from the server as `{ state: 'invalid' }` — the client must
    // not invent a distinction the server refused to make.
    const a = deriveState(200, { state: 'invalid' });
    const b = deriveState(200, { state: 'invalid' });
    expect(a).toEqual(b);
    expect(a.kind).toBe('invalid');
  });

  it('drops malformed belehrung blocks instead of trusting them', () => {
    const s = deriveState(200, {
      ...okBody,
      belehrungBlocks: [{ id: 'no-text' }, 'nonsense', null, { id: 'good', noticeText: 'text' }],
    });
    if (s.kind !== 'unlocked') throw new Error('unreachable');
    expect(s.offer.belehrungBlocks.map((b) => b.id)).toEqual(['good']);
  });
});

describe('isSignatureReachable', () => {
  const blocks = [{ id: 'withdrawal-notice', noticeText: 'x' }];

  it('is false with no notice at all — the mirror of the 0030 trigger refusing the insert', () => {
    expect(isSignatureReachable([], null)).toBe(false);
    expect(isSignatureReachable(['anything'], null)).toBe(false);
    expect(isSignatureReachable(['anything'], [])).toBe(false);
  });

  it('is false until every gate block is confirmed', () => {
    expect(isSignatureReachable([], blocks)).toBe(false);
    expect(isSignatureReachable(['other'], blocks)).toBe(false);
    expect(isSignatureReachable(['withdrawal-notice'], blocks)).toBe(true);
  });

  it('requires ALL blocks when a product carries more than one', () => {
    const two = [...blocks, { id: 'second-notice', noticeText: 'y' }];
    expect(isSignatureReachable(['withdrawal-notice'], two)).toBe(false);
    expect(isSignatureReachable(['withdrawal-notice', 'second-notice'], two)).toBe(true);
  });
});

describe('prices', () => {
  it('parses Postgres numeric strings as well as numbers', () => {
    expect(parsePrice('49.90')).toBe(49.9);
    expect(parsePrice(49.9)).toBe(49.9);
  });

  it('returns null for a missing field so the caller can OMIT the row', () => {
    // The one thing that must never happen is a rendered "0,00 €".
    expect(parsePrice(undefined)).toBeNull();
    expect(parsePrice(null)).toBeNull();
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('not a number')).toBeNull();
    expect(formatEuro(undefined)).toBeNull();
    expect(formatEuro(null)).toBeNull();
  });

  it('formats a real zero as zero — only ABSENT values vanish', () => {
    expect(parsePrice(0)).toBe(0);
    expect(formatEuro(0)).not.toBeNull();
  });
});
