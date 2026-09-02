import { booleanPointInPolygon, point as turfPoint } from '@turf/turf';
import { formatAddress, nominatimJson, type ReverseGeocodeDeps } from './reverseGeocode';

/**
 * Address search for the map's search field.
 *
 * Offline FIRST, always: the rep types a street and the already-synced houses
 * of their own territory answer instantly, with no network and no permission to
 * ask for. Nominatim is the SECOND stage and never automatic — it runs on an
 * explicit button press, only when the local pass found nothing and the app is
 * not offline, because it is a rate-limited third-party service (1 req/s,
 * `nominatimJson` owns that budget) and a keystroke-triggered lookup would burn
 * it in a second.
 *
 * A remote hit OUTSIDE the rep's territory is NAMED, never navigated to: the
 * offline tile extract covers the territory and nothing else, so flying the
 * camera out there would land on a black void that looks like a broken map.
 * Saying "Poststraße 12, Stuttgart — outside your territory" is the honest
 * answer, and it is also the useful one.
 *
 * Pure module except for the one `fetch` (injectable), same posture as
 * `houseList.ts`: no React, so it is testable without a renderer.
 */

/**
 * Fold to a comparable form: case, umlauts and ß only. Deliberately NOT a
 * street-name normalizer ("str." → "straße" etc.) — token CONTAINMENT below
 * already makes "hauptstr 12" match "Hauptstraße 12", which is the abbreviation
 * a rep actually types.
 */
export function foldForSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

/**
 * Rows whose address contains EVERY token of the query, order-independent, so
 * "12 poststr" finds "Poststraße 12" too. A row without a stored address can
 * never match — this module never invents one (houseList.ts D-2).
 */
export function matchLocalRows<T extends { address: string | null }>(
  rows: T[],
  query: string,
  limit = 8,
): T[] {
  const tokens = foldForSearch(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  return rows
    .filter((row) => {
      if (row.address === null) return false;
      const haystack = foldForSearch(row.address);
      return tokens.every((token) => haystack.includes(token));
    })
    .slice(0, limit);
}

export interface GeocodeHit {
  label: string;
  lat: number;
  lon: number;
}

export interface ForwardGeocodeDeps extends ReverseGeocodeDeps {
  /** Territory bbox [west, south, east, north] — biases results, never filters. */
  viewbox?: [number, number, number, number] | null;
}

const DEFAULT_SEARCH_ENDPOINT = 'https://nominatim.openstreetmap.org/search';

/**
 * Forward geocode, or `[]`. Never throws — a failed search leaves the field
 * exactly where it was.
 *
 * `bounded=0` on purpose: results outside the viewbox are wanted, because
 * telling the rep "that address exists, but it is not in your territory" is the
 * whole point of the outside-hit branch. The viewbox only ranks nearby matches
 * first, which is what makes a bare "poststraße" resolve to the right town.
 */
export async function forwardGeocode(
  query: string,
  deps: ForwardGeocodeDeps = {},
): Promise<GeocodeHit[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const endpoint = deps.endpoint ?? DEFAULT_SEARCH_ENDPOINT;
  const viewbox = deps.viewbox
    ? `&bounded=0&viewbox=${deps.viewbox.map((n) => encodeURIComponent(String(n))).join(',')}`
    : '';
  const url =
    `${endpoint}?format=jsonv2&addressdetails=1&limit=5` +
    `&q=${encodeURIComponent(trimmed)}${viewbox}`;

  const body = await nominatimJson(url, deps);
  if (!Array.isArray(body)) return [];

  return body
    .map((raw): GeocodeHit | null => {
      const item = raw as { lat?: unknown; lon?: unknown; display_name?: unknown; address?: unknown };
      const lat = Number(item.lat);
      const lon = Number(item.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const label =
        formatAddress(item.address as Record<string, unknown> | undefined) ??
        (typeof item.display_name === 'string' ? item.display_name.slice(0, 300) : null);
      return label === null ? null : { label, lat, lon };
    })
    .filter((hit): hit is GeocodeHit => hit !== null);
}

/**
 * Is this hit inside the rep's own territory — i.e. is it somewhere the offline
 * tile extract can actually draw? `false` for a missing or malformed boundary,
 * so an unusable polygon degrades to "name it, don't fly there" rather than
 * throwing inside a render.
 */
export function isInsideTerritory(
  hit: { lat: number; lon: number },
  boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon | null | undefined,
): boolean {
  if (!boundary) return false;
  try {
    return booleanPointInPolygon(turfPoint([hit.lon, hit.lat]), boundary);
  } catch {
    return false;
  }
}
