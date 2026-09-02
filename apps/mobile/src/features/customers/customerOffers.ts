import type { Customer, CustomerOffer } from './customerSearch';

/**
 * The offer rules of the customer list, kept OUT of the screen on purpose.
 *
 * `KundenScreen.tsx` imports react-native, and the mobile test harness cannot
 * parse that module (it ships Flow types) — so anything exported from the
 * screen is unreachable from a test. Same reason `customerSearch.ts` and
 * `directSignOffer.ts` are React-free: the load-bearing rule lives next to the
 * screen, not inside it.
 *
 * Both functions take `nowIso` instead of reading a clock. A projection that
 * silently called `Date.now()` would answer differently between two renders and
 * could not be pinned to an instant in a test.
 */

/** The three segments of the customer list. */
export type KundenFilter = 'all' | 'offers' | 'customers';

/**
 * Is this offer still worth chasing?
 *
 * Redeemed wins over expiry: an offer accepted on its last day is accepted, not
 * expired. An offer with NO deadline never expires — inventing one would put a
 * date on the screen that exists nowhere in the data.
 */
export function offerState(
  offer: CustomerOffer,
  nowIso: string,
): 'redeemed' | 'expired' | 'open' {
  if (offer.redeemed) return 'redeemed';
  if (offer.expiresAtIso !== null && offer.expiresAtIso <= nowIso) return 'expired';
  return 'open';
}

/** `false` for a customer filtered out by the active segment. Pure. */
export function matchesKundenFilter(
  customer: Customer,
  filter: KundenFilter,
  nowIso: string,
): boolean {
  if (filter === 'all') return true;
  // "Angebote offen" is the list a rep actually needs: who is still deciding.
  // A redeemed or expired offer is history and belongs under "Alle" — a filter
  // that answers "who should I call back" must not include people who already
  // signed or whose offer lapsed weeks ago.
  if (filter === 'offers') {
    return customer.offers.some((o) => offerState(o, nowIso) === 'open');
  }
  return customer.contractCount > 0;
}

/** How many offers across all customers are still open — the segment's badge. */
export function countOpenOffers(customers: readonly Customer[], nowIso: string): number {
  let n = 0;
  for (const customer of customers) {
    for (const offer of customer.offers) {
      if (offerState(offer, nowIso) === 'open') n++;
    }
  }
  return n;
}
