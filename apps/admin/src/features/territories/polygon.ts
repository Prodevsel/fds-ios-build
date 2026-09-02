/**
 * Pure GeoJSON-polygon geometry for the Gebiete (territory) map.
 *
 * `territories.boundary` is a JSONB **GeoJSON Polygon**, not a PostGIS
 * geometry column (verified against the live schema), so the browser reads and
 * writes plain JSON and there is no server-side geometry type to lean on for
 * shape questions the UI has to answer before it writes.
 *
 * The authority on validity is still the database: `create_territory_boundary`
 * (migration 0018) runs `ST_IsValid` and answers `'invalid_geometry'`. The
 * `hasSelfIntersection` check here is NOT a second source of truth — it exists
 * because `territories` has no DELETE RLS policy, so a territory row whose
 * boundary RPC is rejected can never be cleaned up by the client. Refusing an
 * obviously self-intersecting ring in the browser keeps that unreachable
 * state unreachable in practice.
 */

/** A GeoJSON position: [longitude, latitude]. */
export type Position = [number, number];

/** The GeoJSON Polygon subset actually stored in `territories.boundary`. */
export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: Position[][];
}

/** Geographic bounds as MapLibre expects them: [west, south, east, north]. */
export type Bounds = [number, number, number, number];

function isPosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

/**
 * Narrow an untyped JSONB value from PostgREST to a Polygon. Anything that is
 * not a well-formed Polygon (including the `null` boundary of a territory that
 * was created but never drawn) returns `null` — callers render an honest
 * "no boundary drawn" state rather than inventing one.
 */
export function asGeoJsonPolygon(value: unknown): GeoJsonPolygon | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as { type?: unknown; coordinates?: unknown };
  if (candidate.type !== 'Polygon' || !Array.isArray(candidate.coordinates)) {
    return null;
  }
  const rings: Position[][] = [];
  for (const ring of candidate.coordinates) {
    if (!Array.isArray(ring) || ring.length < 4 || !ring.every(isPosition)) {
      return null;
    }
    rings.push(ring.map((p) => [p[0], p[1]] as Position));
  }
  return rings.length === 0 ? null : { type: 'Polygon', coordinates: rings };
}

/** Whether two positions are the same point. */
function samePoint(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Close an open vertex list into a GeoJSON linear ring (first === last).
 * Already-closed input is returned unchanged.
 */
export function closeRing(points: readonly Position[]): Position[] {
  if (points.length === 0) {
    return [];
  }
  const first = points[0] as Position;
  const last = points[points.length - 1] as Position;
  const ring = points.map((p) => [p[0], p[1]] as Position);
  if (!samePoint(first, last)) {
    ring.push([first[0], first[1]]);
  }
  return ring;
}

/** Orientation sign of the triple (p, q, r): >0 ccw, <0 cw, 0 collinear. */
function cross(p: Position, q: Position, r: Position): number {
  return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
}

/**
 * Proper segment intersection (shared endpoints and collinear touching do NOT
 * count) — enough to catch the "bow-tie" a mouse-drawn polygon produces, which
 * is the only self-intersection the draw interaction can actually create.
 */
function segmentsCross(a1: Position, a2: Position, b1: Position, b2: Position): boolean {
  const d1 = cross(a1, a2, b1);
  const d2 = cross(a1, a2, b2);
  const d3 = cross(b1, b2, a1);
  const d4 = cross(b1, b2, a2);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * True when any two non-adjacent edges of the (closed) ring properly cross.
 * O(n²) — a hand-drawn territory has tens of vertices, not thousands.
 */
export function hasSelfIntersection(ring: readonly Position[]): boolean {
  const n = ring.length - 1; // edge count of a closed ring
  if (n < 4) {
    return false; // a triangle cannot self-intersect
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) {
        continue;
      }
      if (
        segmentsCross(
          ring[i] as Position,
          ring[i + 1] as Position,
          ring[j] as Position,
          ring[j + 1] as Position,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

export type DraftVerdict = 'ok' | 'too_few_points' | 'self_intersecting';

/**
 * Verdict on a draft vertex list, in the same discriminated-string style the
 * repo's RPCs use. `too_few_points` means fewer than three distinct corners.
 */
export function draftVerdict(points: readonly Position[]): DraftVerdict {
  if (points.length < 3) {
    return 'too_few_points';
  }
  return hasSelfIntersection(closeRing(points)) ? 'self_intersecting' : 'ok';
}

/**
 * Build the Polygon to persist. Returns `null` for any draft whose verdict is
 * not `'ok'`, so an invalid shape can never reach a write path by accident.
 */
export function draftToPolygon(points: readonly Position[]): GeoJsonPolygon | null {
  if (draftVerdict(points) !== 'ok') {
    return null;
  }
  return { type: 'Polygon', coordinates: [closeRing(points)] };
}

/** Bounding box over any number of polygons and loose points; `null` if empty. */
export function boundsOf(polygons: readonly GeoJsonPolygon[], points: readonly Position[] = []): Bounds | null {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;

  const visit = (p: Position) => {
    west = Math.min(west, p[0]);
    east = Math.max(east, p[0]);
    south = Math.min(south, p[1]);
    north = Math.max(north, p[1]);
  };

  for (const polygon of polygons) {
    for (const ring of polygon.coordinates) {
      for (const position of ring) {
        visit(position);
      }
    }
  }
  for (const position of points) {
    visit(position);
  }

  if (!Number.isFinite(west) || !Number.isFinite(south)) {
    return null;
  }
  return [west, south, east, north];
}
