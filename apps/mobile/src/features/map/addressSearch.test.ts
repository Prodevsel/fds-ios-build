import { describe, expect, it, vi } from 'vitest';
import { forwardGeocode, isInsideTerritory, matchLocalRows } from './addressSearch';

const rows = [
  { address: 'Poststraße 12, 71229 Leonberg' },
  { address: 'Hauptstraße 3, 71229 Leonberg' },
  { address: null },
];

describe('matchLocalRows', () => {
  it('matches the abbreviation a rep actually types', () => {
    expect(matchLocalRows(rows, 'poststr 12')).toEqual([rows[0]]);
  });

  it('ignores token order and umlaut spelling', () => {
    expect(matchLocalRows(rows, '3 hauptstrasse')).toEqual([rows[1]]);
  });

  it('never matches a row without a stored address', () => {
    expect(matchLocalRows(rows, 'leonberg')).toEqual([rows[0], rows[1]]);
    expect(matchLocalRows(rows, '')).toEqual([]);
  });
});

describe('forwardGeocode', () => {
  it('returns [] rather than throwing when the network fails', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(forwardGeocode('Poststraße 12', { fetchFn, now: () => 1e12 })).resolves.toEqual([]);
  });

  it('maps hits and drops entries without usable coordinates', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => [
        { lat: '48.8', lon: '9.01', address: { road: 'Poststraße', house_number: '12', postcode: '71229', town: 'Leonberg' } },
        { lat: 'nope', lon: '9.01', display_name: 'broken' },
      ],
    })) as unknown as typeof fetch;
    await expect(forwardGeocode('Poststraße 12', { fetchFn, now: () => 1e12 })).resolves.toEqual([
      { label: 'Poststraße 12, 71229 Leonberg', lat: 48.8, lon: 9.01 },
    ]);
  });
});

describe('isInsideTerritory', () => {
  const boundary: GeoJSON.Polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [9, 48],
        [10, 48],
        [10, 49],
        [9, 49],
        [9, 48],
      ],
    ],
  };

  it('separates inside from outside, and treats no boundary as outside', () => {
    expect(isInsideTerritory({ lat: 48.5, lon: 9.5 }, boundary)).toBe(true);
    expect(isInsideTerritory({ lat: 51, lon: 9.5 }, boundary)).toBe(false);
    expect(isInsideTerritory({ lat: 48.5, lon: 9.5 }, null)).toBe(false);
  });
});
