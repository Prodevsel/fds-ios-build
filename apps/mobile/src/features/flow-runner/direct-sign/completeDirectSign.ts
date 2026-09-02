import {
  type SignatureAttachmentQueue,
  saveSignaturePng,
} from '../../../lib/db/attachments/signatureAttachments';
import {
  type DirectSignAuditPackage,
  buildDirectSignAuditPackage,
  computePackageHash,
} from '../audit/buildAuditPackage';
import { type ContractsRepo, generateDealReference } from '../db/contractsRepo';
import type { ConfirmedGateEntry } from './directSignGate';
import { hashPdfBytes } from './hashPdfBytes';
import { type FieldOverlay, renderDirectSignPdf } from './renderDirectSignPdf';

/**
 * DSGN-03: offline direct-sign completion — reuses the Phase-4
 * completeSigning (FlowRunnerScreen.tsx) sequencing VERBATIM (derive deal
 * reference -> hash -> assemble audit package -> hash package -> queue
 * attachment -> insert append-only contract), with exactly the two additions
 * the plan calls for: a SECOND, INDEPENDENT hash for the signature artifact
 * (D-04 two-hash model — documentHashSha256 is the ORIGINAL cached PDF's
 * bytes, signatureArtifactHashSha256 is the SEPARATE signature PNG, never
 * derived from one another) and `direct_sign_template_id` on the inserted
 * row.
 *
 * Pure/DI'd (StatusSheet.tsx/completeSigning convention) — no component
 * mount, and NO NETWORK DEPENDENCY anywhere in this function (Pitfall 5):
 * `attachmentQueue.saveFile` writes to the app-sandboxed local storage
 * adapter only (upload happens later, out-of-band, via the PowerSync CRUD
 * queue in connector.ts — never awaited here), and
 * `contractsRepo.insertContract` is a local SQLite write only. The success
 * state this function produces must never depend on a round-trip.
 */

export interface CompleteDirectSignDeps {
  contractsRepo: Pick<ContractsRepo, 'insertContract'>;
  /** Signature-PNG attachment queue (createSignatureAttachmentQueue) — the SAME sandboxed queue Phase 4 uses, never a raw storage call. */
  attachmentQueue: SignatureAttachmentQueue;
  /**
   * Renders the finished document ON THE DEVICE — template + stamped answers +
   * signature. Injectable so the completion path stays testable without
   * pdf-lib. Defaults to the real renderer.
   */
  renderArtifact?: typeof renderDirectSignPdf;
  /** Hashes raw bytes — defaults to the real hashPdfBytes (expo-crypto digest), injectable for tests. */
  hashBytes?: (bytes: Uint8Array) => Promise<string>;
  /** Hashes a canonicalized JSON string — the SAME digestFn the rest of the audit pipeline uses (D-26 single hashing path). */
  digestFn: (data: string) => Promise<string>;
  generateUuid: () => string;
  now: () => Date;
}

export interface CompleteDirectSignParams {
  companyId: string;
  repId: string;
  teamId: string;
  productDefinitionId: string;
  productVersion: number;
  directSignTemplateId: string;
  /** The prefetched, integrity-verified ORIGINAL PDF's raw bytes (prefetchDirectSignPdf.ts) — hashed as documentHashSha256, NEVER a post-render value. */
  originalPdfBytes: Uint8Array;
  /** The template row's OWN sha256 (mirrored down via sync) — the operator-published template's identity, independent of what got cached on THIS device. */
  originalTemplateSha256: string;
  /** Bare base64 (no `data:` prefix) signature PNG — queued via the attachment queue AND hashed independently as signatureArtifactHashSha256. */
  signaturePngBase64: string;
  signatureStrokeData: unknown[];
  /**
   * Where the signature and the answers go on the page, straight from the
   * template row and the placements the operator set. Both already reach the
   * device through directSignTemplatesRepo; they simply never reached here,
   * because rendering was server-only.
   *
   * OPTIONAL, and its absence is meaningful rather than an error: a template
   * with no signature anchor cannot be rendered on the device, so
   * `renderedArtifactSha256` is left unrecorded and the flow completes exactly
   * as it did before. A contract must never fail to come into being because a
   * hash could not be computed.
   */
  signatureAnchor?: { page: number; xFrac: number; yFrac: number } | null;
  /** Resolved stamps — the same list the Edge Function builds from placements + answers. */
  fieldOverlays?: readonly FieldOverlay[];
  confirmedGates: ConfirmedGateEntry[];
  deviceId: string;
  deviceIdSource: 'idfv' | 'androidId' | 'fallback-uuid';
  gps: { lat: number; lng: number; accuracyM: number } | null;
  /**
   * CR-02-style deterministic id: when the caller derives it deterministically
   * (e.g. from a stable per-signing key), a retry after a transient failure
   * re-targets the SAME row via contractsRepo's `INSERT OR IGNORE` instead of
   * inserting a second, distinct contract. Falls back to a random uuid
   * (contractsRepo default) if omitted.
   */
  id?: string;
  dealReference?: string;
  /** 0084 (§5.2): the lead whose offer code opened this signing, if any. */
  redeemedLeadId?: string | null;
  /** 0101: the door the flow ran on — the PARTY's id in a multi-party building. */
  houseId?: string | null;
  /**
   * 0085: the customer's answers to the product's question blocks, frozen
   * onto the contract exactly like the wizard path does. Defaults to {} so
   * a product without questions behaves as before.
   */
  answers?: Record<string, unknown>;
  /**
   * WR-02 (Phase 10 review): a stable per-signing-attempt attachment id,
   * paired with `id` above — when supplied, `saveSignaturePng` reuses this
   * SAME id on every retry instead of generating a fresh one, so a retried
   * completion overwrites the same local attachment record rather than
   * leaving a new orphaned attachment behind each time. Falls back to a
   * fresh queue-generated id (previous behavior) when omitted.
   */
  signatureAttachmentId?: string;
}

export interface CompleteDirectSignResult {
  id: string;
  dealReference: string;
  /**
   * The signed document as the device rendered it. Undefined when the device
   * could not render — no signature anchor on the template, or a render
   * failure, both of which leave the contract intact and simply produce no
   * preview.
   *
   * Deliberately handed back rather than written to disk in here:
   * completeDirectSign is the offline legal-write path and stays free of file
   * I/O beyond the attachment queue it already owns. Where the bytes are put
   * is the caller's decision.
   */
  renderedArtifactBytes?: Uint8Array;
  /** The hash of those bytes, the same value frozen into the audit package. */
  renderedArtifactSha256?: string;
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Decodes a bare base64 string into raw bytes — a pure, dependency-free
 * implementation (no `atob`/`Buffer`, neither of which is guaranteed present
 * in the Hermes/RN runtime or this repo's Node test environment), so hashing
 * the signature PNG never depends on a platform-specific global.
 */
export function base64ToBytes(base64: string): Uint8Array {
  const cleaned = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i += 4) {
    // Explicit `i + n < cleaned.length` presence checks — BASE64_ALPHABET's
    // indexOf('') returns 0 (a valid 'A' index), so a naive `?? ''` fallback
    // for a genuinely-absent trailing char would silently decode as 'A'
    // instead of "no char here", corrupting the final group's byte count.
    const char0 = cleaned[i];
    const char1 = i + 1 < cleaned.length ? cleaned[i + 1] : undefined;
    const char2 = i + 2 < cleaned.length ? cleaned[i + 2] : undefined;
    const char3 = i + 3 < cleaned.length ? cleaned[i + 3] : undefined;
    const c0 = char0 !== undefined ? BASE64_ALPHABET.indexOf(char0) : 0;
    const c1 = char1 !== undefined ? BASE64_ALPHABET.indexOf(char1) : 0;
    const c2 = char2 !== undefined ? BASE64_ALPHABET.indexOf(char2) : 0;
    const c3 = char3 !== undefined ? BASE64_ALPHABET.indexOf(char3) : 0;
    const triple = ((c0 & 63) << 18) | ((c1 & 63) << 12) | ((c2 & 63) << 6) | (c3 & 63);
    bytes.push((triple >> 16) & 255);
    if (char2 !== undefined) bytes.push((triple >> 8) & 255);
    if (char3 !== undefined) bytes.push(triple & 255);
  }
  return new Uint8Array(bytes);
}

export async function completeDirectSign(
  deps: CompleteDirectSignDeps,
  params: CompleteDirectSignParams,
): Promise<CompleteDirectSignResult> {
  const {
    contractsRepo,
    attachmentQueue,
    hashBytes = hashPdfBytes,
    renderArtifact = renderDirectSignPdf,
    digestFn,
    generateUuid,
    now,
  } = deps;

  const signedAtIso = now().toISOString();
  const dealReference = params.dealReference ?? generateDealReference(now(), generateUuid());
  const signaturePngBytes = base64ToBytes(params.signaturePngBase64);

  // Independent inputs, computed in parallel — none derived from another
  // (D-04 two-hash model: "signed unchanged" must never collapse into
  // "embedded"). Attachment save is local-only (sandboxed queue), same as
  // the other two — no network dependency anywhere in this Promise.all.
  const [documentHashSha256, signatureArtifactHashSha256, signatureAttachmentId] =
    await Promise.all([
      hashBytes(params.originalPdfBytes),
      hashBytes(signaturePngBytes),
      saveSignaturePng(attachmentQueue, params.signaturePngBase64, params.signatureAttachmentId),
    ]);

  /**
   * The hash of the document as the customer actually saw and signed it.
   *
   * Rendered right here rather than trusted from the server later: the whole
   * point is that this hash covers the FINISHED page, not the empty template.
   * The device and Edge renderers are byte-identical (proven in
   * renderDirectSignPdf.drift.test.ts), so the server's own artifact must hash
   * to this same value — which turns the number into a checksum on the
   * server's work instead of a second copy of the document.
   *
   * Never allowed to break the signing. A render failure at a customer's door,
   * offline, on the terminal legal step, must not cost the contract: the hash
   * is simply not recorded, and the audit package omits the key entirely. That
   * is a WEAKER record, not a broken one, and it degrades exactly as an older
   * build's contract does.
   */
  let renderedArtifactSha256: string | undefined;
  let renderedArtifactBytes: Uint8Array | undefined;
  if (params.signatureAnchor) {
    try {
      const rendered = await renderArtifact(
        params.originalPdfBytes,
        {
          pngBytes: signaturePngBytes,
          page: params.signatureAnchor.page,
          xFrac: params.signatureAnchor.xFrac,
          yFrac: params.signatureAnchor.yFrac,
        },
        params.fieldOverlays ?? [],
      );
      renderedArtifactSha256 = await hashBytes(rendered);
      // Handed back so the success screen can SHOW the signed document instead
      // of only asserting that it exists. The rep can check it in front of the
      // customer, and the customer leaves having seen the page — the same
      // reason the pre-signature preview exists, at the other end of the flow.
      renderedArtifactBytes = rendered;
    } catch (err) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[DETAIL-TRACE] on-device artifact render failed, hash omitted:', err);
      }
    }
  }

  const auditPackage: DirectSignAuditPackage = buildDirectSignAuditPackage({
    documentHashSha256,
    signedAtIso,
    // D-04 GPS-never-blocks-signing precedent applied here too: a JWT-iat
    // server-time anchor is opportunistic elsewhere (FlowRunnerScreen) but
    // resolving it would add a session round-trip this fully-offline path
    // does not depend on — never required to complete a direct-sign contract.
    serverTimeAnchor: null,
    deviceId: params.deviceId,
    deviceIdSource: params.deviceIdSource,
    gps: params.gps,
    confirmedGates: params.confirmedGates,
    signatureStrokeData: params.signatureStrokeData,
    productVersion: params.productVersion,
    dealReference,
    signatureArtifactHashSha256,
    originalTemplateSha256: params.originalTemplateSha256,
    renderedArtifactSha256,
  });

  const packageHashSha256 = await computePackageHash(auditPackage, digestFn);

  const insertResult = await contractsRepo.insertContract({
    id: params.id,
    companyId: params.companyId,
    repId: params.repId,
    teamId: params.teamId,
    productDefinitionId: params.productDefinitionId,
    productVersion: params.productVersion,
    // A direct_pdf product carries no discount/terms block (D-04) — same
    // empty-snapshot convention FlowRunnerScreen.EMPTY_SNAPSHOT documents for
    // a flow that never reaches one.
    termsId: '',
    termsVersion: 0,
    answers: params.answers ?? {},
    // doorPrice is NULL, not 0. This path captures no price (a direct_pdf
    // product has no discount block, D-04) and 0 is a claim, not an absence:
    // it printed "0,00 EUR" in Meine Abschluesse and fed a commission base of
    // zero. 0098_offer_portal.sql:420 already states the rule for this column.
    // Existing rows keep their 0 — contracts is append-only (0004) — which is
    // why the read side translates the sentinel as well.
    snapshot: { doorPrice: null, comparisonPrice: null, discountAmount: null, termsText: '' },
    // DirectSignAuditPackage is a closed, precisely-typed shape
    // (buildAuditPackage.ts); contractsRepo's jsonb-column input is
    // intentionally the wider Record<string, unknown> (it also mirrors other
    // jsonb columns) — safe structural cast, no data is added/dropped.
    auditPackage: auditPackage as unknown as Record<string, unknown>,
    packageHashSha256,
    signatureAttachmentId,
    signedAtIso,
    dealReference,
    directSignTemplateId: params.directSignTemplateId,
    redeemedLeadId: params.redeemedLeadId ?? null,
    houseId: params.houseId ?? null,
  });

  return {
    id: insertResult.id,
    dealReference: insertResult.dealReference,
    // Undefined when the device could not render (no anchor, or a render
    // failure). The caller shows no preview then, exactly as before.
    renderedArtifactBytes,
    renderedArtifactSha256,
  };
}
