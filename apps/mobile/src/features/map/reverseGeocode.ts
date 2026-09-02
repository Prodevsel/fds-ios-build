/**
 * Reverse geocoding for map pins (0083_houses_address.sql).
 *
 * A pin carried lat/lon and nothing else, so the status sheet could not name
 * the building it sat on — the rep at the door had coordinates and no address.
 * This resolves one ONCE per house, writes it to `houses.address`, and the LWW
 * sync hands it to the rest of the team. Every later open reads the stored
 * value, online or not.
 *
 * Nominatim, not a paid geocoder: no key to provision before a demo, and the
 * volume here is one lookup per newly dropped pin. Its usage policy requires an
 * identifying User-Agent and at most one request per second, both honoured
 * below. Swap `endpoint` for a self-hosted instance when volume grows — that is
 * the upgrade path, and it is a one-line change at the call site.
 */

export interface ReverseGeocodeDeps {
  fetchFn?: typeof fetch;
  endpoint?: string;
  /** Wall clock, injected so the rate limiter is testable without timers. */
  now?: () => number;
}

const DEFAULT_ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT = 'FrontDoorSales/0.1 (door-to-door sales app)';
/** Nominatim's published policy: absolute maximum of one request per second. */
const MIN_INTERVAL_MS = 1100;
const TIMEOUT_MS = 6000;

let lastRequestAt = 0;

/**
 * One rate-limited, timed-out, User-Agent-carrying Nominatim GET, decoded as
 * JSON — or `null` for every failure mode there is (offline, timeout, 4xx/5xx,
 * garbage body). Shared by the reverse lookup below and the forward address
 * search (`addressSearch.ts`) so BOTH honour the same 1 req/s policy budget:
 * two independent limiters would each think they were the only caller.
 */
export async function nominatimJson(url: string, deps: ReverseGeocodeDeps = {}): Promise<unknown> {
  const doFetch = deps.fetchFn ?? fetch;
  const now = deps.now ?? (() => Date.now());

  const since = now() - lastRequestAt;
  if (since < MIN_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_INTERVAL_MS - since));
  }
  lastRequestAt = now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await doFetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // Offline, timed out, rate limited, malformed — all the same outcome here.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Formats the address the way a rep reads it out loud at the door: street and
 * number first, then postcode and town. Anything missing is simply dropped
 * rather than rendered as "undefined".
 */
export function formatAddress(address: Record<string, unknown> | undefined): string | null {
  if (!address) return null;
  const str = (key: string): string => (typeof address[key] === 'string' ? (address[key] as string) : '');
  const street = [str('road') || str('pedestrian') || str('footway'), str('house_number')]
    .filter(Boolean)
    .join(' ')
    .trim();
  const town = [str('postcode'), str('city') || str('town') || str('village') || str('suburb')]
    .filter(Boolean)
    .join(' ')
    .trim();
  const joined = [street, town].filter(Boolean).join(', ');
  return joined.length > 0 ? joined.slice(0, 300) : null;
}

/**
 * Resolves an address, or null. NEVER throws and never blocks the sheet: a
 * failed lookup leaves the house without an address, which is exactly the state
 * it was already in.
 */
export async function reverseGeocode(
  lat: number,
  lon: number,
  deps: ReverseGeocodeDeps = {},
): Promise<string | null> {
  const endpoint = deps.endpoint ?? DEFAULT_ENDPOINT;
  const url =
    `${endpoint}?format=jsonv2&zoom=18&addressdetails=1` +
    `&lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}`;
  const body = (await nominatimJson(url, deps)) as { address?: Record<string, unknown> } | null;
  return formatAddress(body?.address);
}
