import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { AbstractPowerSyncDatabase } from '@powersync/common';
import { DEFAULT_OFFER_CONSENT_BLOCK, type Block, type ConsentBlock } from '@frontdoorsales/flow-schema';
import * as Crypto from 'expo-crypto';
import { radius, spacing, typography } from '../../design/tokens';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { t } from '../../i18n';
import { getSupabase } from '../../lib/auth/supabase';
import { getDeviceIdDefault, type DeviceIdResult } from '../../lib/device/getDeviceId';
import {
  getSignatureLocationDefault,
  type SignatureLocationResult,
} from '../../lib/location/getSignatureLocation';
import {
  createSignatureAttachmentQueue,
  type SignatureAttachmentQueue,
} from '../../lib/db/attachments/signatureAttachments';
import { hashCanonical } from './audit/canonicalize';
import { buildAuditPackage, computePackageHash } from './audit/buildAuditPackage';
import {
  createContractsRepo,
  generateDealReference,
  parseIdentityAnswerName,
  type ContractsRepo,
} from './db/contractsRepo';
import { createFlowDraftsRepo, type CompletionSnapshot } from './db/flowDraftsRepo';
import { createProductDefinitionsRepo } from './db/productDefinitionsRepo';
import { SuccessScreen } from '../checkout/SuccessScreen';
import { useContractSyncPending } from '../checkout/useContractSyncPending';
import { EndAsLeadSheet } from './EndAsLeadSheet';
import {
  completeDraft,
  startOrResumeDraft,
  type FlowDraftRepo as FlowDraftCoreRepo,
  type ProductDefinitionsSource,
  type StartOrResumeDraftResult,
} from './useFlowDraft';
import { deriveShowIfState, useShowIf } from './useShowIf';
import { canJumpTo, firstUnconfirmedGateIndex } from './StepOverview';
import { buildReviewRows } from './reviewRows';
import { buildFlowOfferSnapshot } from './offerSnapshot';
import { ReviewScreen } from './ReviewScreen';
import { TextBlock } from './blocks/TextBlock';
import { ChoiceBlock } from './blocks/ChoiceBlock';
import { ContactBlock } from './blocks/ContactBlock';
import { SliderBlock } from './blocks/SliderBlock';
import { DiscountBlock } from './blocks/DiscountBlock';
import { IbanScanBlock } from './blocks/IbanScanBlock';
import { IdScanBlock } from './blocks/IdScanBlock';
import { BelehrungBlock } from './blocks/BelehrungBlock';
import { SignatureBlock, type SignatureCapturePayload } from './blocks/SignatureBlock';
import { RecommendationBlock } from './blocks/RecommendationBlock';

/**
 * D-01/D-02/D-04/D-19 wizard shell: one block per screen, Next/Back footer,
 * a tappable StepOverview, auto-save-on-every-answer, and a frozen discount
 * snapshot forwarded (never recomputed) at completion. Business logic
 * (start/resume, advance, back, jump, complete) is a set of pure, exported,
 * DI'd async/sync functions (StatusSheet.tsx pattern) — testable without
 * mounting the component (no react-test-renderer in this repo).
 */

/** Structural slice of FlowDraftsRepo the pure orchestration logic below depends on (injectable for tests). */
export type FlowRunnerRepo = FlowDraftCoreRepo;

export interface StartFlowParams {
  repo: FlowRunnerRepo;
  productDefinitionsRepo: ProductDefinitionsSource;
  houseId: string;
  slug: string;
  createdBy: string;
  territoryId?: string | null;
  /** D-10: a tester's explicit choice of a Draft version for a NEW flow. */
  draftVersion?: number;
}

/**
 * D-04/D-09/D-10/D-11: resumes an existing in_progress draft for the house
 * (re-reading its EXACT pinned version, never the latest — the notice text
 * stays pinned, legally required), or starts a fresh one against the latest
 * published version (or a tester's explicit Draft version, flagged
 * `is_test`). Delegates to useFlowDraft.ts's `startOrResumeDraft` — the SSOT
 * for this version-selection/tester-flag logic (extending it here again
 * would duplicate a non-trivial, safety-relevant rule; unlike the
 * lightweight 03-05 resume-or-create split, D-09/D-10/D-11 are worth
 * sharing, not re-deriving).
 */
export async function startFlow(params: StartFlowParams): Promise<StartOrResumeDraftResult> {
  return startOrResumeDraft(params);
}

export interface AnswerAndAdvanceParams {
  repo: FlowRunnerRepo;
  draftId: string;
  fieldId: string;
  value: unknown;
  currentIndex: number;
  lastIndex: number;
}

/** D-04: every answer auto-saves IMMEDIATELY, then the wizard advances one block (never past the last visible one). */
export async function answerAndAdvance(params: AnswerAndAdvanceParams): Promise<number> {
  const { repo, draftId, fieldId, value, currentIndex, lastIndex } = params;
  await repo.saveAnswer(draftId, fieldId, value);
  return Math.min(currentIndex + 1, lastIndex);
}

/** No answer to save when going back — just moves the cursor. */
export function goToPreviousBlock(currentIndex: number): number {
  return Math.max(currentIndex - 1, 0);
}

/** StepOverview taps jump directly to any already-reached block, never beyond it (see StepOverview.canJumpTo). */
export function jumpToBlock(targetIndex: number, maxReachedIndex: number): number {
  return Math.max(0, Math.min(targetIndex, maxReachedIndex));
}

/**
 * SIGN-01 (04-RESEARCH.md Pattern 1 caveat): StepOverview.canJumpTo already
 * blocks a forward JUMP at/past the first unconfirmed gate — but nothing
 * previously stopped the LINEAR forward-advance path (answerAndAdvance's
 * `currentIndex + 1`) from crossing the same boundary. answerAndAdvance
 * itself has no gate/answers knowledge (by design — it only auto-saves +
 * clamps to the visible-list bound), so this is a defect: an unconfirmed gate
 * block that is somehow answered non-true (e.g. a future block variant, or a
 * caller invoking onAnswer directly) would still let the cursor move one
 * step forward. Root-cause fix: clamp the proposed next index the SAME way
 * canJumpTo does — never past the first unconfirmed gate in the
 * (already-updated) visible/answers pair — applied at the FlowRunnerScreen
 * call site right after answerAndAdvance resolves.
 */
export function clampToUnconfirmedGate(
  proposedNextIndex: number,
  visibleBlocksAfterAnswer: Block[],
  answersAfterAnswer: Record<string, unknown>,
): number {
  const gateIndex = firstUnconfirmedGateIndex(visibleBlocksAfterAnswer, answersAfterAnswer);
  if (gateIndex === -1) return proposedNextIndex;
  return Math.min(proposedNextIndex, gateIndex);
}

export interface CompleteFlowParams {
  repo: FlowRunnerRepo;
  draftId: string;
  snapshot: CompletionSnapshot;
}

/** Forwards the ALREADY-frozen discount snapshot (D-19/Pitfall 4) — never recomputed here. */
export async function completeFlow(params: CompleteFlowParams): Promise<void> {
  await completeDraft(params);
}

export interface CaptureSnapshotParams {
  repo: FlowRunnerRepo;
  draftId: string;
  captured: CompletionSnapshot;
}

/**
 * Gap 2B (03-UAT.md Test 5): the frozen discount snapshot previously lived
 * ONLY in this screen's transient useState, lost on any remount/app-restart
 * between capture and completion. This pure, DI'd wrapper (mirrors
 * answerAndAdvance/completeFlow above) persists the snapshot the MOMENT the
 * discount block freezes it (D-04 auto-save-on-capture pattern) — never
 * recomputed, just forwarded to repo.saveSnapshot exactly as captured.
 */
export async function captureSnapshot(params: CaptureSnapshotParams): Promise<void> {
  await params.repo.saveSnapshot(params.draftId, params.captured);
}

export interface DeriveSignatureSummaryParams {
  answers: Record<string, unknown>;
  blocks: Block[];
  snapshot: CompletionSnapshot;
  productSlug: string;
}

export interface SignatureSummary {
  customerName: string;
  productName: string;
  price: number;
}

/**
 * D-16: assembles the signature handover summary strip (customer/product/
 * price) purely from already-known flow state — never a new fetch. Customer
 * name comes from the flow's id-scan block answer (the designated identity
 * text answer, RESEARCH.md/UI-SPEC.md); product_definitions has no separate
 * display-name column (schema.ts) — productSlug IS the product name. Price
 * is the already-frozen discount snapshot's doorPrice (D-19, never
 * recomputed here).
 */
export function deriveSignatureSummary(params: DeriveSignatureSummaryParams): SignatureSummary {
  const { answers, blocks, snapshot, productSlug } = params;
  const identityBlock = blocks.find((block) => block.type === 'id-scan');
  const customerNameAnswer = identityBlock ? answers[identityBlock.id] : undefined;
  return {
    // CR-01: the id-scan answer is a JSON-serialized structured object
    // (serializeIdFields), never a plain name — parseIdentityAnswerName
    // (shared with contractsRepo.parseCustomerName) extracts the display
    // name instead of passing the raw JSON string through verbatim.
    customerName: parseIdentityAnswerName(customerNameAnswer),
    productName: productSlug,
    price: snapshot.doorPrice,
  };
}

/**
 * QUICK-GTI (Befund 2): the customer name a `contact` block with
 * `field: 'name'` captured, for `contracts.customer_name`.
 *
 * Why a BLOCK lookup and not a scan of the answers map: a contact-name answer
 * is a plain string, indistinguishable at the value level from a free-text
 * note or an address line. `deriveContractCustomerName` deliberately refuses
 * to treat a bare string as a name for exactly that reason, so the block
 * definition is the only thing that can identify one. Same shape as
 * `deriveSignatureSummary`'s id-scan lookup above.
 *
 * Returns null when no such block exists or its answer is blank — products
 * authored via JSON carry an `id-scan` block instead and are covered by
 * `deriveContractCustomerName` alone.
 */
export function deriveContactNameAnswer(
  blocks: Block[],
  answers: Record<string, unknown>,
): string | null {
  const nameBlock = blocks.find(
    (block) => block.type === 'contact' && (block as { field?: string }).field === 'name',
  );
  if (!nameBlock) return null;
  const value = answers[nameBlock.id];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * D-17: confirmedGates entries require a per-notice hash of the EXACT
 * confirmed belehrung noticeText string — collected here from the blocks
 * list (never re-derived from the schema again at hash time, the block's
 * own noticeText is the SSOT for what was actually shown/confirmed).
 * Any confirmed ('true'-answered) belehrung block is included, a superset
 * of the 0030 trigger's gate:true requirement (harmless — extra confirmed
 * entries never fail that check, only a MISSING required one does).
 */
export interface ConfirmedGateBlockInput {
  blockId: string;
  noticeText: string;
}

export function collectConfirmedGateBlocks(
  blocks: Block[],
  answers: Record<string, unknown>,
): ConfirmedGateBlockInput[] {
  return blocks
    .filter((block) => block.type === 'belehrung' && answers[block.id] === true)
    .map((block) => ({ blockId: block.id, noticeText: (block as { noticeText: string }).noticeText }));
}

export interface ServerTimeAnchor {
  iat: number;
  source: 'supabase-jwt';
}

/**
 * T-04-09/D-20: extracts ONLY the `iat` claim from a Supabase Auth JWT's
 * payload segment — the raw token itself is never returned/stored anywhere
 * downstream of this function. Never throws: a malformed/missing token
 * degrades to `null` (mirrors getDeviceId/getSignatureLocation's
 * never-block-signing posture).
 */
export function decodeJwtIatClaim(accessToken: string): number | null {
  try {
    const payloadSegment = accessToken.split('.')[1];
    if (!payloadSegment) return null;
    const padded = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const base64 = padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '=');
    const json =
      typeof atob === 'function'
        ? atob(base64)
        : Buffer.from(base64, 'base64').toString('utf-8');
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && typeof (parsed as Record<string, unknown>).iat === 'number') {
      return (parsed as Record<string, unknown>).iat as number;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * D-20: reads the current session's access-token `iat` claim ONLY — the raw
 * token is never stored (T-04-09). Never throws — a missing session or
 * decode failure degrades to a null anchor rather than blocking the
 * signature (D-04 GPS-never-blocks-signing posture, mirrored here).
 */
export async function getServerTimeAnchorFromSession(
  getSession: () => Promise<{ data: { session: { access_token: string } | null } }>,
): Promise<ServerTimeAnchor | null> {
  try {
    const { data } = await getSession();
    if (!data.session) return null;
    const iat = decodeJwtIatClaim(data.session.access_token);
    return iat !== null ? { iat, source: 'supabase-jwt' } : null;
  } catch {
    return null;
  }
}

export interface CompleteSigningDeps {
  repo: FlowRunnerRepo;
  contractsRepo: Pick<ContractsRepo, 'insertContract'>;
  getDeviceId: () => Promise<DeviceIdResult>;
  getSignatureLocation: () => Promise<SignatureLocationResult>;
  getServerTimeAnchor: () => Promise<ServerTimeAnchor | null>;
  digestFn: (data: string) => Promise<string>;
  generateUuid: () => string;
  now: () => Date;
}

export interface CompleteSigningParams {
  draftId: string;
  companyId: string;
  repId: string;
  teamId: string;
  productDefinitionId: string;
  productVersion: number;
  answers: Record<string, unknown>;
  blocks: Block[];
  snapshot: CompletionSnapshot;
  signatureCapture: SignatureCapturePayload;
  /**
   * 0084 (§5.2): the lead whose offer code opened this consultation, if the
   * rep redeemed one. Stamped onto the contract — the only record that the
   * offer was used (`leads` is insert-only).
   */
  redeemedLeadId?: string | null;
  /** 0101: the door the flow ran on — the PARTY's id in a multi-party building. */
  houseId?: string | null;
}

export interface CompleteSigningResult {
  dealReference: string;
  /**
   * The DETERMINISTIC contract row id (deriveContractId). Returned so the
   * caller can ask the local upload queue whether THIS contract has left the
   * device yet, instead of assuming it has not (useContractSyncPending).
   */
  contractId: string;
}

/**
 * CR-02: derives a DETERMINISTIC contract id from the flow draft id (via the
 * same digestFn injected into completeSigning — no extra I/O) — pure,
 * testable. Feeding this into contractsRepo.insertContract's `INSERT OR
 * IGNORE` makes a retried completeSigning call for the same draft re-target
 * the SAME row instead of inserting a second, distinct contract: exactly the
 * idempotency guarantee CR-02 requires, without a schema/migration change
 * (the `contracts.id` primary key alone is the idempotency key).
 */
export async function deriveContractId(
  draftId: string,
  digestFn: (data: string) => Promise<string>,
): Promise<string> {
  const digest = await digestFn(`contract:${draftId}`);
  const hex = digest
    .replace(/[^0-9a-f]/gi, '')
    .toLowerCase()
    .padEnd(32, '0')
    .slice(0, 32);
  const variantChar = '89ab'[parseInt(hex[16] ?? '0', 16) % 4];
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variantChar}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

/**
 * SIGN-03/D-10/D-12/CR-02: the full offline completion sequence — (1)
 * derives the deterministic per-draft contract id, (2) computes the document
 * hash over the frozen contract snapshot, (3) collects confirmedGates with a
 * per-notice hash (D-17), (4) resolves device id / GPS (both non-throwing,
 * never block signing) and the JWT-iat server-time anchor, (5) assembles +
 * hashes the SIGN-03 audit package, (6) inserts the frozen append-only
 * contract, and ONLY THEN (7) marks the draft completed.
 *
 * CR-02: the draft is deliberately marked `completed` LAST, after the
 * contract insert is guaranteed to have run — reordered from the previous
 * "mark completed first" sequence. If anything before step (6) throws, the
 * draft stays `in_progress` and is fully resumable (getDraftForHouse). If
 * step (6) itself throws, nothing is marked completed either — same
 * resumable state. A subsequent retry re-derives the SAME contract id
 * (step 1) so contractsRepo's `INSERT OR IGNORE` makes step (6) a no-op
 * instead of inserting a second contract, then step (7) runs to completion.
 * Pure/DI'd (repo/contractsRepo/device/location/time-anchor/digest/uuid/now
 * are all injected) so this is testable without mounting the component
 * (StatusSheet.tsx pattern).
 */
export async function completeSigning(
  deps: CompleteSigningDeps,
  params: CompleteSigningParams,
): Promise<CompleteSigningResult> {
  const { repo, contractsRepo, getDeviceId, getSignatureLocation, getServerTimeAnchor, digestFn, generateUuid, now } =
    deps;
  const {
    draftId,
    companyId,
    repId,
    teamId,
    productDefinitionId,
    productVersion,
    answers,
    blocks,
    snapshot,
    signatureCapture,
  } = params;

  const contractId = await deriveContractId(draftId, digestFn);

  const signedAtIso = now().toISOString();
  const dealReference = generateDealReference(now(), generateUuid());

  const contractSnapshot = {
    answers,
    productDefinitionId,
    productVersion,
    termsId: snapshot.termsId,
    termsVersion: snapshot.termsVersion,
    snapshot,
  };
  const documentHashSha256 = await hashCanonical(contractSnapshot, digestFn);

  const confirmedGateBlocks = collectConfirmedGateBlocks(blocks, answers);
  const confirmedGates = await Promise.all(
    confirmedGateBlocks.map(async (gate) => ({
      blockId: gate.blockId,
      confirmedAtIso: signedAtIso,
      noticeTextSha256: await digestFn(gate.noticeText),
    })),
  );

  const [deviceResult, locationResult, serverTimeAnchor] = await Promise.all([
    getDeviceId(),
    getSignatureLocation(),
    getServerTimeAnchor(),
  ]);

  const auditPackage = buildAuditPackage({
    documentHashSha256,
    signedAtIso,
    serverTimeAnchor,
    deviceId: deviceResult.deviceId,
    deviceIdSource: deviceResult.deviceIdSource,
    gps: locationResult.gps,
    confirmedGates,
    signatureStrokeData: signatureCapture.strokeData,
    productVersion,
    dealReference,
  });

  const packageHashSha256 = await computePackageHash(auditPackage, digestFn);

  const insertResult = await contractsRepo.insertContract({
    id: contractId,
    companyId,
    repId,
    teamId,
    productDefinitionId,
    productVersion,
    termsId: snapshot.termsId,
    termsVersion: snapshot.termsVersion,
    answers,
    snapshot: {
      doorPrice: snapshot.doorPrice,
      comparisonPrice: snapshot.comparisonPrice,
      discountAmount: snapshot.discountAmount,
      termsText: snapshot.termsText,
    },
    // AuditPackage is a closed, precisely-typed shape (buildAuditPackage.ts);
    // contractsRepo's jsonb-column input is intentionally the wider
    // Record<string, unknown> (it also mirrors other jsonb columns) — safe
    // structural cast, no data is added/dropped.
    auditPackage: auditPackage as unknown as Record<string, unknown>,
    packageHashSha256,
    // QUICK-GTI: `contracts` is append-only (0004), so the customer name is
    // present in THIS insert or it is lost for this deal forever. A
    // contact(name) block wins where a product has one; otherwise
    // insertContract falls back to deriving it from the id-scan answer.
    customerName: deriveContactNameAnswer(blocks, answers),
    signatureAttachmentId: signatureCapture.signatureAttachmentId,
    signedAtIso,
    dealReference,
    redeemedLeadId: params.redeemedLeadId ?? null,
    houseId: params.houseId ?? null,
  });

  // CR-02: only mark the draft completed AFTER the contract row is
  // guaranteed to be persisted (see the function doc above for the full
  // resumability/idempotency argument).
  await completeFlow({ repo, draftId, snapshot });

  return { dealReference: insertResult.dealReference, contractId };
}

export interface FlowRunnerScreenProps {
  db: AbstractPowerSyncDatabase;
  /** D-09: the product slug drives internal version selection/pinning — blocks are no longer a caller-resolved prop. */
  productSlug: string;
  houseId: string;
  createdBy: string;
  /** D-12/CHKT-04: threaded from StatusSheet for the contract insert + telemetry-context resolution parity. */
  teamId: string;
  territoryId?: string | null;
  /** D-10: a tester's explicit choice of a Draft version for a NEW flow. */
  draftVersion?: number;
  onExit: () => void;
  /**
   * Fires once the contract row is persisted, so the caller can move the house
   * (or the PARTY — see StatusSheet) to 'success'. Optional because the flow
   * itself owns no houses repo and must stay usable without one.
   */
  onContractSigned?: () => void;
  /** D-11: optional secondary CTA from the success screen to the "Meine Abschlüsse" list (04-09). */
  onViewContracts?: () => void;
  /**
   * §5.2: set when this consultation was opened by redeeming an offer code.
   * `redeemedLeadId` is stamped onto the resulting contract; the code is shown
   * as a banner so the rep can see which offer is being closed.
   */
  redeemedLeadId?: string | null;
  redeemedOfferCode?: string | null;
}

const EMPTY_SNAPSHOT: CompletionSnapshot = {
  doorPrice: 0,
  comparisonPrice: null,
  discountAmount: null,
  termsText: '',
  // Gap 2A (03-UAT.md): CompletionSnapshot now carries terms attribution.
  // This default is only ever forwarded if a flow completes without ever
  // reaching a discount block; Plan 03-09 wires DiscountBlock's
  // onSnapshotCaptured to replace this placeholder before completion.
  termsId: '',
  termsVersion: 0,
};

export function FlowRunnerScreen({
  db,
  productSlug,
  houseId,
  createdBy,
  teamId,
  territoryId = null,
  draftVersion,
  onExit,
  onContractSigned,
  onViewContracts,
  redeemedLeadId = null,
  redeemedOfferCode = null,
}: FlowRunnerScreenProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const repo = useMemo(() => createFlowDraftsRepo({ db }), [db]);
  const productDefinitionsRepo = useMemo(() => createProductDefinitionsRepo({ db }), [db]);
  const contractsRepo = useMemo(() => createContractsRepo({ db }), [db]);
  // SIGN-02/T-04-17: the signature PNG saves ONLY through this sandbox/
  // signed-URL attachment queue — first real exercise of the Phase-1 queue.
  const signatureQueue = useMemo(
    () => createSignatureAttachmentQueue({ db, supabase: getSupabase() }),
    [db],
  );
  // startSync() creates the local attachments directory (adapter.initialize)
  // and runs the upload loop — without it the first saveFile() dies with
  // "No such file or directory" and PNGs would never reach Supabase Storage.
  useEffect(() => {
    void signatureQueue.startSync().catch(() => {
      // Offline/transient — saveFile still works once initialize ran; the
      // periodic sync retries uploads when connectivity returns.
    });
    return () => {
      void signatureQueue.stopSync().catch(() => {});
    };
  }, [signatureQueue]);

  const [draftId, setDraftId] = useState<string | null>(null);
  // Guards handleComplete against double-taps while the async close runs
  // (ref for same-tick re-entrancy, state for the disabled/busy button UI).
  const completingRef = useRef(false);
  const [completing, setCompleting] = useState(false);
  // CR-02/WR-02: any failure during handleComplete (product lookup, digest,
  // PowerSync/SQLite error, etc.) must be VISIBLE to the rep and retry-safe
  // — never a silent no-op that just stops the spinner.
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [maxReachedIndex, setMaxReachedIndex] = useState(0);
  const [snapshot, setSnapshot] = useState<CompletionSnapshot>(EMPTY_SNAPSHOT);
  // 04-08: the exact product version/definition this draft is pinned against
  // (D-09) — needed at completion time to look up companyId and stamp the
  // frozen contract row's product_definition_id/product_version.
  const [productDefinitionId, setProductDefinitionId] = useState<string | null>(null);
  const [productVersion, setProductVersion] = useState<number | null>(null);
  // Held for the (04-08) audit-package/contract insert — not yet persisted here.
  const [signatureCapture, setSignatureCapture] = useState<SignatureCapturePayload | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // §5.2: the "Angebot" outcome — a consultation that ends WITHOUT a signature
  // but with a mailed offer and a redemption code, so the customer is never
  // pushed into signing at the door. Reachable from every step.
  const [showOffer, setShowOffer] = useState(false);
  // The lead row is company-scoped (MAND-01); company_id lives on the pinned
  // product version, the same source handleComplete reads it from.
  const [companyId, setCompanyId] = useState<string | null>(null);
  // A scan block in its camera sub-state is an ACTION, not a step (design
  // screens 05/06): while it is up, the whole step chrome (counter, progress
  // bar, StepOverview, Back/Complete footer) is hidden and the camera owns the
  // full screen with its own X-cancel. The block reports this via
  // onImmersiveChange; it drops back to false the moment it hits its confirm/
  // manual input sub-state — which IS a normal step (screen 06, has Back).
  const [immersive, setImmersive] = useState(false);
  // The pre-signature "Angaben prüfen" step. Modelled as a flag rather than as
  // an extra entry in `visible` on purpose — see ReviewScreen.tsx's header for
  // why the index space must not move. False means "the review has not been
  // acknowledged for the current arrival at the signature block", so the
  // review pre-empts the signature capture; the effect below resets it the
  // moment the cursor leaves that block, which is what makes a correction
  // round-trip land back on the review instead of straight on the canvas.
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);
  // D-11/D-12: terminal success state — rendered as SuccessScreen instead of
  // onExit()'d immediately once the offline audit package is built and the
  // contract is inserted.
  //
  // `syncPending` is NOT stored here any more. It used to be hardcoded true,
  // justified as "always true right after an offline insert" — true offline,
  // false online, and online is the ordinary case, so the screen lectured the
  // rep about connectivity after every single deal on a device that had
  // already uploaded. It is now derived live from the local upload queue
  // (useContractSyncPending), which is why `contractId` is kept instead.
  const [completion, setCompletion] = useState<{
    dealReference: string;
    contractId: string;
    customerName: string;
    productName: string;
    priceMonthly: number;
  } | null>(null);
  // The honest answer to "has this contract left the device?", from the SAME
  // local CRUD upload queue the sync pill and "Meine Abschlüsse" read (D-22).
  // Called unconditionally (hook rules) — it holds at `true` while
  // `completion` is null, which is the state nothing renders anyway.
  const syncPending = useContractSyncPending(db, completion?.contractId ?? null);

  useEffect(() => {
    let cancelled = false;
    void startFlow({
      repo,
      productDefinitionsRepo,
      houseId,
      slug: productSlug,
      createdBy,
      territoryId,
      draftVersion,
    })
      .then((result) => {
        if (cancelled) return;
        setDraftId(result.draftId);
        setAnswers(result.answers);
        setBlocks(result.blocks);
        setProductDefinitionId(result.productDefinitionId);
        setProductVersion(result.productVersion);
        // Gap 2B (03-UAT.md): re-hydrate the persisted snapshot on resume so
        // handleComplete forwards the real captured values after any
        // remount/app-restart mid-flow, never the EMPTY_SNAPSHOT default.
        setSnapshot(result.snapshot ?? EMPTY_SNAPSHOT);
        setReady(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houseId, productSlug]);

  useEffect(() => {
    if (productVersion === null) return;
    let cancelled = false;
    void productDefinitionsRepo
      .getVersion(productSlug, productVersion)
      .then((product) => {
        if (!cancelled) setCompanyId(product?.company_id ?? null);
      })
      .catch(() => {
        // Without a company the offer outcome stays hidden — the button below
        // is gated on companyId, so this degrades to "no offer", never to a
        // tenant-less lead row.
      });
    return () => {
      cancelled = true;
    };
  }, [productDefinitionsRepo, productSlug, productVersion]);

  // Pitfall 3: this hook is the SINGLE derived visible-blocks-in-order list —
  // rendering, the clamp bound below, and StepOverview's gate guard all read
  // THIS list, never index the raw `blocks` array directly.
  // A consent block is an OUTCOME (the offer/lead sheet presents it), never a
  // wizard step — renderBlock has no case for it, so leaving it in the step
  // list would put an empty screen in the middle of a consultation. Filtered
  // here rather than at load, because EndAsLeadSheet reads it off `blocks`.
  const stepBlocks = useMemo(() => blocks.filter((block) => block.type !== 'consent'), [blocks]);
  const { visible } = useShowIf(stepBlocks, answers);
  const lastIndex = Math.max(0, visible.length - 1);
  const activeBlock = visible[currentIndex];

  const handleAnswer = useCallback(
    async (fieldId: string, value: unknown) => {
      if (!draftId) return;
      // D-13: the just-given answer can itself flip a later block's show-if
      // (e.g. speed-tier gating the discount block) — the clamp bound must
      // reflect the block list AFTER this answer, never the stale one from
      // the render that's about to be superseded. D-15: pruneInvalidatedAnswers
      // drops any answer whose block is no longer visible AFTER this answer —
      // that pruned set is what becomes the new local answers state.
      const updatedAnswers = { ...answers, [fieldId]: value };
      const { visible: visibleAfter, prunedAnswers } = deriveShowIfState(stepBlocks, updatedAnswers);
      const updatedLastIndex = Math.max(0, visibleAfter.length - 1);
      const nextIndex = await answerAndAdvance({
        repo,
        draftId,
        fieldId,
        value,
        currentIndex,
        lastIndex: updatedLastIndex,
      });
      // SIGN-01: never let the LINEAR advance cross an unconfirmed gate,
      // mirroring StepOverview's jump guard (see clampToUnconfirmedGate).
      const gateClampedIndex = clampToUnconfirmedGate(nextIndex, visibleAfter, prunedAnswers);
      setAnswers(prunedAnswers);
      setCurrentIndex(gateClampedIndex);
      setMaxReachedIndex((prev) => Math.max(prev, gateClampedIndex));
    },
    [draftId, repo, currentIndex, answers, stepBlocks],
  );

  const handleBack = useCallback(() => {
    setCurrentIndex((prev) => goToPreviousBlock(prev));
  }, []);

  // The review rows are derived from `visible` (never the raw `blocks` array,
  // Pitfall 3) so every `ReviewRow.index` is directly assignable to
  // `currentIndex` with no re-mapping.
  const reviewRows = useMemo(() => buildReviewRows(visible, answers), [visible, answers]);

  // The gate boundary for the review screen's taps — the SAME value
  // StepOverview computes, from the SAME visible-ordered list.
  const gateIndex = useMemo(() => firstUnconfirmedGateIndex(visible, answers), [visible, answers]);

  /**
   * A review row is jumpable under exactly the rule that already governs every
   * other jump in this screen (StepOverview.canJumpTo): never beyond
   * maxReachedIndex, and never AT OR PAST the first unconfirmed gate. Reusing
   * the predicate rather than reasoning "review jumps are always backwards, so
   * they are always safe" is deliberate: that reasoning is true today only
   * because the review is reached at the signature block with every prior gate
   * already confirmed, and it would stop being true the day the review becomes
   * reachable from anywhere else. The guard costs nothing and cannot rot.
   */
  const isReviewRowJumpable = useCallback(
    (targetIndex: number) => canJumpTo(targetIndex, maxReachedIndex, gateIndex),
    [maxReachedIndex, gateIndex],
  );

  const handleReviewJump = useCallback(
    (targetIndex: number) => {
      if (!canJumpTo(targetIndex, maxReachedIndex, gateIndex)) return;
      // jumpToBlock re-clamps to [0, maxReachedIndex] — belt and braces with
      // canJumpTo above, and the same call the step overview would make.
      setCurrentIndex(jumpToBlock(targetIndex, maxReachedIndex));
      // `reviewAcknowledged` is deliberately NOT set here: the reset effect
      // below clears it as the cursor leaves the signature block, so once the
      // rep has corrected the entry and worked forward again they land on the
      // review a second time and get to re-check it. A correction that skips
      // straight back onto the signature canvas would defeat the point.
    },
    [maxReachedIndex, gateIndex],
  );

  // Leaving the signature block — by a review jump, a Back tap, or a show-if
  // change that shortens the flow — invalidates any earlier acknowledgement.
  const onSignatureStep = activeBlock?.type === 'signature';
  useEffect(() => {
    if (!onSignatureStep) setReviewAcknowledged(false);
  }, [onSignatureStep]);

  const handleSnapshotCaptured = useCallback(
    (captured: CompletionSnapshot) => {
      setSnapshot(captured);
      // Gap 2B (03-UAT.md): persist the frozen snapshot to the draft row THE
      // MOMENT the discount block resolves it (D-04 auto-save-on-capture) —
      // survives a subsequent remount/app-restart, not held only in state.
      if (!draftId) return;
      void captureSnapshot({ repo, draftId, captured });
    },
    [repo, draftId],
  );

  const handleSignatureCaptured = useCallback((captured: SignatureCapturePayload) => {
    // Held in state for 04-08's completion/audit-package wiring — the
    // contract insert (and its signature_attachment_id reference, D-09) is
    // out of scope here.
    setSignatureCapture(captured);
  }, []);

  const handleComplete = useCallback(async () => {
    // Defensive guard — the footer's Complete button only renders on the
    // last visible block, which is always the signature block (SIGN-01,
    // proven in StepOverview.test.tsx/FlowRunnerScreen.test.tsx), so these
    // should always be populated by the time this fires.
    if (!draftId || !signatureCapture || productDefinitionId === null || productVersion === null) {
      return;
    }
    // Re-entrancy lock: completeSigning takes seconds (one-shot GPS fix with
    // timeout + hashing) — without this, every extra tap on "Abschließen"
    // inserted ANOTHER contract (21 rows in one device-pass session).
    if (completingRef.current) {
      return;
    }
    completingRef.current = true;
    setCompleting(true);
    setCompleteError(null);
    try {
      // D-09/D-10: the loaded product row's company_id — never trusted from
      // the client elsewhere, re-read here from the SAME pinned version this
      // draft is running against (productDefinitionsRepo is read-only/
      // server-written, 03-04).
      const product = await productDefinitionsRepo.getVersion(productSlug, productVersion);
      if (!product) {
        // WR-02: an unresolvable product version is an error condition, not
        // a silent no-op — caught below and surfaced to the rep.
        throw new Error('handleComplete: product definition version not found locally');
      }

      const summary = deriveSignatureSummary({ answers, blocks, snapshot, productSlug });
      const { dealReference, contractId } = await completeSigning(
        {
          repo,
          contractsRepo,
          getDeviceId: getDeviceIdDefault,
          getSignatureLocation: getSignatureLocationDefault,
          getServerTimeAnchor: () => getServerTimeAnchorFromSession(() => getSupabase().auth.getSession()),
          digestFn: (data) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, data),
          generateUuid: () => Crypto.randomUUID(),
          now: () => new Date(),
        },
        {
          draftId,
          companyId: product.company_id,
          repId: createdBy,
          teamId,
          productDefinitionId,
          productVersion,
          answers,
          blocks,
          snapshot,
          signatureCapture,
          redeemedLeadId,
          houseId,
        },
      );
      setCompletion({
        dealReference,
        contractId,
        customerName: summary.customerName,
        productName: summary.productName,
        priceMonthly: summary.price,
      });
      // The pin follows the deal. Fired HERE and not from the success screen's
      // exit: the rep may close the flow with the system gesture, and a status
      // that depends on which way someone left the screen is a status nobody
      // can trust. The contract row is already persisted at this point, so the
      // two states cannot diverge in the direction that matters — a green pin
      // without a contract behind it.
      onContractSigned?.();
    } catch {
      // CR-02: completeSigning now only marks the draft completed AFTER the
      // contract insert succeeds, so the draft is still resumable here —
      // surface a retry-safe error instead of silently resetting the button.
      // A subsequent tap re-derives the SAME contract id (deriveContractId)
      // so the retry cannot insert a duplicate contract.
      setCompleteError(t('flowRunner.completeError'));
    } finally {
      completingRef.current = false;
      setCompleting(false);
    }
  }, [
    draftId,
    signatureCapture,
    productDefinitionId,
    productVersion,
    productDefinitionsRepo,
    productSlug,
    answers,
    blocks,
    snapshot,
    repo,
    contractsRepo,
    createdBy,
    teamId,
    redeemedLeadId,
  ]);

  // Design 08: the signature screen has ONE amber CTA ("Vertrag abschließen").
  // The block's button captures the signature (readSignature → PNG → stroke →
  // onSignatureCaptured); this effect then finalizes automatically — the SAME
  // handleComplete as before (signing logic untouched), just triggered by the
  // capture instead of a separate footer button. The ref fires it exactly once
  // per captured payload, so a completeError leaves it re-tappable (a retry
  // produces a NEW capture object → the effect runs again).
  const autoCompletedForRef = useRef<SignatureCapturePayload | null>(null);
  useEffect(() => {
    if (
      signatureCapture &&
      autoCompletedForRef.current !== signatureCapture &&
      activeBlock?.type === 'signature' &&
      !completing &&
      !completion
    ) {
      autoCompletedForRef.current = signatureCapture;
      void handleComplete();
    }
  }, [signatureCapture, activeBlock, completing, completion, handleComplete]);

  if (loadError) {
    return (
      <View style={styles.container}>
        <Text style={styles.loading}>{loadError}</Text>
      </View>
    );
  }

  if (completion) {
    // D-11/D-12: the terminal state — never calls onExit() directly, the
    // rep sees the confirmation + sync status first.
    return (
      <SuccessScreen
        dealReference={completion.dealReference}
        customerName={completion.customerName}
        productName={completion.productName}
        priceMonthly={completion.priceMonthly}
        syncPending={syncPending}
        onExit={onExit}
        onViewContracts={onViewContracts}
      />
    );
  }

  if (showOffer && companyId) {
    // ponytail: the consent block comes from the product when it declares one,
    // otherwise from the platform default in flow-schema. No published product
    // authors one yet — drop the fallback once they do.
    const consentBlock =
      (blocks.find((b) => b.type === 'consent') as ConsentBlock | undefined) ??
      DEFAULT_OFFER_CONSENT_BLOCK;
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.offerScroll}
        testID="flow-runner-offer"
      >
        <EndAsLeadSheet
          block={consentBlock}
          db={db}
          companyId={companyId}
          repId={createdBy}
          teamId={teamId}
          territoryId={territoryId}
          termsVersion={snapshot.termsVersion || null}
          defaultProductInterest={productSlug}
          // The terms actually discussed travel with the offer, so the mailed
          // PDF shows this conversation's numbers — not today's price list —
          // and the product VERSION travels with them, so the portal resolves
          // the exact definition the customer was shown rather than whatever
          // is published when they finally open the link (see
          // offerSnapshot.ts).
          offerSnapshot={buildFlowOfferSnapshot({
            snapshot,
            productSlug,
            productDefinitionId,
            productVersion,
          })}
          onClose={onExit}
        />
        <Pressable
          style={styles.offerCancel}
          accessibilityRole="button"
          onPress={() => setShowOffer(false)}
          testID="flow-runner-offer-cancel"
        >
          <Text style={styles.stepCounter}>{t('offer.cancel')}</Text>
        </Pressable>
      </ScrollView>
    );
  }

  if (!ready || !activeBlock) {
    return (
      <View style={styles.container}>
        <Text style={styles.loading}>{t('flowRunner.loading')}</Text>
      </View>
    );
  }

  // "Angaben prüfen" — the check-everything step, shown in place of the
  // signature capture the first time the cursor reaches it. It is a SURFACE on
  // the signature step, not an entry in `visible`, so `currentIndex`,
  // `maxReachedIndex`, the progress bar, the gate index and the "last visible
  // block is the signature" completion invariant all keep their exact meaning
  // (full rationale in ReviewScreen.tsx's header). Suppressed while immersive
  // for the same reason the step chrome is: a camera/canvas action owns the
  // whole screen — though in practice the signature block cannot have reported
  // immersive before it has rendered once.
  if (activeBlock.type === 'signature' && !reviewAcknowledged && !immersive) {
    return (
      <ReviewScreen
        rows={reviewRows}
        isJumpable={isReviewRowJumpable}
        onJump={handleReviewJump}
        onContinue={() => setReviewAcknowledged(true)}
        onBack={handleBack}
      />
    );
  }

  return (
    <View style={[styles.container, immersive && styles.containerImmersive]} testID="flow-runner-screen">
      {/* A scan camera action (design 05) hides ALL step chrome — it is not a
          step. Everything from the step header to the footer only renders once
          we are back on a real step (any non-scanning block, or the scan
          block's own confirm/input sub-state = design 06). */}
      {!immersive ? (
        <>
          {/* Design screen 04 header: a white back tile (left), the "Schritt X
              von Y" step counter (center) and an "FDS-Entwurf" draft chip
              (right) — the flow is a not-yet-signed draft until completion.
              The back tile steps back one block, or exits the flow on step 1. */}
          <View style={styles.stepHeader}>
            <Pressable
              style={styles.backTile}
              accessibilityRole="button"
              accessibilityLabel={t('flowRunner.back')}
              onPress={() => (currentIndex === 0 ? onExit() : handleBack())}
              testID="flow-runner-back-tile"
            >
              <MaterialCommunityIcons name="chevron-left" size={24} color={colors.textPrimary} />
            </Pressable>
            <Text style={styles.stepCounter}>
              {t('flow.stepCounter')
                .replace('{current}', String(currentIndex + 1))
                .replace('{total}', String(visible.length))}
            </Text>
            {companyId ? (
              <Pressable
                style={styles.offerChip}
                accessibilityRole="button"
                onPress={() => setShowOffer(true)}
                testID="flow-runner-offer-cta"
              >
                <MaterialCommunityIcons name="email-outline" size={16} color={colors.textPrimary} />
                <Text style={styles.draftChipText}>{t('offer.sendCta')}</Text>
              </Pressable>
            ) : (
              <View style={styles.draftChip}>
                <Text style={styles.draftChipText}>{t('flow.draftChip')}</Text>
              </View>
            )}
          </View>
          {/* Design screen 04 progress bar: completed steps Pine green, the active
              step Ink-Navy, upcoming steps a faint fill. Purely visual (no copy).
              No numbered step-pills row — the design has only this bar. */}
          <View style={styles.progressBar}>
            {visible.map((block, index) => (
              <View
                key={block.id}
                style={[
                  styles.progressSegment,
                  index < currentIndex
                    ? styles.progressSegmentDone
                    : index === currentIndex
                      ? styles.progressSegmentActive
                      : null,
                ]}
              />
            ))}
          </View>
        </>
      ) : null}

      {redeemedOfferCode && !immersive ? (
        <View style={styles.redeemedBanner}>
          <Text style={styles.draftChipText}>
            {t('offer.redeemedBanner').replace('{code}', redeemedOfferCode)}
          </Text>
        </View>
      ) : null}

      {/* Keyed by block id for the same reason as
          DirectSignFlowScreen.tsx's question area: two consecutive steps
          rendering the SAME component (two contact blocks, two text blocks)
          otherwise reuse one instance, and the block's local draft/touched
          state (ContactBlock.tsx:75-76) leaks into the next question. */}
      <View
        key={activeBlock.id}
        style={[styles.blockArea, immersive && styles.blockAreaImmersive]}
      >
        {renderBlock(activeBlock, db, answers, handleAnswer, handleSnapshotCaptured, {
          onSignatureCaptured: handleSignatureCaptured,
          queue: signatureQueue,
          ...deriveSignatureSummary({ answers, blocks, snapshot, productSlug }),
          onImmersiveChange: setImmersive,
          onCancel: handleBack,
          completing,
          completeError,
        }, { onImmersiveChange: setImmersive, onCancel: handleBack })}
      </View>

      {/* No shell footer: every block either self-advances (choice/slider/…)
          or, on the terminal signature step (design 08), carries its OWN
          amber "Vertrag abschließen" CTA + inline error. A shell footer here
          would stack a SECOND button behind the signature's own — removed. */}
    </View>
  );
}

/** Camera-action controls handed to the scan blocks (design 05): report when
 *  they take over the full screen, and a cancel that steps back off the scan. */
export interface ScanBlockChrome {
  onImmersiveChange: (immersive: boolean) => void;
  onCancel: () => void;
}

export interface SignatureRenderProps extends SignatureSummary {
  onSignatureCaptured: (captured: SignatureCapturePayload) => void;
  queue: SignatureAttachmentQueue;
  // Design 08: the signature is a full-screen ACTION (no step chrome). Same
  // immersive/cancel wiring as the scan blocks, plus the completion state so
  // the block's single "Vertrag abschließen" CTA can spin/erroring in place
  // (the shell auto-finalizes once the signature is captured).
  onImmersiveChange: (immersive: boolean) => void;
  onCancel: () => void;
  completing: boolean;
  completeError: string | null;
}

function renderBlock(
  block: Block,
  db: AbstractPowerSyncDatabase,
  answers: Record<string, unknown>,
  onAnswer: (fieldId: string, value: unknown) => void | Promise<void>,
  onSnapshotCaptured: (snapshot: CompletionSnapshot) => void,
  signatureProps: SignatureRenderProps,
  scan: ScanBlockChrome,
) {
  switch (block.type) {
    case 'text':
      return <TextBlock block={block} value={answers[block.id] as string | undefined} onAnswer={onAnswer} />;
    case 'choice':
      return <ChoiceBlock block={block} value={answers[block.id] as string | undefined} onAnswer={onAnswer} />;
    case 'contact':
      return <ContactBlock block={block} value={answers[block.id] as string | undefined} onAnswer={onAnswer} />;
    case 'slider':
      return <SliderBlock block={block} value={answers[block.id] as number | undefined} onAnswer={onAnswer} />;
    case 'discount':
      return (
        <DiscountBlock db={db} block={block} onAnswer={onAnswer} onSnapshotCaptured={onSnapshotCaptured} />
      );
    case 'iban-scan':
      return (
        <IbanScanBlock
          block={block}
          value={answers[block.id] as string | undefined}
          onAnswer={onAnswer}
          onImmersiveChange={scan.onImmersiveChange}
          onCancel={scan.onCancel}
        />
      );
    case 'id-scan':
      return (
        <IdScanBlock
          block={block}
          value={answers[block.id] as string | undefined}
          onAnswer={onAnswer}
          onImmersiveChange={scan.onImmersiveChange}
          onCancel={scan.onCancel}
        />
      );
    case 'belehrung':
      return (
        <BelehrungBlock block={block} value={answers[block.id] as boolean | undefined} onAnswer={onAnswer} />
      );
    case 'signature':
      return (
        <SignatureBlock
          block={block}
          value={answers[block.id] as boolean | undefined}
          onAnswer={onAnswer}
          onSignatureCaptured={signatureProps.onSignatureCaptured}
          queue={signatureProps.queue}
          customerName={signatureProps.customerName}
          productName={signatureProps.productName}
          price={signatureProps.price}
          onImmersiveChange={signatureProps.onImmersiveChange}
          onCancel={signatureProps.onCancel}
          completing={signatureProps.completing}
          completeError={signatureProps.completeError}
        />
      );
    case 'recommendation':
      return (
        <RecommendationBlock
          block={block}
          answers={answers}
          value={answers[block.id] as string | undefined}
          onAnswer={onAnswer}
        />
      );
    case 'consent':
      // Not a step: the consent block is presented by EndAsLeadSheet as part
      // of the offer/lead OUTCOME (D-17/§5.2). It is filtered out of the step
      // list above, so this case exists only to keep the exhaustiveness guard
      // below honest.
      return null;
    default: {
      // Exhaustiveness guard — the 8 curated block types (D-06) plus the
      // 03-07 recommendation block are all handled above; a new block type
      // added to the schema without a renderer here is a compile-time error
      // via this `never` check.
      const exhaustive: never = block;
      return exhaustive;
    }
  }
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    // Immersive scan action (design 05): dark full-screen surface, no chrome.
    containerImmersive: { backgroundColor: colors.ink },
    blockAreaImmersive: { padding: 0 },
    stepHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      // Full-screen Modal (statusBarTranslucent) — clear the status bar/notch.
      paddingTop: spacing['2xl'],
    },
    // Design 04 back tile: 48dp white square, subtle border, ink chevron.
    backTile: {
      width: spacing.touchTarget,
      height: spacing.touchTarget,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepCounter: { ...typography.label, fontWeight: '600', color: colors.textSecondary },
    // Design screen 04: "FDS-Entwurf" is a neutral JetBrains-Mono chip (the flow
    // is a not-yet-signed draft), not an amber pill.
    draftChip: {
      backgroundColor: colors.subtleFill,
      borderRadius: radius.sm - 1,
      paddingVertical: spacing.xs + 1,
      paddingHorizontal: spacing.sm + 1,
    },
    draftChipText: { ...typography.mono, fontWeight: '500', color: colors.textPrimary },
    offerChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      minHeight: spacing.touchTarget,
      paddingHorizontal: spacing.md,
      borderRadius: radius.input,
      borderWidth: 1.5,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surface,
    },
    offerScroll: { padding: spacing.lg, gap: spacing.md },
    offerCancel: { alignItems: 'center', paddingVertical: spacing.md },
    redeemedBanner: {
      alignSelf: 'flex-start',
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.input,
      backgroundColor: colors.surface,
      borderWidth: 1.5,
      borderColor: colors.pine,
    },
    progressBar: {
      flexDirection: 'row',
      gap: spacing.sm - 1,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
    },
    progressSegment: {
      flex: 1,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.subtleFill,
    },
    progressSegmentDone: { backgroundColor: colors.pine },
    progressSegmentActive: { backgroundColor: colors.ink },
    blockArea: { flex: 1, padding: spacing.lg },
    loading: { ...typography.body, color: colors.textSecondary, padding: spacing.lg },
  });
}
