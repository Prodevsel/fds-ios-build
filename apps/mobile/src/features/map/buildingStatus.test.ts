import { describe, expect, it } from 'vitest';

import type { HouseRow } from './db/housesRepo';
import {
  deriveBuildingStatus,
  groupUnitsByParent,
  hasNoSolicitationLock,
  planUnitSync,
} from './buildingStatus';

function unit(overrides: Partial<HouseRow> & { id: string }): HouseRow {
  return {
    team_id: 'team-1',
    territory_id: null,
    lat: 52.5,
    lon: 13.4,
    status: 'new',
    follow_up_at: null,
    note: null,
    address: null,
    parent_house_id: 'building-1',
    unit_label: null,
    unit_count: null,
    created_by: 'user-1',
    created_at: '2026-08-26T10:00:00.000Z',
    ...overrides,
  };
}

describe('deriveBuildingStatus — a party-less house is exactly what it is today', () => {
  // THE backward-compatibility guarantee. Every house in the running demo is
  // party-less: same status, no badge, nothing derived.
  it.each(['new', 'follow_up', 'blacklist', 'success'] as const)(
    'passes a party-less building through untouched for status %s',
    (status) => {
      expect(
        deriveBuildingStatus({
          building: { id: 'building-1', status },
          units: [],
          noSolicitation: false,
        }),
      ).toEqual({ status, openUnits: null, hasUnits: false });
    },
  );

  it('never invents open doors from a unit_count with no party rows yet', () => {
    // unit_count lives on the building row; it is NOT a source of open doors.
    expect(
      deriveBuildingStatus({
        building: { id: 'building-1', status: 'new' },
        units: [],
        noSolicitation: false,
      }),
    ).toEqual({ status: 'new', openUnits: null, hasUnits: false });
  });

  it('leaves a party-less house alone even when it carries a no-solicitation lock', () => {
    // Today such a house renders its own status; deriving anything else here
    // would be a behaviour change for the demo stock.
    expect(
      deriveBuildingStatus({
        building: { id: 'building-1', status: 'blacklist' },
        units: [],
        noSolicitation: true,
      }),
    ).toEqual({ status: 'blacklist', openUnits: null, hasUnits: false });
  });
});

describe('deriveBuildingStatus — the rank order: locked > appointment > open > done', () => {
  it('rank 1: a no-solicitation lock on the building beats every open door', () => {
    expect(
      deriveBuildingStatus({
        building: { id: 'building-1', status: 'new' },
        units: [unit({ id: 'u1', status: 'new' }), unit({ id: 'u2', status: 'follow_up' })],
        noSolicitation: true,
      }),
    ).toEqual({ status: 'blacklist', openUnits: 0, hasUnits: true });
  });

  it('rank 2: one appointment beats a colour — a date outranks an open door', () => {
    expect(
      deriveBuildingStatus({
        building: { id: 'building-1', status: 'success' },
        units: [unit({ id: 'u1', status: 'follow_up' }), unit({ id: 'u2', status: 'new' })],
        noSolicitation: false,
      }),
    ).toEqual({ status: 'follow_up', openUnits: 1, hasUnits: true });
  });

  it('rank 3: a signed deal does not close the building — three doors stay open', () => {
    expect(
      deriveBuildingStatus({
        building: { id: 'building-1', status: 'success' },
        units: [
          unit({ id: 'u1', status: 'success' }),
          unit({ id: 'u2', status: 'new' }),
          unit({ id: 'u3', status: 'new' }),
          unit({ id: 'u4', status: 'new' }),
        ],
        noSolicitation: false,
      }),
    ).toEqual({ status: 'new', openUnits: 3, hasUnits: true });
  });

  it('rank 4: every party terminal (success and/or blacklist) means done, no number', () => {
    expect(
      deriveBuildingStatus({
        building: { id: 'building-1', status: 'new' },
        units: [
          unit({ id: 'u1', status: 'success' }),
          unit({ id: 'u2', status: 'blacklist' }),
          unit({ id: 'u3', status: 'success' }),
        ],
        noSolicitation: false,
      }),
    ).toEqual({ status: 'success', openUnits: 0, hasUnits: true });
  });

  it('rank 4: an unanswered door keeps the building in hand, below untouched doors', () => {
    expect(
      deriveBuildingStatus({
        building: { id: 'building-1', status: 'new' },
        units: [
          unit({ id: 'u1', status: 'not_home' }),
          unit({ id: 'u2', status: 'success' }),
        ],
        noSolicitation: false,
      }),
    ).toEqual({ status: 'not_home', openUnits: 0, hasUnits: true });
  });

  it("rank 4: 'not_home' is work in hand but NOT an open door in the denominator", () => {
    expect(
      deriveBuildingStatus({
        building: { id: 'building-1', status: 'new' },
        units: [unit({ id: 'u1', status: 'not_home' }), unit({ id: 'u2', status: 'new' })],
        noSolicitation: false,
      }),
      // rank 3 wins (an untouched door outranks a revisit), and the count is 1,
      // not 2 — the rep already stood at u1.
    ).toEqual({ status: 'new', openUnits: 1, hasUnits: true });
  });

  it('rank 6: all terminal but NOBODY signed is not a deal — no green pin', () => {
    expect(
      deriveBuildingStatus({
        building: { id: 'building-1', status: 'new' },
        units: [
          unit({ id: 'u1', status: 'no_interest' }),
          unit({ id: 'u2', status: 'no_interest' }),
        ],
        noSolicitation: false,
      }),
    ).toEqual({ status: 'no_interest', openUnits: 0, hasUnits: true });
  });

  it('rank 6: a polite no is NOT the legal lock — a building of refusals never renders as blacklist', () => {
    expect(
      deriveBuildingStatus({
        building: { id: 'building-1', status: 'new' },
        units: [unit({ id: 'u1', status: 'no_interest' })],
        noSolicitation: false,
      }).status,
    ).not.toBe('blacklist');
  });

  it('ignores the building row status entirely once parties exist', () => {
    // houses.status on a building WITH parties is meaningless from here on.
    expect(
      deriveBuildingStatus({
        building: { id: 'building-1', status: 'blacklist' },
        units: [unit({ id: 'u1', status: 'new' })],
        noSolicitation: false,
      }).status,
    ).toBe('new');
  });
});

describe('hasNoSolicitationLock', () => {
  it('is true for a no_solicitation blacklist entry on this building', () => {
    expect(
      hasNoSolicitationLock(
        [{ house_id: 'building-1', reason: 'no_solicitation' }],
        'building-1',
        'new',
      ),
    ).toBe(true);
  });

  it('is false for a no_solicitation entry belonging to a different building', () => {
    expect(
      hasNoSolicitationLock(
        [{ house_id: 'building-2', reason: 'no_solicitation' }],
        'building-1',
        'new',
      ),
    ).toBe(false);
  });

  it('is false for a not_interested entry alone', () => {
    expect(
      hasNoSolicitationLock(
        [{ house_id: 'building-1', reason: 'not_interested' }],
        'building-1',
        'new',
      ),
    ).toBe(false);
  });

  it("is true when the building's own status is already 'blacklist'", () => {
    // The existing UI writes a lock as status='blacklist' PLUS an entry whose
    // reason defaults to 'not_interested'. Listening only to the reason would
    // drop an existing lock the moment the rep adds the first party.
    expect(
      hasNoSolicitationLock(
        [{ house_id: 'building-1', reason: 'not_interested' }],
        'building-1',
        'blacklist',
      ),
    ).toBe(true);
  });

  it('is false with no entries and an unblocked building', () => {
    expect(hasNoSolicitationLock([], 'building-1', 'new')).toBe(false);
  });
});

describe('groupUnitsByParent', () => {
  it('groups by parent and sorts each group by created_at ascending', () => {
    const grouped = groupUnitsByParent([
      unit({ id: 'b', created_at: '2026-08-26T10:00:02.000Z' }),
      unit({ id: 'a', created_at: '2026-08-26T10:00:01.000Z' }),
      unit({ id: 'c', parent_house_id: 'building-2', created_at: '2026-08-26T10:00:00.000Z' }),
    ]);

    expect([...grouped.keys()].sort()).toEqual(['building-1', 'building-2']);
    expect(grouped.get('building-1')?.map((u) => u.id)).toEqual(['a', 'b']);
    expect(grouped.get('building-2')?.map((u) => u.id)).toEqual(['c']);
  });

  it('is stable for equal created_at values (insertion order preserved)', () => {
    const grouped = groupUnitsByParent([
      unit({ id: 'first', created_at: '2026-08-26T10:00:00.000Z' }),
      unit({ id: 'second', created_at: '2026-08-26T10:00:00.000Z' }),
      unit({ id: 'third', created_at: '2026-08-26T10:00:00.000Z' }),
    ]);

    expect(grouped.get('building-1')?.map((u) => u.id)).toEqual(['first', 'second', 'third']);
  });

  it('skips rows without a parent (buildings never group themselves)', () => {
    const grouped = groupUnitsByParent([unit({ id: 'x', parent_house_id: null })]);
    expect(grouped.size).toBe(0);
  });
});

describe('planUnitSync', () => {
  it('fills up when fewer parties exist than the doorbell panel says', () => {
    expect(planUnitSync([unit({ id: 'u1' })], 4)).toEqual({ createCount: 3, deleteIds: [] });
  });

  it('creates nothing when the count already matches', () => {
    expect(planUnitSync([unit({ id: 'u1' }), unit({ id: 'u2' })], 2)).toEqual({
      createCount: 0,
      deleteIds: [],
    });
  });

  it('creates the full set from nothing', () => {
    expect(planUnitSync([], 12)).toEqual({ createCount: 12, deleteIds: [] });
  });

  it('never removes a party when the number shrinks — there is no upload path for a delete', () => {
    // connector.ts applyHousesOperation has PATCH and PUT arms only, and 0016
    // grants no DELETE on houses. A local delete could not travel; worse, a
    // DELETE op would fall into the PUT arm and re-INSERT the row. So
    // deleteIds is ALWAYS empty — lowering the number lowers the number.
    expect(
      planUnitSync([unit({ id: 'u1' }), unit({ id: 'u2' }), unit({ id: 'u3' })], 1),
    ).toEqual({ createCount: 0, deleteIds: [] });
  });

  it('never removes a party that already carries a result', () => {
    expect(
      planUnitSync(
        [unit({ id: 'u1', status: 'success' }), unit({ id: 'u2', note: 'abends nochmal' })],
        0,
      ),
    ).toEqual({ createCount: 0, deleteIds: [] });
  });

  it('treats a negative or non-finite desired count as zero, never as a create storm', () => {
    expect(planUnitSync([], -3)).toEqual({ createCount: 0, deleteIds: [] });
    expect(planUnitSync([], Number.NaN)).toEqual({ createCount: 0, deleteIds: [] });
  });

  it('caps the create count at the schema ceiling of 200 parties', () => {
    expect(planUnitSync([], 5000)).toEqual({ createCount: 200, deleteIds: [] });
  });
});
