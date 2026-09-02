import { describe, expect, it } from 'vitest';
import { buildSearchResults, type SearchSources } from './searchView';
import type { Appointment } from '../termine/db/appointmentsRepo';
import type { ContractListRow } from '../flow-runner/db/contractsRepo';

const appt = (over: Partial<Appointment>): Appointment => ({
  id: 'a', houseId: null, scheduledAtIso: '2026-07-28T18:00:00.000Z', address: 'Musterstraße 10',
  floorLabel: 'EG rechts', note: null, kind: 'follow_up', customerAge: null,
  createdAtIso: '2026-07-28T07:00:00.000Z', ...over,
});
const contract = (over: Partial<ContractListRow>): ContractListRow => ({
  id: 'c', dealReference: 'FDS-2026-0714', customerName: 'Sabine Krüger', productName: null,
  signedAtIso: '2026-07-23T09:00:00.000Z', doorPriceEur: null, cancelledAtIso: null, ...over,
});

const sources: SearchSources = {
  appointments: [appt({ id: 'a1', address: 'Musterstraße 10' }), appt({ id: 'a2', address: 'Ulmenstraße 41' })],
  contracts: [contract({ id: 'c1', customerName: 'Sabine Krüger', dealReference: 'FDS-2026-0714' })],
};

describe('buildSearchResults', () => {
  it('returns empty groups for a blank query', () => {
    expect(buildSearchResults('   ', sources)).toEqual({ haeuser: [], abschluesse: [], total: 0 });
  });

  it('matches house addresses case-insensitively (Häuser group)', () => {
    const r = buildSearchResults('musterstr', sources);
    expect(r.haeuser.map((h) => h.id)).toEqual(['a1']);
    expect(r.abschluesse).toHaveLength(0);
    expect(r.total).toBe(1);
  });

  it('matches contracts by customer name and by deal reference (Abschlüsse group)', () => {
    expect(buildSearchResults('krüger', sources).abschluesse.map((c) => c.id)).toEqual(['c1']);
    expect(buildSearchResults('FDS-2026-0714', sources).abschluesse.map((c) => c.id)).toEqual(['c1']);
  });

  it('returns nothing for a query that matches neither group', () => {
    expect(buildSearchResults('zzz', sources).total).toBe(0);
  });
});
