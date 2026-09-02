/**
 * Offer codes (§5.2) — "was ist wenn er es sich wann anders dazu entscheidet?"
 *
 * A consultation that ends without a signature can still leave the customer a
 * written offer and a code to redeem it later. The code is generated ON THE
 * DEVICE, at the door, offline: the rep reads it out immediately, and the same
 * value travels up with the insert-only `leads` row (0084) to be printed on the
 * offer PDF the dispatcher mails out.
 *
 * Everything here is pure except `generateOfferCode`, whose single source of
 * randomness is injected — so the format, the expiry arithmetic and the
 * redemption rules are all unit-testable without a native runtime.
 */

/**
 * Crockford-ish base32 without the four characters a customer reads back
 * wrongly over the phone (0/O, 1/I). 32 symbols → 5 bits each → 40 bits over
 * the eight payload characters, which is far more than enough against the
 * partial unique index in 0084 (a collision is a failed insert, not a wrong
 * offer).
 */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** How long an offer stands unless the rep is given a way to override it. */
export const OFFER_VALIDITY_DAYS = 14;

/**
 * Renders 40 bits as `FDS-XXXX-XXXX`. Pure; exported for the format test.
 * Bits above 2^40 are ignored rather than rejected — the caller feeds a hash /
 * uuid slice, and silently truncating is the behaviour every call site wants.
 */
export function formatOfferCode(bits: bigint): string {
  let rest = bits & ((1n << 40n) - 1n);
  const chars: string[] = [];
  for (let i = 0; i < 8; i++) {
    chars.unshift(ALPHABET.charAt(Number(rest & 31n)));
    rest >>= 5n;
  }
  return `FDS-${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

/**
 * Generates a fresh offer code from a uuid (the app already has
 * `Crypto.randomUUID` everywhere; adding a second RNG import would buy nothing).
 * The first 10 hex digits — 40 bits of the uuid's random field — become the
 * payload.
 */
export function generateOfferCode(uuid: string): string {
  const hex = uuid.replace(/[^0-9a-f]/gi, '').slice(0, 10);
  return formatOfferCode(BigInt(`0x${hex || '0'}`));
}

/** The deadline printed on the offer PDF and enforced at redemption. */
export function offerExpiryIso(from: Date, days: number = OFFER_VALIDITY_DAYS): string {
  const expires = new Date(from.getTime());
  expires.setUTCDate(expires.getUTCDate() + days);
  return expires.toISOString();
}

/**
 * Accepts what the rep actually types: lowercase, missing dashes, stray spaces,
 * with or without the `FDS-` prefix. Returns the canonical form, or null when
 * the input cannot be a code at all (so the caller shows "unbekannt" instead of
 * running a pointless query).
 */
export function normalizeOfferCode(input: string): string | null {
  const compact = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/^FDS/, '');
  if (compact.length !== 8) return null;
  if (![...compact].every((c) => ALPHABET.includes(c))) return null;
  return `FDS-${compact.slice(0, 4)}-${compact.slice(4)}`;
}

/** The lead row a redemption resolves to, as read from local SQLite. */
export interface RedeemableOffer {
  leadId: string;
  productInterest: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  offerExpiresAtIso: string | null;
  /** Frozen terms from the original consultation, or null if none were captured. */
  snapshot: Record<string, unknown> | null;
}

export type RedeemResult =
  | { status: 'ok'; offer: RedeemableOffer }
  | { status: 'unknown' }
  | { status: 'expired'; offer: RedeemableOffer }
  | { status: 'already_redeemed'; offer: RedeemableOffer };

export interface OfferLookupDb {
  getAll<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

interface RawOfferRecord {
  id: string;
  product_interest: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  offer_expires_at: string | null;
  offer_snapshot: string | null;
  /** NULL unless some already-synced contract redeemed this very lead. */
  redeemed_by: string | null;
}

/**
 * Redemption is a JOIN, not a flag: `leads` is insert-only (0033/0084), so
 * "already redeemed" is the existence of a contract carrying this lead's id.
 * Both tables are on-device already, so the whole lookup works offline.
 */
const OFFER_LOOKUP_SQL = `
  SELECT l.id AS id, l.product_interest AS product_interest,
         l.contact_name AS contact_name, l.contact_phone AS contact_phone,
         l.contact_email AS contact_email, l.offer_expires_at AS offer_expires_at,
         l.offer_snapshot AS offer_snapshot,
         (SELECT c.id FROM contracts c WHERE c.redeemed_lead_id = l.id LIMIT 1) AS redeemed_by
  FROM leads l
  WHERE l.offer_code = ?
  LIMIT 1
`;

function toOffer(record: RawOfferRecord): RedeemableOffer {
  let snapshot: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = record.offer_snapshot ? JSON.parse(record.offer_snapshot) : null;
    snapshot = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    // A malformed snapshot must never block a redemption — the rep re-captures.
    snapshot = null;
  }
  return {
    leadId: record.id,
    productInterest: record.product_interest,
    contactName: record.contact_name,
    contactPhone: record.contact_phone,
    contactEmail: record.contact_email,
    offerExpiresAtIso: record.offer_expires_at,
    snapshot,
  };
}

/**
 * Resolves a typed code to its offer and says why it cannot be used, if it
 * cannot. An expired or spent offer still returns the row — the UI names the
 * customer and the date rather than a bare "ungültig", which is what the rep
 * standing at the door needs in order to explain it.
 */
export async function lookupOffer(
  db: OfferLookupDb,
  typedCode: string,
  now: Date = new Date(),
): Promise<RedeemResult> {
  const code = normalizeOfferCode(typedCode);
  if (!code) return { status: 'unknown' };

  const rows = await db.getAll<RawOfferRecord>(OFFER_LOOKUP_SQL, [code]);
  const record = rows[0];
  if (!record) return { status: 'unknown' };

  const offer = toOffer(record);
  if (record.redeemed_by) return { status: 'already_redeemed', offer };
  if (offer.offerExpiresAtIso && new Date(offer.offerExpiresAtIso).getTime() < now.getTime()) {
    return { status: 'expired', offer };
  }
  return { status: 'ok', offer };
}
