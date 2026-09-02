import { booleanPointInPolygon, point as turfPoint } from '@turf/turf';
import type { HouseStatus } from '../../design/tokens';
import { haversineMeters, type GeoPoint } from './houseList';

/**
 * The doors of a territory, and what is left of them.
 *
 * ── Why this module exists ──────────────────────────────────────────────────
 * A house existed for this app only once a rep tapped the map on it. So a
 * street of sixty doors meant sixty pins placed by hand before the map knew
 * anything, and "how many doors are still open here" had no answer at all:
 * `deriveStreetSummary` counts rows, and rows only exist for doors already
 * touched. Counters without a denominator.
 *
 * The denominator was on the device the whole time. Every building in the
 * Protomaps extract carries `addr_housenumber` (verified against the shipped
 * Leonberg package: `buildings`, z11-15), which is the same offline file the
 * basemap already renders. This module turns those features into the door
 * list the rep is working through.
 *
 * ── What it deliberately does NOT do ────────────────────────────────────────
 * It does not create house rows. A door with no pin is an OPEN door, not an
 * empty record — writing sixty rows into the sync stream to represent "not
 * visited yet" would put a territory's worth of noise on every device in the
 * team to say nothing. The doors are read from the map each time; the rows
 * stay the rep's own answers.
 *
 * Pure: no React, no database, no map ref. The caller supplies the features.
 */

/** One address in the territory, from the basemap's own buildings layer. */
export interface TerritoryDoor {
  /** Stable within a run: rounded coordinates, which is what dedupes tiles. */
  key: string;
  housenumber: string;
  lat: number;
  lon: number;
}

/**
 * ~1.1 m at this latitude. Fine enough that two neighbouring houses never
 * collapse into one, coarse enough that the SAME building arriving from two
 * adjacent tiles does.
 */
const DEDUPE_PRECISION = 5;

const centroidOf = (geometry: GeoJSON.Geometry): GeoPoint | null => {
  // Buildings are polygons; a plain vertex mean is enough to place a door on
  // the right building, and it cannot fail on a self-touching ring the way a
  // real centroid can. Points are taken as-is.
  if (geometry.type === 'Point') {
    const [lon, lat] = geometry.coordinates;
    return typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon)
      ? { lat, lon }
      : null;
  }
  const rings =
    geometry.type === 'Polygon'
      ? geometry.coordinates
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates.flat()
        : null;
  if (!rings || rings.length === 0) return null;
  const ring = rings[0];
  if (!ring || ring.length === 0) return null;
  let lat = 0;
  let lon = 0;
  for (const vertex of ring) {
    const [x, y] = vertex;
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    lon += x;
    lat += y;
  }
  const count = ring.length;
  const result = { lat: lat / count, lon: lon / count };
  return Number.isFinite(result.lat) && Number.isFinite(result.lon) ? result : null;
};

/**
 * Every addressed building inside the boundary, deduplicated.
 *
 * Deduplication is not optional: a building on a tile seam is returned once
 * per tile that carries a piece of it, and `querySourceFeatures` reports every
 * one of them. Counting those twice would inflate the denominator, which is
 * worse than having none — a rep would work a street to the end and be told
 * half of it is still open.
 */
export function deriveTerritoryDoors(
  features: GeoJSON.Feature[],
  boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon | null | undefined,
): TerritoryDoor[] {
  if (!boundary) return [];
  const byKey = new Map<string, TerritoryDoor>();

  for (const feature of features) {
    const housenumber = feature.properties?.addr_housenumber;
    if (typeof housenumber !== 'string' || housenumber.length === 0) continue;
    const centre = feature.geometry ? centroidOf(feature.geometry) : null;
    if (!centre) continue;

    try {
      if (!booleanPointInPolygon(turfPoint([centre.lon, centre.lat]), boundary)) continue;
    } catch {
      continue;
    }

    const key = `${centre.lat.toFixed(DEDUPE_PRECISION)},${centre.lon.toFixed(DEDUPE_PRECISION)}`;
    if (!byKey.has(key)) {
      byKey.set(key, { key, housenumber, lat: centre.lat, lon: centre.lon });
    }
  }

  return [...byKey.values()];
}

/**
 * How close a pin has to be to a door to count as "that door has been worked".
 *
 * A rep drops a pin by tapping the building, and the door sits at the
 * building's centroid, so the two are metres apart at most — but a tap near a
 * corner of a long terrace can land further out than that. 25 m is wide enough
 * to survive a sloppy tap and narrow enough that it cannot reach the house
 * next door on any normal German street.
 */
export const DOOR_MATCH_RADIUS_M = 25;

export interface DoorProgress {
  /** Addressed buildings in the territory. `null` when none are known yet. */
  total: number | null;
  /** Doors with a pin on them. */
  worked: number;
  /** Doors nobody has touched. `null` while `total` is unknown. */
  open: number | null;
}

/**
 * Progress against the doors, not against the pins.
 *
 * `total` stays `null` until the buildings layer has actually been queried —
 * an unknown denominator is rendered as "unknown" by the caller, never as 0.
 * Zero would read as "no doors here", which is a different and false claim.
 */
export function deriveDoorProgress(
  doors: TerritoryDoor[] | null,
  houses: GeoPoint[],
): DoorProgress {
  if (doors === null || doors.length === 0) {
    return { total: doors === null ? null : 0, worked: 0, open: doors === null ? null : 0 };
  }
  let worked = 0;
  for (const door of doors) {
    if (houses.some((house) => haversineMeters(house, door) <= DOOR_MATCH_RADIUS_M)) {
      worked += 1;
    }
  }
  return { total: doors.length, worked, open: doors.length - worked };
}

/**
 * Houses close enough to a tapped coordinate to be worth projecting.
 *
 * The map tap used to project EVERY house into screen space to find out which
 * pin was hit — one native bridge round trip per house, on every tap, on the
 * screen a rep taps all day. Distance in metres is plain arithmetic on numbers
 * already in memory, so it costs nothing to throw away the 99% that are
 * nowhere near the finger, and only the survivors pay for a projection.
 *
 * The radius is generous on purpose: it is a PRE-filter, not the hit test. The
 * real test stays in screen space (48dp, zoom-independent) at the call site —
 * this only decides who gets measured. At the widest zoom a 48dp radius can
 * still cover a few hundred metres, hence 500 rather than something tight.
 */
export const TAP_CANDIDATE_RADIUS_M = 500;

export function tapCandidates<T extends GeoPoint>(houses: T[], tapped: GeoPoint): T[] {
  return houses.filter((house) => haversineMeters(house, tapped) <= TAP_CANDIDATE_RADIUS_M);
}

/**
 * The status filter's state: which statuses are drawn. All six on is the
 * default and the only state in which the map shows everything.
 *
 * A Set would be the obvious shape and is the wrong one here — this lives in
 * React state, and a mutable Set makes "did it change" a question about
 * identity rather than value. A plain record compares field by field and
 * memoizes correctly.
 */
export type StatusFilter = Record<HouseStatus, boolean>;

export const ALL_STATUSES_VISIBLE: StatusFilter = {
  new: true,
  not_home: true,
  follow_up: true,
  no_interest: true,
  success: true,
  blacklist: true,
};

export const isFilterActive = (filter: StatusFilter): boolean =>
  Object.values(filter).some((visible) => !visible);
