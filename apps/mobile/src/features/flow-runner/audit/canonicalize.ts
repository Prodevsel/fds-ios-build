/**
 * Deterministic canonical JSON serializer (D-26).
 *
 * ROOT CAUSE this exists for: a hash is only usable as legal evidence
 * (SIGN-03/SIGN-04 audit package + document hash) if it is independently
 * reproducible from the same logical data. `JSON.stringify` does NOT
 * guarantee key order across environments/engines for arbitrary objects
 * (it happens to preserve insertion order in V8, but that is an
 * implementation detail, not a spec guarantee to build legal evidence on).
 *
 * FIX: canonicalize() recursively sorts object keys itself (not relying on
 * JSON.stringify's replacer/key-order behavior), strips all insignificant
 * whitespace, omits `undefined`-valued keys, and preserves `null`. Array
 * order is preserved (arrays are ordered data, not a key/value bag).
 *
 * Both the document hash (over the contract snapshot) and the audit
 * package hash (over the assembled `AuditPackage` minus its own hash field)
 * MUST serialize through this ONE function — see hashCanonical below and
 * buildAuditPackage.ts's computePackageHash — so the two hashes are
 * provably comparable/reproducible by a third party re-running the same
 * canonicalization over the same logical data (T-04-10).
 */

/** Recursively sorts object keys and renders whitespace-free JSON. */
export function canonicalize(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === undefined) {
    // Only reachable at the top level (`canonicalize(undefined)`); nested
    // undefined-valued object keys are omitted before recursing — see
    // serializeObject below.
    return 'null';
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return serializeArray(value);
  }
  if (typeof value === 'object') {
    return serializeObject(value as Record<string, unknown>);
  }
  // Functions/symbols/bigint etc. are not valid audit-package data; render
  // them as null rather than throwing, matching JSON.stringify's own
  // behavior for unsupported types in nested positions.
  return 'null';
}

function serializeArray(value: unknown[]): string {
  // Array ORDER is preserved (Task 1 behavior spec) — only object keys are
  // sorted, never array element order.
  const items = value.map((item) => serialize(item));
  return `[${items.join(',')}]`;
}

function serializeObject(value: Record<string, unknown>): string {
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${serialize(value[key])}`);
  return `{${entries.join(',')}}`;
}

/**
 * Hashes `value` through the SAME canonicalize() path used everywhere else
 * an audit hash is computed — the single code path both the document hash
 * and the package hash share (D-26/T-04-10).
 */
export async function hashCanonical(
  value: unknown,
  digestFn: (canonicalJson: string) => Promise<string>,
): Promise<string> {
  return digestFn(canonicalize(value));
}
