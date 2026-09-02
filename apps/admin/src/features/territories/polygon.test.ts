import { describe, expect, it } from 'vitest';
import {
  asGeoJsonPolygon,
  boundsOf,
  closeRing,
  draftToPolygon,
  draftVerdict,
  hasSelfIntersection,
  type Position,
} from './polygon';

/** The seeded "Leonberg Stadtmitte" boundary, as PostgREST returns it. */
const LEONBERG = {
  type: 'Polygon',
  coordinates: [
    [
      [9.0, 48.795],
      [9.023, 48.795],
      [9.023, 48.808],
      [9.0, 48.808],
      [9.0, 48.795],
    ],
  ],
};

describe('asGeoJsonPolygon', () => {
  it('accepts the shape the live territories.boundary JSONB column holds', () => {
    expect(asGeoJsonPolygon(LEONBERG)?.coordinates[0]?.length).toBe(5);
  });

  it('returns null for an undrawn territory rather than inventing a shape', () => {
    expect(asGeoJsonPolygon(null)).toBeNull();
    expect(asGeoJsonPolygon(undefined)).toBeNull();
  });

  it('rejects non-Polygon geometry and malformed rings', () => {
    expect(asGeoJsonPolygon({ type: 'Point', coordinates: [9, 48] })).toBeNull();
    // A ring needs at least 4 positions (3 corners + the closing repeat).
    expect(
      asGeoJsonPolygon({ type: 'Polygon', coordinates: [[[9, 48], [9.1, 48], [9, 48]]] }),
    ).toBeNull();
    expect(
      asGeoJsonPolygon({ type: 'Polygon', coordinates: [[[9, 48], ['x', 48], [9.1, 48.1], [9, 48]]] }),
    ).toBeNull();
  });
});

describe('closeRing', () => {
  it('appends the first vertex when the draft is open', () => {
    const ring = closeRing([
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
    expect(ring).toHaveLength(4);
    expect(ring[3]).toEqual([0, 0]);
  });

  it('leaves an already-closed ring untouched', () => {
    const closed: Position[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ];
    expect(closeRing(closed)).toHaveLength(4);
  });
});

describe('hasSelfIntersection', () => {
  it('accepts a simple square', () => {
    expect(
      hasSelfIntersection([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ]),
    ).toBe(false);
  });

  it('catches the bow-tie a mouse-drawn polygon can produce', () => {
    expect(
      hasSelfIntersection([
        [0, 0],
        [1, 1],
        [1, 0],
        [0, 1],
        [0, 0],
      ]),
    ).toBe(true);
  });

  it('does not flag the shared endpoints of adjacent edges', () => {
    expect(
      hasSelfIntersection([
        [0, 0],
        [2, 0],
        [2, 2],
        [1, 1],
        [0, 2],
        [0, 0],
      ]),
    ).toBe(false);
  });
});

describe('draftVerdict / draftToPolygon', () => {
  it('needs at least three corners', () => {
    expect(draftVerdict([[0, 0], [1, 0]])).toBe('too_few_points');
    expect(draftToPolygon([[0, 0], [1, 0]])).toBeNull();
  });

  it('refuses a self-intersecting draft, so it can never reach a write path', () => {
    const bowTie: Position[] = [
      [0, 0],
      [1, 1],
      [1, 0],
      [0, 1],
    ];
    expect(draftVerdict(bowTie)).toBe('self_intersecting');
    expect(draftToPolygon(bowTie)).toBeNull();
  });

  it('emits a closed single-ring Polygon for a valid draft', () => {
    const polygon = draftToPolygon([
      [9.0, 48.795],
      [9.02, 48.795],
      [9.02, 48.805],
    ]);
    expect(polygon?.type).toBe('Polygon');
    expect(polygon?.coordinates).toHaveLength(1);
    expect(polygon?.coordinates[0]).toHaveLength(4);
    expect(polygon?.coordinates[0]?.[3]).toEqual([9.0, 48.795]);
  });
});

describe('boundsOf', () => {
  it('spans every polygon and loose draft point', () => {
    const polygon = asGeoJsonPolygon(LEONBERG);
    expect(polygon).not.toBeNull();
    expect(boundsOf([polygon as NonNullable<typeof polygon>])).toEqual([9.0, 48.795, 9.023, 48.808]);
    expect(boundsOf([polygon as NonNullable<typeof polygon>], [[9.05, 48.79]])).toEqual([
      9.0, 48.79, 9.05, 48.808,
    ]);
  });

  it('returns null with nothing to frame', () => {
    expect(boundsOf([])).toBeNull();
  });
});
