import type { HouseStatus } from '../../design/tokens';
import type { HouseRow } from './db/housesRepo';
import { deriveBuildingStatus, hasNoSolicitationLock } from './buildingStatus';

/**
 * The house list: the SAME buildings the map renders, ordered nearest-first,
 * so a rep can work a street by proximity instead of by where a pin happens to
 * sit on screen. The list is an ADDITIONAL view — the map stays the default.
 *
 * Deliberately a pure, exported module and NOT component logic (same posture
 * as `buildingStatus.ts`): the mobile test harness has no
 * `react-test-renderer`, so anything that only exists inside a component
 * cannot be asserted. Everything decidable about a list row lives here.
 *
 * No React, no imports from components, no database access — the caller
 * supplies the rows.
 *
 * TWO rules this module exists to keep honest:
 *
 *   * D-2 — it reads ONLY `houses.address`, the value the StatusSheet already
 *     resolves once, persists and LWW-syncs to the team. It NEVER calls
 *     `reverseGeocode` and never derives an address from coordinates: that
 *     module is online and hard-limited to 1 request/second (Nominatim
 *     policy), so a 40-house list would serialize into a ~44-second request
 *     storm on a screen the rep opens for a few seconds (T-G01-01). A row
 *     with no stored address is rendered with an honest "unknown" marker by
 *     the caller — `address` stays `null` here.
 *
 *   * D-3 — without a location fix every `distanceMeters` is `null` and the
 *     order falls back to `createdAt` ascending, the order the rep dropped the
 *     pins. Never a fake "0 m", and never SQLite's unspecified row order
 *     (neither `watchHouses` nor `watchUnits` has an ORDER BY), which would
 *     shuffle between renders while claiming to be sorted.
 */

export interface HouseListRow {
  houseId: string;
  /** The STORED address, verbatim, or `null` — never invented (D-2). */
  address: string | null;
  lat: number;
  lon: number;
  /** The DERIVED building status — the same one the pin shows. */
  status: HouseStatus;
  /** Untouched doors ('new' parties); `null` for a building with no parties. */
  openUnits: number | null;
  hasUnits: boolean;
  /** `null` when there is no location fix at all (D-3). */
  distanceMeters: number | null;
  createdAt: string;
}

export interface GeoPoint {
  lat: number;
  lon: number;
}

/** Mean earth radius, metres — the standard haversine constant. */
const EARTH_RADIUS_M = 6_371_000;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in metres. Plain arithmetic on purpose: a geo
 * dependency for one formula would be a new package in a legally sensitive
 * offline app for no gain.
 */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * One row per building, ordered for the list.
 *
 * The rollup is NOT re-derived here: `deriveBuildingStatus` is called with the
 * exact same argument shape the marker loop in `MapScreen.tsx` uses — including
 * the empty blacklist array, because `blacklist_entries` are not watched on
 * that screen and the building's own status is the source the existing UI
 * actually writes (see `hasNoSolicitationLock`'s note). A row and a pin
 * therefore cannot disagree about the same building.
 *
 * Sorting happens on a COPY: `houses` is React state in `MapScreen` and must
 * never be mutated.
 */
export function deriveHouseListRows(input: {
  houses: HouseRow[];
  unitsByParent: Map<string, HouseRow[]>;
  origin: GeoPoint | null;
}): HouseListRow[] {
  const { houses, unitsByParent, origin } = input;

  const rows: HouseListRow[] = houses.map((house) => {
    const rollup = deriveBuildingStatus({
      building: house,
      units: unitsByParent.get(house.id) ?? [],
      noSolicitation: hasNoSolicitationLock([], house.id, house.status),
    });
    return {
      houseId: house.id,
      address: house.address,
      lat: house.lat,
      lon: house.lon,
      status: rollup.status,
      openUnits: rollup.openUnits,
      hasUnits: rollup.hasUnits,
      distanceMeters: origin === null ? null : haversineMeters(origin, house),
      createdAt: house.created_at,
    };
  });

  const byCreatedAt = (a: HouseListRow, b: HouseListRow): number =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;

  if (origin === null) {
    // D-3 — deterministic without a fix: the order the pins were dropped.
    return rows.sort(byCreatedAt);
  }

  return rows.sort((a, b) => {
    const distanceDelta = (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0);
    return distanceDelta !== 0 ? distanceDelta : byCreatedAt(a, b);
  });
}

/**
 * The distance cell's text, or `null` when there is no distance to show — the
 * caller omits the cell entirely rather than printing a fake "0 m" (D-3).
 *
 * The unit symbols ("m"/"km") are SI symbols, not translatable copy, so they
 * stay here rather than in the i18n bundle. The German decimal comma follows
 * the existing `toLocaleDateString('de-DE')` precedent in this codebase.
 *
 * Metres are rounded BEFORE the 1 km threshold is applied, so 999.6 m reads
 * "1,0 km" rather than the nonsensical "1000 m".
 */
export function formatDistanceLabel(meters: number | null): string | null {
  if (meters === null || !Number.isFinite(meters)) {
    return null;
  }
  const wholeMeters = Math.round(meters);
  if (wholeMeters < 1000) {
    return `${wholeMeters} m`;
  }
  return `${(wholeMeters / 1000).toFixed(1).replace('.', ',')} km`;
}
