import { describe, expect, it } from 'vitest';
import {
  draftToFeatureCollection,
  housesToFeatureCollection,
  territoriesToFeatureCollection,
} from './mapFeatures';
import type { Position } from './polygon';
import type { House, Territory } from './useTerritoryData';

const drawn: Territory = {
  id: 'terr-drawn',
  name: 'Leonberg Stadtmitte',
  teamId: 'team-1',
  lockedBy: null,
  boundary: {
    type: 'Polygon',
    coordinates: [
      [
        [9.0, 48.795],
        [9.023, 48.795],
        [9.023, 48.808],
        [9.0, 48.795],
      ],
    ],
  },
};

const undrawn: Territory = {
  id: 'terr-undrawn',
  name: 'Noch ohne Umriss',
  teamId: 'team-1',
  lockedBy: 'rep-1',
  boundary: null,
};

describe('territoriesToFeatureCollection', () => {
  it('omits a territory with no boundary instead of inventing one', () => {
    const collection = territoriesToFeatureCollection([drawn, undrawn], null);
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]?.properties.territoryId).toBe('terr-drawn');
  });

  it('marks exactly the selected territory, so the highlight paint has something to match', () => {
    expect(territoriesToFeatureCollection([drawn], 'terr-drawn').features[0]?.properties.selected).toBe(true);
    expect(territoriesToFeatureCollection([drawn], 'other').features[0]?.properties.selected).toBe(false);
  });
});

describe('housesToFeatureCollection', () => {
  it('emits [lon, lat] order and carries the raw status for the colour match', () => {
    const house: House = {
      id: 'house-1',
      address: 'Bahnhofstraße 8, 71229 Leonberg',
      status: 'follow_up',
      lat: 48.8005,
      lon: 9.0075,
      territoryId: 'terr-drawn',
    };
    const feature = housesToFeatureCollection([house]).features[0];
    expect(feature?.geometry.coordinates).toEqual([9.0075, 48.8005]);
    expect(feature?.properties.status).toBe('follow_up');
  });
});

describe('draftToFeatureCollection', () => {
  const points: Position[] = [
    [9.0, 48.79],
    [9.01, 48.79],
    [9.01, 48.8],
  ];

  it('shows only vertices before a line is possible', () => {
    const types = draftToFeatureCollection(points.slice(0, 1)).features.map((f) => f.geometry.type);
    expect(types).toEqual(['Point']);
  });

  it('adds the open path from two vertices on', () => {
    const types = draftToFeatureCollection(points.slice(0, 2)).features.map((f) => f.geometry.type);
    expect(types).toEqual(['Point', 'Point', 'LineString']);
  });

  it('adds a provisional closed fill from three vertices on', () => {
    const types = draftToFeatureCollection(points).features.map((f) => f.geometry.type);
    expect(types).toEqual(['Point', 'Point', 'Point', 'LineString', 'Polygon']);
    const polygon = draftToFeatureCollection(points).features.at(-1);
    expect(polygon?.geometry.type === 'Polygon' && polygon.geometry.coordinates[0]).toHaveLength(4);
  });

  it('is empty for an untouched draft', () => {
    expect(draftToFeatureCollection([]).features).toHaveLength(0);
  });
});
