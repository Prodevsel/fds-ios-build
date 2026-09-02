/**
 * Pure state derivation for the customer offer page. React-free on purpose, so
 * every rule below is testable without mounting anything.
 *
 * THIS FILE IS WHERE "the link alone shows nothing" IS STRUCTURALLY TRUE.
 * The starting state has no `offer` field — not an empty one, not a hidden one,
 * not one behind a flag. There is no shape in which offer data exists before a
 * correct code came back from the server. Hiding data in the view layer would
 * still ship it to the browser, where anyone can read it out of memory or the
 * network tab; the whole point of the operator's decision was that a forwarded
 * link discloses nothing at all.
 */

/** The frozen commercial terms, exactly as leads.offer_snapshot stored them. */
export interface OfferSnapshot {
  doorPrice?: number | string | null;
  comparisonPrice?: number | string | null;
  discountAmount?: number | string | null;
  termsText?: string | null;
  /**
   * The `direct_pdf` half of the conditions. That product kind has no discount
   * block (D-04) and therefore none of the three price fields above -- its
   * price is the TEXT on the chosen package option, frozen by
   * `buildDirectSignOfferSnapshot`. Strings, not numbers: they are pre-formatted
   * by the product author ("199,00 EUR mtl."), and re-parsing an authored price
   * into a number to re-format it is how a contract ends up disagreeing with
   * the page that sold it.
   */
  packageLabel?: string | null;
  packagePrice?: string | null;
  [key: string]: unknown;
}

/** A resolved belehrung gate block from the PINNED product version. */
export interface BelehrungBlock {
  id: string;
  noticeText: string;
  label?: string;
}

export interface OfferDetails {
  companyDisplayName: string | null;
  contactName: string | null;
  offerExpiresAt: string | null;
  snapshot: OfferSnapshot;
  productKind: string | null;
  productPinned: boolean | null;
  belehrungBlocks: BelehrungBlock[];
}

/**
 * Note what is NOT here: no variant carries offer data except `unlocked` and
 * the states after it. `locked`, `invalid`, `expired`, `redeemed`,
 * `unavailable` and `rate_limited` are structurally incapable of holding a
 * price.
 */
export type OfferState =
  | { kind: 'locked' }
  | { kind: 'checking' }
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | { kind: 'redeemed' }
  | { kind: 'unavailable' }
  | { kind: 'rate_limited' }
  | { kind: 'network_error' }
  | { kind: 'unlocked'; offer: OfferDetails; confirmedGateIds: string[] }
  | { kind: 'signing'; offer: OfferDetails; confirmedGateIds: string[] }
  | { kind: 'signed'; dealReference: string | null };

export const INITIAL_STATE: OfferState = { kind: 'locked' };

/** Anything the server can answer /view with. */
export interface ViewResponse {
  state?: string;
  companyDisplayName?: string | null;
  contactName?: string | null;
  offerExpiresAt?: string | null;
  snapshot?: OfferSnapshot | null;
  productKind?: string | null;
  productPinned?: boolean | null;
  belehrungBlocks?: unknown;
}

function toBelehrungBlocks(raw: unknown): BelehrungBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((b) => {
    if (!b || typeof b !== 'object') return [];
    const block = b as Record<string, unknown>;
    if (typeof block.id !== 'string' || typeof block.noticeText !== 'string') return [];
    return [{
      id: block.id,
      noticeText: block.noticeText,
      label: typeof block.label === 'string' ? block.label : undefined,
    }];
  });
}

/**
 * Maps an HTTP status + body onto the next state. An unrecognised state from
 * the server maps to `invalid` rather than to something permissive — an
 * unknown verdict is not a licence to show an offer.
 */
export function deriveState(status: number, body: ViewResponse | null): OfferState {
  if (status === 429) return { kind: 'rate_limited' };
  if (status >= 500 || !body) return { kind: 'network_error' };
  if (status === 400 || status === 404) return { kind: 'invalid' };

  switch (body.state) {
    case 'ok':
      return {
        kind: 'unlocked',
        confirmedGateIds: [],
        offer: {
          companyDisplayName: body.companyDisplayName ?? null,
          contactName: body.contactName ?? null,
          offerExpiresAt: body.offerExpiresAt ?? null,
          snapshot: body.snapshot ?? {},
          productKind: body.productKind ?? null,
          productPinned: body.productPinned ?? null,
          belehrungBlocks: toBelehrungBlocks(body.belehrungBlocks),
        },
      };
    case 'expired':
      return { kind: 'expired' };
    case 'redeemed':
      return { kind: 'redeemed' };
    case 'unavailable':
      return { kind: 'unavailable' };
    case 'rate_limited':
      return { kind: 'rate_limited' };
    default:
      return { kind: 'invalid' };
  }
}

/** Anything the server can answer /document with. */
export interface DocumentResponse {
  state?: string;
  document?: { pdfBase64?: string; originalSha256?: string } | null;
}

/** The filled contract, ready to hand to a viewer and to the audit package. */
export interface OfferDocument {
  pdfBase64: string;
  originalSha256: string;
}

/**
 * The document, or null.
 *
 * NULL IS A NORMAL ANSWER, not an error: a `flow_form` offer has no document at
 * all, and a `direct_pdf` template published without a signature placement has
 * none either. Both come back as `{ state: 'ok', document: null }` and the page
 * treats them the same way — the conditions stay, the signature stays out of
 * reach. A malformed or half-filled document object is read as null for the
 * same reason: showing a customer half a contract to sign is worse than showing
 * him none.
 */
export function deriveDocument(status: number, body: DocumentResponse | null): OfferDocument | null {
  if (status !== 200 || !body || body.state !== 'ok') return null;
  const doc = body.document;
  if (!doc || typeof doc.pdfBase64 !== 'string' || doc.pdfBase64.length === 0) return null;
  if (typeof doc.originalSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(doc.originalSha256)) return null;
  return { pdfBase64: doc.pdfBase64, originalSha256: doc.originalSha256 };
}

/** Anything the server can answer /sign with. */
export interface SignResponse {
  state?: string;
  dealReference?: string | null;
}

/**
 * Maps the /sign answer onto the next state.
 *
 * Every non-'ok' verdict lands on the SAME state the /view path would produce
 * for it, and that is deliberate: 0098's offer_portal_sign re-runs the entire
 * view verdict (rate limit, digest comparison, expiry, not-yet-redeemed) before
 * it inserts anything, so 'expired' or 'redeemed' arriving here means exactly
 * what it means there. In particular 'redeemed' at THIS point is the two-tabs
 * case — the customer's other tab, or his second tap, already produced the
 * contract — and the honest answer is the same sentence he would have got on
 * opening the link again, not an error.
 */
export function deriveSignState(status: number, body: SignResponse | null): OfferState {
  if (status === 429) return { kind: 'rate_limited' };
  if (status >= 500 || !body) return { kind: 'network_error' };
  if (body.state === 'ok') return { kind: 'signed', dealReference: body.dealReference ?? null };
  if (status === 400 || status === 413) return { kind: 'network_error' };
  switch (body.state) {
    case 'expired':
      return { kind: 'expired' };
    case 'redeemed':
      return { kind: 'redeemed' };
    case 'unavailable':
      return { kind: 'unavailable' };
    case 'rate_limited':
      return { kind: 'rate_limited' };
    default:
      return { kind: 'invalid' };
  }
}

/**
 * The withdrawal-notice gate, as a rule rather than as a rendering decision.
 *
 * `isSignatureReachable(x, null) === false` is the case that matters: an offer
 * whose product carries NO belehrung gate block can never be signed here. That
 * is not a defensive default, it is the only correct answer — 0030's
 * reject_ungated_contract would refuse the INSERT anyway, and telling the
 * customer up front is better than letting him sign into a server error.
 */
export function isSignatureReachable(
  confirmedGateIds: readonly string[],
  blocks: readonly BelehrungBlock[] | null | undefined,
): boolean {
  if (!blocks || blocks.length === 0) return false;
  return blocks.every((b) => confirmedGateIds.includes(b.id));
}

/**
 * Prices come out of the snapshot as numbers or as Postgres numeric strings.
 * A missing or unparseable field returns null and the CALLER OMITS THE ROW —
 * it must never become "0,00 €". A contract that claims a door price of zero is
 * worse than one that admits it does not know.
 */
export function parsePrice(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function formatEuro(raw: unknown): string | null {
  const n = parsePrice(raw);
  if (n === null) return null;
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
}

export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}
