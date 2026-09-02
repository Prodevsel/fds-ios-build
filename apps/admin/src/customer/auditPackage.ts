/**
 * The evidence half of a customer self-close: the canonical serializer, the
 * confirmed-notice-gate entry, and the browser audit package.
 *
 * WHY A SECOND COPY OF canonicalizeForHash EXISTS HERE. The identical rule
 * already lives at apps/mobile/src/features/flow-runner/audit/canonicalize.ts.
 * Moving it to packages/shared is the RIGHT end state and is recorded as a
 * follow-up in this plan's SUMMARY, but it would mean touching apps/mobile —
 * which is outside this change and off the demo path. Until then the two are
 * held together by canonicalizeForHash's own test file, which measures this
 * implementation against the exact example values the mobile test measures.
 * That is a weaker guarantee than one implementation, and it is written down as
 * such rather than quietly assumed.
 *
 * The rule itself is not cosmetic. A hash is only usable as evidence if a third
 * party can reproduce it from the same logical data, and JSON.stringify makes
 * no guarantee about object key order across engines — V8 happens to preserve
 * insertion order, which is an implementation detail and not something legal
 * evidence may rest on.
 */

/** A point of a signature stroke. No `pressure` field: see SignaturePad.tsx. */
export interface StrokePoint {
  x: number;
  y: number;
  t: number;
}

/** The confirmed-gate entry shape migration 0030's trigger validates. */
export interface ConfirmedGateEntry {
  blockId: string;
  confirmedAtIso: string;
  noticeTextSha256: string;
}

/**
 * The browser-channel audit package.
 *
 * Field names are IDENTICAL to apps/mobile's AuditPackage so a contract signed
 * in a browser has the same shape as one signed in the app, with four honest
 * deviations and not one placeholder. Every one of them is null because the
 * value genuinely does not exist on this path — never because it was
 * inconvenient to obtain:
 *
 *   deviceId          a browser has no stable device identifier we are entitled
 *                     to read, and a random per-visit id would be a fabricated
 *                     one wearing the name of a real one.
 *   serverTimeAnchor  the app anchors on the `iat` of its Supabase JWT. The
 *                     customer has no session and therefore no JWT. The server
 *                     clock still governs the contract: 0098 writes signed_at
 *                     from now(), so `signedAtIso` below is what the BROWSER
 *                     claimed, recorded next to it, never instead of it.
 *   gps               already a valid value of the existing shape (D-04: GPS
 *                     never blocks a signature), and no self-close over a link
 *                     is entitled to the customer's location.
 *   productVersion    the /view response deliberately does not carry it. 0098's
 *                     offer_portal_sign resolves the pinned version server-side
 *                     and writes contracts.product_version from that resolution,
 *                     which is the authoritative value; echoing a browser-held
 *                     guess beside it would create a second, weaker source.
 *   dealReference     structurally impossible here: 0098 GENERATES the deal
 *                     reference from the server clock during the very insert
 *                     this package is an argument to. It does not exist yet at
 *                     the moment this object is built.
 *
 * `channel` is the one ADDED field, and it is the point: any later reader —
 * an auditor, a Fachanwalt, a support case — learns from the package itself how
 * this contract came about, instead of inferring it from which fields are null.
 */
export interface BrowserAuditPackage {
  documentHashSha256: string;
  signedAtIso: string;
  serverTimeAnchor: null;
  deviceId: null;
  deviceIdSource: 'browser';
  gps: null;
  confirmedGates: ConfirmedGateEntry[];
  signatureStrokeData: StrokePoint[][];
  productVersion: null;
  dealReference: null;
  channel: 'customer-browser';
}

/** Hashes a canonical JSON string to lowercase hex. */
export type DigestFn = (canonicalJson: string) => Promise<string>;

/** Recursively sorts object keys and renders whitespace-free JSON. */
export function canonicalizeForHash(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  // Only reachable at the top level; nested undefined-valued keys are dropped
  // before recursing (see serializeObject).
  if (value === undefined || value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) {
    // Array ORDER is data and is preserved. Only object keys are sorted.
    return `[${value.map((item) => serialize(item)).join(',')}]`;
  }
  if (typeof value === 'object') return serializeObject(value as Record<string, unknown>);
  // Functions, symbols and bigints are not valid audit data. Rendering them as
  // null matches JSON.stringify's own behaviour in nested positions rather than
  // throwing halfway through building evidence.
  return 'null';
}

function serializeObject(value: Record<string, unknown>): string {
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize(value[key])}`).join(',')}}`;
}

/**
 * The default digest, over the Web Crypto API the browser already ships.
 *
 * jsdom provides `crypto.subtle` in the version this workspace pins, so the
 * tests exercise this path rather than a stub. Where it is absent, the caller
 * INJECTS a digest function (every function below takes one) — the same DI
 * shape apps/mobile uses for buildConfirmedGateEntry. Deliberately not a
 * polyfill: a hand-rolled SHA-256 sitting in a legally load-bearing path is a
 * far worse trade than a caller passing one in.
 */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Builds the entry migration 0030's reject_ungated_contract trigger looks for.
 *
 * Hashes `noticeText` and NOTHING ELSE — not the label, not the block, not a
 * rendered string with the heading glued on. The block is the single source of
 * truth for what the customer was actually shown (the same rule
 * directSignGate.ts states for the app), and the hash is only meaningful if it
 * is a hash of exactly that text.
 */
export async function buildConfirmedGateEntry(
  block: { id: string; noticeText: string },
  confirmedAtIso: string,
  digest: DigestFn = sha256Hex,
): Promise<ConfirmedGateEntry> {
  return {
    blockId: block.id,
    confirmedAtIso,
    noticeTextSha256: await digest(block.noticeText),
  };
}

/**
 * The document hash for the flow_form self-close path.
 *
 * NAMING THE DIFFERENCE INSTEAD OF HIDING IT: on the direct_pdf path
 * `documentHashSha256` is the SHA-256 of the original PDF's bytes, hashed
 * before any PDF library touched them. Here there is no original document at
 * all — the customer was shown a rendered page, not a file. So this is the
 * SHA-256 over the canonicalised snapshot plus the answers: precisely the facts
 * that were on the customer's screen when he signed. That is a different basis
 * for the same field name, and it is written down here rather than left for
 * someone to discover during a dispute.
 */
export async function computeDocumentHash(
  snapshot: unknown,
  answers: unknown,
  digest: DigestFn = sha256Hex,
): Promise<string> {
  return digest(canonicalizeForHash({ answers, snapshot }));
}

export interface BuildBrowserAuditPackageInputs {
  documentHashSha256: string;
  signedAtIso: string;
  confirmedGates: ConfirmedGateEntry[];
  signatureStrokeData: StrokePoint[][];
}

/**
 * PURE assembly — no clock, no crypto, no DOM. Everything unknowable on this
 * channel is set to null HERE, in one place, so no caller can pass a value that
 * quietly fills one of them in.
 */
export function buildBrowserAuditPackage(
  inputs: BuildBrowserAuditPackageInputs,
): BrowserAuditPackage {
  return {
    documentHashSha256: inputs.documentHashSha256,
    signedAtIso: inputs.signedAtIso,
    serverTimeAnchor: null,
    deviceId: null,
    deviceIdSource: 'browser',
    gps: null,
    confirmedGates: inputs.confirmedGates,
    signatureStrokeData: inputs.signatureStrokeData,
    productVersion: null,
    dealReference: null,
    channel: 'customer-browser',
  };
}

/**
 * Hashes the assembled package through the SAME canonicalizer the document hash
 * used, so the two are comparable by anyone re-running the same rule over the
 * same logical data.
 */
export async function computePackageHash(
  pkg: BrowserAuditPackage,
  digest: DigestFn = sha256Hex,
): Promise<string> {
  return digest(canonicalizeForHash(pkg));
}
