import { describe, expect, it } from 'vitest';
import {
  deriveHouseListRows,
  formatDistanceLabel,
  haversineMeters,
  type HouseListRow,
} from './houseList';
import type { HouseRow } from './db/housesRepo';
import type { HouseStatus } from '../../design/tokens';

/**
 * Pure-module test: imports only `houseList.ts` plus the `HouseRow` type, so
 * it needs no `vi.mock` at all (nothing native is reachable from here).
 */

function building(
  id: string,
  overrides: Partial<HouseRow> = {},
): HouseRow {
  return {
    id,
    team_id: 't1',
    territory_id: null,
    lat: 52.5,
    lon: 13.4,
    status: 'new' as HouseStatus,
    follow_up_at: null,
    note: null,
    address: null,
    parent_house_id: null,
    unit_label: null,
    unit_count: null,
    created_by: 'u1',
    created_at: '2026-07-20T00:00:00Z',
    ...overrides,
  };
}

function party(id: string, parentId: string, status: HouseStatus): HouseRow {
  return building(id, { status, parent_house_id: parentId });
}

const ORIGIN = { lat: 52.5, lon: 13.4 };

/** The single row a one-house fixture must produce — throws rather than
 * letting `rows[0]` be `undefined` and the assertion silently vacuous. */
function onlyRow(rows: HouseListRow[]): HouseListRow {
  const [row] = rows;
  if (!row) throw new Error(`expected exactly one row, got ${rows.length}`);
  return row;
}

describe('haversineMeters', () => {
  it('is ~0 for two identical points', () => {
    expect(haversineMeters(ORIGIN, { lat: 52.5, lon: 13.4 })).toBeLessThan(0.001);
  });

  it('matches the ~111 m per 0.001 degree of latitude baseline within a few metres', () => {
    const meters = haversineMeters({ lat: 52.5, lon: 13.4 }, { lat: 52.501, lon: 13.4 });
    expect(meters).toBeGreaterThan(108);
    expect(meters).toBeLessThan(114);
  });

  it('is symmetric', () => {
    const a = { lat: 52.5, lon: 13.4 };
    const b = { lat: 52.52, lon: 13.45 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });
});

describe('deriveHouseListRows — ordering', () => {
  it('orders strictly nearest-first when an origin is supplied', () => {
    const rows = deriveHouseListRows({
      houses: [
        building('far', { lat: 52.53, lon: 13.4, created_at: '2026-07-01T00:00:00Z' }),
        building('near', { lat: 52.501, lon: 13.4, created_at: '2026-07-02T00:00:00Z' }),
        building('mid', { lat: 52.51, lon: 13.4, created_at: '2026-07-03T00:00:00Z' }),
      ],
      unitsByParent: new Map(),
      origin: ORIGIN,
    });

    expect(rows.map((r) => r.houseId)).toEqual(['near', 'mid', 'far']);
    const distances = rows.map((r) => r.distanceMeters ?? Number.NaN);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    expect(new Set(distances).size).toBe(distances.length);
  });

  it('breaks ties on equal distance by created_at ascending (stable ordering)', () => {
    const rows = deriveHouseListRows({
      houses: [
        building('later', { lat: 52.51, lon: 13.4, created_at: '2026-07-09T00:00:00Z' }),
        building('earlier', { lat: 52.51, lon: 13.4, created_at: '2026-07-01T00:00:00Z' }),
      ],
      unitsByParent: new Map(),
      origin: ORIGIN,
    });

    expect(rows.map((r) => r.houseId)).toEqual(['earlier', 'later']);
  });

  it('without an origin every distance is null and rows come back in created_at order, not input order (D-3)', () => {
    const rows = deriveHouseListRows({
      houses: [
        building('c', { created_at: '2026-07-03T00:00:00Z' }),
        building('a', { created_at: '2026-07-01T00:00:00Z' }),
        building('b', { created_at: '2026-07-02T00:00:00Z' }),
      ],
      unitsByParent: new Map(),
      origin: null,
    });

    expect(rows.map((r) => r.houseId)).toEqual(['a', 'b', 'c']);
    expect(rows.every((r) => r.distanceMeters === null)).toBe(true);
  });

  it('never mutates the caller\'s array (it is React state in MapScreen)', () => {
    const houses = [
      building('c', { created_at: '2026-07-03T00:00:00Z' }),
      building('a', { created_at: '2026-07-01T00:00:00Z' }),
    ];
    const inputOrder = houses.map((h) => h.id);

    deriveHouseListRows({ houses, unitsByParent: new Map(), origin: null });

    expect(houses.map((h) => h.id)).toEqual(inputOrder);
  });
});

describe('deriveHouseListRows — status rollup reuse (never re-derived here)', () => {
  it('a building WITHOUT parties passes its own houses.status through with openUnits null', () => {
    const statuses: HouseStatus[] = ['new', 'follow_up', 'success'];
    for (const status of statuses) {
      const row = onlyRow(
        deriveHouseListRows({
          houses: [building('h1', { status })],
          unitsByParent: new Map(),
          origin: null,
        }),
      );
      expect(row.status).toBe(status);
      expect(row.openUnits).toBeNull();
      expect(row.hasUnits).toBe(false);
    }
  });

  it('a building WITH parties reports the DERIVED status and the count of open (new) parties', () => {
    const row = onlyRow(deriveHouseListRows({
      houses: [building('h1', { status: 'success' })],
      unitsByParent: new Map([
        ['h1', [party('u1', 'h1', 'new'), party('u2', 'h1', 'new'), party('u3', 'h1', 'success')]],
      ]),
      origin: null,
    }));

    expect(row.status).toBe('new');
    expect(row.openUnits).toBe(2);
    expect(row.hasUnits).toBe(true);
  });

  it('a building whose own status is blacklist reports blacklist with openUnits 0', () => {
    const row = onlyRow(deriveHouseListRows({
      houses: [building('h1', { status: 'blacklist' })],
      unitsByParent: new Map([['h1', [party('u1', 'h1', 'new')]]]),
      origin: null,
    }));

    expect(row.status).toBe('blacklist');
    expect(row.openUnits).toBe(0);
  });
});

describe('deriveHouseListRows — address honesty (D-2, zero geocoding)', () => {
  it('passes a stored address through verbatim', () => {
    const row = onlyRow(deriveHouseListRows({
      houses: [building('h1', { address: 'Musterstraße 1, 10115 Berlin' })],
      unitsByParent: new Map(),
      origin: null,
    }));
    expect(row.address).toBe('Musterstraße 1, 10115 Berlin');
  });

  it('leaves address null when nothing is stored — never substituted, never derived from coordinates', () => {
    const row = onlyRow(deriveHouseListRows({
      houses: [building('h1', { address: null, lat: 52.5, lon: 13.4 })],
      unitsByParent: new Map(),
      origin: null,
    }));
    expect(row.address).toBeNull();
  });

  it('carries the coordinates and created_at through untouched', () => {
    const row = onlyRow(deriveHouseListRows({
      houses: [building('h1', { lat: 48.1, lon: 11.6, created_at: '2026-06-01T10:00:00Z' })],
      unitsByParent: new Map(),
      origin: null,
    }));
    expect(row.lat).toBe(48.1);
    expect(row.lon).toBe(11.6);
    expect(row.createdAt).toBe('2026-06-01T10:00:00Z');
  });
});

describe('formatDistanceLabel', () => {
  it('renders whole metres below 1000 m', () => {
    expect(formatDistanceLabel(120)).toBe('120 m');
    expect(formatDistanceLabel(120.6)).toBe('121 m');
    expect(formatDistanceLabel(0)).toBe('0 m');
    expect(formatDistanceLabel(999)).toBe('999 m');
  });

  it('renders one decimal with a German decimal comma from 1000 m up', () => {
    expect(formatDistanceLabel(1400)).toBe('1,4 km');
    expect(formatDistanceLabel(1000)).toBe('1,0 km');
    expect(formatDistanceLabel(12345)).toBe('12,3 km');
  });

  it('returns null for a null input (no fake "0 m", D-3)', () => {
    expect(formatDistanceLabel(null)).toBeNull();
  });
});
