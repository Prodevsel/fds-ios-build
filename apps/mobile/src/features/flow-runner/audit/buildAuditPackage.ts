import { canonicalize } from './canonicalize';

/**
 * SIGN-03 audit package shape (04-PATTERNS.md + D-17/D-20/D-21; stroke field
 * frozen by 04-STROKE-SPIKE.md).
 *
 * `signatureStrokeData` stores the `getData()`/`onGetData` JSON output
 * VERBATIM (parsed, not hand-re-serialized) — an array of point-groups, no
 * `pressure` field (confirmed absent on the tested device/library, not a
 * bug — see 04-STROKE-SPIKE.md). Do not synthesize/default a pressure value.
 */
export interface AuditPackage {
  documentHashSha256: string;
  signedAtIso: string;
  serverTimeAnchor: { iat: number; source: 'supabase-jwt' } | null;
  deviceId: string;
  deviceIdSource: 'idfv' | 'androidId' | 'fallback-uuid';
  gps: { lat: number; lng: number; accuracyM: number } | null;
  confirmedGates: Array<{ blockId: string; confirmedAtIso: string; noticeTextSha256: string }>;
  signatureStrokeData: unknown[];
  productVersion: number;
  dealReference: string;
}

export type BuildAuditPackageInputs = AuditPackage;

/**
 * PURE mapping from injected inputs to the AuditPackage shape — no
 * expo-crypto/location/device import here (Pitfall 1/4). The document hash,
 * server-time anchor (iat-only, NEVER the raw JWT — T-04-09), device id +
 * source, GPS-or-null, confirmed gates, and stroke data are all computed by
 * callers/other wrappers (canonicalize/hashCanonical, getDeviceId,
 * getSignatureLocation) and passed in. This keeps the assembler trivially
 * testable and reproducible: same inputs -> byte-identical canonicalized
 * output every time (T-04-10).
 */
export function buildAuditPackage(inputs: BuildAuditPackageInputs): AuditPackage {
  return {
    documentHashSha256: inputs.documentHashSha256,
    signedAtIso: inputs.signedAtIso,
    serverTimeAnchor: inputs.serverTimeAnchor,
    deviceId: inputs.deviceId,
    deviceIdSource: inputs.deviceIdSource,
    gps: inputs.gps,
    confirmedGates: inputs.confirmedGates,
    signatureStrokeData: inputs.signatureStrokeData,
    productVersion: inputs.productVersion,
    dealReference: inputs.dealReference,
  };
}

/**
 * Hashes the assembled package through the SAME canonicalize() the document
 * hash uses (D-26/T-04-10) — the caller (04-08) attaches the result as
 * `package_hash_sha256` alongside the package.
 */
export async function computePackageHash(
  pkg: AuditPackage,
  digestFn: (canonicalJson: string) => Promise<string>,
): Promise<string> {
  return digestFn(canonicalize(pkg));
}

/**
 * DSGN-01/D-04 two-hash model for direct-sign contracts. Extends the
 * flow-form AuditPackage with two INDEPENDENT fields, never derived from
 * each other or from documentHashSha256:
 *
 * - `documentHashSha256` (inherited): the ORIGINAL cached PDF template's
 *   bytes, hashed BEFORE any PDF library (@cantoo/pdf-lib) ever loads it —
 *   the "signed unchanged" half of the chain of custody.
 * - `signatureArtifactHashSha256`: the SEPARATE signature-stroke artifact
 *   (the same signature PNG the audit trail already references via
 *   signature_attachment_id, D-09/CR-04) — proves what was captured at
 *   signing without ever touching the original document's bytes.
 * - `originalTemplateSha256`: the template row's OWN sha256 (the value the
 *   prefetch integrity check verifies the cached bytes against,
 *   prefetchDirectSignPdf.ts) — the operator-published template's identity,
 *   independent of what got cached/downloaded on THIS device.
 *
 * - `renderedArtifactSha256` (OPTIONAL): the finished document — template plus
 *   the stamped answers plus the signature — as the DEVICE rendered it, hashed
 *   on the device. This is the one hash that answers "what did the customer
 *   actually put their name under".
 *
 *   Until it existed, the chain recorded the hash of the EMPTY template and the
 *   answers separately, and the filled document was produced afterwards on the
 *   server. That is a Blankounterschrift: the customer signs, the other party
 *   completes the document. The three fields above are a good record of the
 *   INPUTS; this one is a record of the RESULT, and it is the difference
 *   between "we can reconstruct what he agreed to" and "here is the page he
 *   signed".
 *
 *   Optional on purpose: a contract signed by an older build carries no such
 *   hash, and a missing field must read as "not recorded", never as a mismatch.
 *
 * "Signed unchanged" must never collapse into "embedded": these fields are set
 * from independently-sourced inputs, never one post-render/re-serialized hash
 * standing in for the others. `renderedArtifactSha256` is ADDED to that set,
 * never a substitute for any of them — it is by definition a post-render hash,
 * which is exactly why it cannot stand in for `documentHashSha256`.
 */
export interface DirectSignAuditPackage extends AuditPackage {
  signatureArtifactHashSha256: string;
  originalTemplateSha256: string;
  renderedArtifactSha256?: string;
}

export type BuildDirectSignAuditPackageInputs = DirectSignAuditPackage;

/**
 * PURE mapping, same style as buildAuditPackage — no I/O, byte-identically
 * reproducible (canonicalize parity) for the same inputs.
 */
export function buildDirectSignAuditPackage(
  inputs: BuildDirectSignAuditPackageInputs,
): DirectSignAuditPackage {
  return {
    ...buildAuditPackage(inputs),
    signatureArtifactHashSha256: inputs.signatureArtifactHashSha256,
    originalTemplateSha256: inputs.originalTemplateSha256,
    // Omitted rather than written as undefined when absent: the package is
    // canonicalized and hashed, so a key that is sometimes present with an
    // undefined value would change the digest depending on the serializer.
    ...(inputs.renderedArtifactSha256 !== undefined
      ? { renderedArtifactSha256: inputs.renderedArtifactSha256 }
      : {}),
  };
}
