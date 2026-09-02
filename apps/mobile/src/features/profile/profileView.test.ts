import { describe, expect, it } from 'vitest';
import { buildProfileKpis, buildTerritoryRows } from './profileView';
import type { ContractStat } from './db/profileRepo';
import type { Appointment } from '../termine/db/appointmentsRepo';
import type { HouseRow } from '../map/db/housesRepo';
import type { AssignableTerritoryRow } from '../map/db/territoriesRepo';

const REP = 'rep-1';
const NOW = new Date(2026, 6, 28, 12, 0).getTime(); // 2026-07 local
const iso = (y: number, mo: number, d: number): string => new Date(y, mo - 1, d, 12, 0).toISOString();

const contract = (over: Partial<ContractStat>): ContractStat => ({
  signedAtIso: iso(2026, 7, 10),
  doorPriceEur: 40,
  isTest: false,
  ...over,
});
const house = (over: Partial<HouseRow>): HouseRow => ({
  id: 'h', team_id: 't', territory_id: null, lat: 0, lon: 0, status: 'new',
  follow_up_at: null, note: null, address: null, parent_house_id: null, unit_label: null,
  unit_count: null, created_by: REP, created_at: iso(2026, 7, 1), ...over,
});
const appt = (over: Partial<Appointment>): Appointment => ({
  id: 'a', houseId: null, scheduledAtIso: iso(2026, 7, 28), address: null,
  floorLabel: null, note: null, kind: 'follow_up', customerAge: null,
  createdAtIso: iso(2026, 7, 1), ...over,
});

describe('buildProfileKpis', () => {
  it('counts this-month non-tester deals and sums recurring volume', () => {
    const stats = [
      contract({ signedAtIso: iso(2026, 7, 5), doorPriceEur: 36.5 }),
      contract({ signedAtIso: iso(2026, 7, 20), doorPriceEur: 42 }),
      contract({ signedAtIso: iso(2026, 6, 20), doorPriceEur: 99 }), // last month -> excluded
      contract({ signedAtIso: iso(2026, 7, 21), doorPriceEur: 500, isTest: true }), // tester -> excluded
    ];
    const kpis = buildProfileKpis(stats, [], [], REP, NOW);
    expect(kpis.dealsThisMonth).toBe(2);
    expect(kpis.monthlyVolumeEur).toBeCloseTo(78.5);
  });

  it('counts doors worked (own houses) and follow-ups total/today', () => {
    const houses = [house({ id: 'h1', created_by: REP }), house({ id: 'h2', created_by: 'other' })];
    const appts = [
      appt({ id: 'a1', scheduledAtIso: iso(2026, 7, 28) }), // today
      appt({ id: 'a2', scheduledAtIso: iso(2026, 7, 30) }),
    ];
    const kpis = buildProfileKpis([], appts, houses, REP, NOW);
    expect(kpis.doorsWorked).toBe(1);
    expect(kpis.followupsTotal).toBe(2);
    expect(kpis.followupsToday).toBe(1);
  });

  it('returns zeroed KPIs for empty inputs', () => {
    const kpis = buildProfileKpis([], [], [], REP, NOW);
    expect(kpis).toMatchObject({ dealsThisMonth: 0, monthlyVolumeEur: 0, doorsWorked: 0, followupsTotal: 0, followupsToday: 0 });
  });
});

describe('buildTerritoryRows', () => {
  const territories: AssignableTerritoryRow[] = [
    { id: 'terr-b', team_id: 't', name: 'Nord-Ost', locked_by: null, boundary: null },
    { id: 'terr-a', team_id: 't', name: 'Nord', locked_by: REP, boundary: null },
  ];

  it('marks the own-locked territory active and sorts it first, with household counts', () => {
    const houses = [
      house({ id: 'h1', territory_id: 'terr-a', status: 'new' }),
      house({ id: 'h2', territory_id: 'terr-a', status: 'success' }),
      house({ id: 'h3', territory_id: 'terr-b', status: 'new' }),
    ];
    const rows = buildTerritoryRows(territories, houses, REP);
    expect(rows[0]).toMatchObject({ id: 'terr-a', isActive: true, householdCount: 2, openCount: 1 });
    expect(rows[1]).toMatchObject({ id: 'terr-b', isActive: false, householdCount: 1, openCount: 1 });
  });

  it('returns an empty list for no territories', () => {
    expect(buildTerritoryRows([], [], REP)).toEqual([]);
  });
});
