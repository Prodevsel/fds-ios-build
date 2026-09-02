import { describe, expect, it } from 'vitest';
import {
  ALL_STATUSES_VISIBLE,
  deriveDoorProgress,
  deriveTerritoryDoors,
  isFilterActive,
  tapCandidates,
} from './territoryDoors';

/** A 1km-ish box around Leonberg-ish coordinates. */
const boundary: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [9.0, 48.79],
      [9.02, 48.79],
      [9.02, 48.81],
      [9.0, 48.81],
      [9.0, 48.79],
    ],
  ],
};

const building = (housenumber: string | undefined, lon: number, lat: number): GeoJSON.Feature => ({
  type: 'Feature',
  properties: housenumber === undefined ? {} : { addr_housenumber: housenumber },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [lon, lat],
        [lon + 0.0001, lat],
        [lon + 0.0001, lat + 0.0001],
        [lon, lat + 0.0001],
        [lon, lat],
      ],
    ],
  },
});

describe('deriveTerritoryDoors', () => {
  it('keeps only addressed buildings inside the boundary', () => {
    const doors = deriveTerritoryDoors(
      [
        building('12', 9.01, 48.8),
        building(undefined, 9.011, 48.8), // no house number: not a door
        building('99', 9.5, 48.8), // outside the territory
      ],
      boundary,
    );
    expect(doors.map((d) => d.housenumber)).toEqual(['12']);
  });

  it('collapses the same building arriving from two tiles', () => {
    // The seam case: identical geometry returned twice would otherwise double
    // the denominator and leave a worked street reading as half open.
    const twice = [building('12', 9.01, 48.8), building('12', 9.01, 48.8)];
    expect(deriveTerritoryDoors(twice, boundary)).toHaveLength(1);
  });

  it('has no doors without a boundary', () => {
    expect(deriveTerritoryDoors([building('12', 9.01, 48.8)], null)).toEqual([]);
  });
});

describe('deriveDoorProgress', () => {
  const doors = deriveTerritoryDoors(
    [building('12', 9.01, 48.8), building('14', 9.012, 48.8), building('16', 9.014, 48.8)],
    boundary,
  );

  it('counts a door as worked when a pin sits on it', () => {
    const first = doors[0]!;
    const onFirstDoor = { lat: first.lat, lon: first.lon };
    expect(deriveDoorProgress(doors, [onFirstDoor])).toEqual({ total: 3, worked: 1, open: 2 });
  });

  it('does not let one pin claim the neighbours', () => {
    const far = { lat: 48.805, lon: 9.018 };
    expect(deriveDoorProgress(doors, [far])).toEqual({ total: 3, worked: 0, open: 3 });
  });

  it('reports an unknown denominator as unknown, never as zero', () => {
    expect(deriveDoorProgress(null, [])).toEqual({ total: null, worked: 0, open: null });
  });
});

describe('tapCandidates', () => {
  it('drops everything nowhere near the finger', () => {
    const houses = [
      { id: 'near', lat: 48.8, lon: 9.01 },
      { id: 'far', lat: 49.5, lon: 9.01 },
    ];
    expect(tapCandidates(houses, { lat: 48.8, lon: 9.0101 }).map((h) => h.id)).toEqual(['near']);
  });
});

describe('the status filter', () => {
  it('is inactive while everything is visible', () => {
    expect(isFilterActive(ALL_STATUSES_VISIBLE)).toBe(false);
    expect(isFilterActive({ ...ALL_STATUSES_VISIBLE, success: false })).toBe(true);
  });
});
