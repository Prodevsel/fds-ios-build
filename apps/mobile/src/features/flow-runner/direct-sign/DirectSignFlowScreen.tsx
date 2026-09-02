import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  pruneInvalidatedAnswers,
  visibleBlocks,
  type Block,
  type DirectSignFieldPlacement,
  directSignQuestionBlocks,
  formatPlacementValue,
} from '@frontdoorsales/flow-schema';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import SignatureCanvas, { type SignatureViewRef } from 'react-native-signature-canvas';
import { radius, spacing, typography } from '../../../design/tokens';
import { t } from '../../../i18n';
import type { SignatureAttachmentQueue } from '../../../lib/db/attachments/signatureAttachments';
import type { DeviceIdResult } from '../../../lib/device/getDeviceId';
import type { SignatureLocationResult } from '../../../lib/location/getSignatureLocation';
import { SuccessScreen } from '../../checkout/SuccessScreen';
import { useThemeColors } from '../../settings/theme/useThemeColors';
import { EndAsLeadSheet } from '../EndAsLeadSheet';
import { ReviewScreen } from '../ReviewScreen';
import { buildReviewRows } from '../reviewRows';
import type { EndAsLeadDb } from '../useEndAsLead';
import { BelehrungBlock } from '../blocks/BelehrungBlock';
import { ChoiceBlock } from '../blocks/ChoiceBlock';
import { IbanScanBlock } from '../blocks/IbanScanBlock';
import { ContactBlock } from '../blocks/ContactBlock';
import { parseStrokeData, stripDataUrlPrefix } from '../blocks/SignatureBlock';
import { SliderBlock } from '../blocks/SliderBlock';
import { TextBlock } from '../blocks/TextBlock';
import { deriveContractCustomerName, type ContractsRepo } from '../db/contractsRepo';
import {
  useContractSyncPending,
  type ContractSyncSource,
} from '../../checkout/useContractSyncPending';
import { DirectSignPdfViewer } from './DirectSignPdfViewer';
import { writePreviewPdf } from './directSignPreviewFile';
import { hashPdfBytes } from './hashPdfBytes';
import { TRANSPARENT_PNG, renderDirectSignPdf } from './renderDirectSignPdf';
import {
  buildDirectSignOfferSnapshot,
  derivePackageTerms,
  deriveOfferContactFromAnswers,
  resolveOfferConsentBlock,
} from './directSignOffer';
import { completeDirectSign } from './completeDirectSign';
import { type ConfirmedGateEntry, resolveBelehrungGateBlock } from './directSignGate';
import {
  advanceStep,
  canAdvanceToSignature,
  confirmBelehrung,
  deriveSteps,
  nextQuestionStepIndex,
  questionBlockId,
  signatureStepIndex,
} from './useDirectSignFlow';

/**
 * DSGN-01/DSGN-02/DSGN-03: routes a `direct_pdf` product into a dedicated
 * view -> belehrung -> signature flow (instead of FlowRunnerScreen's
 * block-per-screen wizard). The signature step is TECHNICALLY unreachable
 * (useDirectSignFlow.advanceStep, not merely a visually-disabled button)
 * until the belehrung gate block — sourced from `blocks`, the published
 * product's own definition, NEVER the rendered PDF — is confirmed.
 *
 * The signature step captures on the SAME `react-native-signature-canvas`
 * Phase 4 uses, then finalizes fully offline via completeDirectSign.ts
 * (Plan 10-09) — mirroring FlowRunnerScreen's SignatureBlock/completeSigning
 * wiring shape (capture -> auto-complete effect -> SuccessScreen), with the
 * two-hash/direct_sign_template_id additions completeDirectSign owns.
 */
export interface DirectSignFlowScreenPdfProps {
  /** Local file:// uri of the prefetched, integrity-verified original — null if not yet cached on this device. */
  localFileUri: string | null;
  prefetching?: boolean;
  prefetchError?: string | null;
  onRequestPrefetch?: () => void;
}

/**
 * DSGN-03: everything completeDirectSign.ts needs but does not itself
 * resolve (this screen's caller supplies it, same split as FlowRunnerScreen
 * separating repo/queue construction from completeSigning's pure core).
 */
export interface DirectSignFlowScreenSigningProps {
  companyId: string;
  repId: string;
  teamId: string;
  productDefinitionId: string;
  productVersion: number;
  directSignTemplateId: string;
  /** The prefetched, integrity-verified ORIGINAL PDF bytes (Plan 10-05's prefetchDirectSignPdf.ts) — null until prefetched on this device (mirrors pdf.localFileUri's null state). */
  originalPdfBytes: Uint8Array | null;
  originalTemplateSha256: string;
  contractsRepo: Pick<ContractsRepo, 'insertContract'>;
  attachmentQueue: SignatureAttachmentQueue;
  getDeviceId: () => Promise<DeviceIdResult>;
  getSignatureLocation: () => Promise<SignatureLocationResult>;
  generateUuid: () => string;
  /** Summary strip data for SuccessScreen — a direct-sign flow has no captured customer/product identity beyond the product itself, so productName/priceMonthly are the caller's best-effort values. */
  productName: string;
  /** null when nothing was captured — a direct_pdf product has no discount
   * block (D-04). Never 0 as a stand-in: the success screen would print it. */
  priceMonthly: number | null;
  /** 0084 (§5.2): the lead whose offer code opened this signing, if any. */
  redeemedLeadId?: string | null;
  /** 0101: the door the flow ran on, stamped onto the contract. */
  houseId: string;
}

export interface DirectSignFlowScreenProps {
  /** The published direct_pdf product's blocks — MUST carry a belehrung gate block (assertDirectSignPublishable enforces this at publish time). */
  blocks: Block[];
  /**
   * 0085: the operator-placed anchors from the template row. Two uses: showing
   * the customer, before they sign, which answers will be written into the
   * document — and rendering the finished document ON THE DEVICE at completion,
   * so the hash in the audit package covers the page that was actually signed.
   * Empty for a template without variables.
   */
  fieldPlacements?: DirectSignFieldPlacement[];
  /**
   * The signature anchor from the template row (`signature_page`,
   * `signature_x_frac`, `signature_y_frac`). Already synced to the device;
   * needed here so the device can render what the server would.
   *
   * Absent means the device cannot render, and the flow proceeds exactly as
   * before with no artifact hash recorded — never a blocked signature.
   */
  signatureAnchor?: { page: number; xFrac: number; yFrac: number } | null;
  /**
   * The house's address. Placements with `source: 'house.address'` stamp it —
   * the flow never asks, because the consultation started in front of it.
   */
  houseAddress?: string | null;
  pdf: DirectSignFlowScreenPdfProps;
  signing: DirectSignFlowScreenSigningProps;
  digestFn: (data: string) => Promise<string>;
  /**
   * The offer exit (§5.2) for this path. OPTIONAL on purpose: a call site that
   * passes nothing simply gets no offer exit and keeps compiling — nothing
   * about the signing flow depends on it.
   */
  offer?: {
    db: EndAsLeadDb;
    productSlug: string;
    territoryId?: string | null;
  };
  /**
   * Read-only handle on the local CRUD upload queue, used for ONE thing: the
   * success screen's transfer card, which used to be told `syncPending` was
   * true unconditionally and therefore lectured an online rep about the
   * network after every deal (see useContractSyncPending). Optional because
   * this screen has never needed a database of its own — without it the card
   * degrades to the previous always-pending claim rather than guessing.
   */
  syncSource?: ContractSyncSource;
  now?: () => Date;
  onExit: () => void;
  /** Fires once the contract row is persisted — see FlowRunnerScreen. */
  onContractSigned?: () => void;
  onViewContracts?: () => void;
}

export function DirectSignFlowScreen({
  blocks,
  fieldPlacements = [],
  signatureAnchor = null,
  houseAddress = null,
  pdf,
  signing,
  digestFn,
  offer,
  syncSource,
  now = () => new Date(),
  onExit,
  onContractSigned,
  onViewContracts,
}: DirectSignFlowScreenProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // 0085: the product's askable blocks, in authored order — the SSOT filter
  // decides what a direct-sign flow may ask (never "everything the wizard can
  // render": a discount snapshot, an IBAN scan or an ID scan need machinery
  // this screen has no equivalent of).
  // The customer's answers. Unlike the wizard there is no flow_draft behind
  // this screen — a direct-sign consultation is a single sitting, and the
  // answers travel into the contract row at completion.
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const authoredQuestionBlocks = useMemo(() => directSignQuestionBlocks(blocks), [blocks]);
  /**
   * showIf, which this screen did not evaluate at all until now.
   *
   * The wizard has filtered on it since D-13; here every authored block was
   * always asked. That was invisible while no direct_pdf product branched —
   * and became a hard blocker the moment one had to, because a flow that asks
   * "Privatperson oder Firma?" and then asks BOTH follow-ups is worse than not
   * asking at all.
   *
   * Index churn is not a concern in the direction that matters: a branch
   * question necessarily precedes the blocks it reveals, so answering it only
   * ever adds or removes steps AFTER the current one. `signatureIndex` and
   * `viewStepIndex` are recomputed from this same list, so they follow.
   */
  const questionBlocks = useMemo(
    () => visibleBlocks(authoredQuestionBlocks, answers),
    [authoredQuestionBlocks, answers],
  );
  const steps = useMemo(() => deriveSteps(questionBlocks.map((b) => b.id)), [questionBlocks]);
  const signatureIndex = signatureStepIndex(steps);
  const viewStepIndex = questionBlocks.length;
  const belehrungBlock = useMemo(() => resolveBelehrungGateBlock(blocks), [blocks]);

  const [stepIndex, setStepIndex] = useState(0);
  /**
   * The wizard has shown "Angaben pruefen" before the signature since 6991d75;
   * this path never got it. Not a nice-to-have here: the PDF path is the one
   * where a wrong answer is stamped into a legally binding document the
   * customer signs on the spot, and the only way back used to be tapping the
   * header arrow past every intervening step.
   */
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);
  const [confirmedGates, setConfirmedGates] = useState<ConfirmedGateEntry[]>([]);
  // §5.2: an undecided customer can appear at ANY step, so this is a mode the
  // screen can enter from anywhere — not a terminal step appended to the flow.
  const [showOffer, setShowOffer] = useState(false);
  // A contract has to be READABLE on the screen that asks the customer to read
  // it. Measured against the window rather than a flex share: inside the
  // scrolling view step there is no fixed remainder to divide, and
  // react-native-pdf lays out nothing without bounded dimensions. The floor
  // keeps it usable on a small phone in landscape.
  const { height: windowHeight } = useWindowDimensions();
  const pdfHeight = Math.max(420, Math.round(windowHeight * 0.72));

  /**
   * Leaving the signature step re-arms the review, so a rep who goes back to
   * correct an answer lands on the check again rather than straight on the
   * canvas.
   *
   * Position matters more than the rule: this MUST sit above every early
   * return in this component. It first sat below them, and `if (completion)`
   * is one of those returns — so the hook stopped running at the exact moment
   * a contract came into being, React saw fewer hooks than on the previous
   * render, and the app crashed on "Vertrag abschliessen".
   */
  useEffect(() => {
    if (stepIndex !== signatureIndex && reviewAcknowledged) setReviewAcknowledged(false);
  }, [stepIndex, signatureIndex, reviewAcknowledged]);

  /**
   * The resolved stamps: every placement that has an answer, with the text that
   * will be drawn. ONE source for two consumers — the summary the customer
   * reads before signing, and the document the device renders at completion.
   *
   * Hoisted above the early returns because `runCompletion` closes over it; it
   * also has to exist on every render for the same reason the review effect
   * does.
   */
  const stampedOverlays = useMemo(
    () =>
      fieldPlacements.flatMap((placement) => {
        // A `source` placement stamps something the flow already KNOWS and
        // never asked — today only the house's address. It needs no block, and
        // an unknown key stamps nothing rather than the key name. Mirrors the
        // server's context exactly (webhook-dispatcher/index.ts), or the
        // preview and the signed document would disagree.
        if (placement.source) {
          const contextText = placement.source === 'house.address' ? (houseAddress ?? '') : '';
          if (contextText.trim().length === 0) return [];
          return [
            {
              blockId: placement.blockId,
              label: t('statusSheet.addressLabel'),
              text: contextText,
              page: placement.page,
              xFrac: placement.xFrac,
              yFrac: placement.yFrac,
              fontSize: placement.fontSize ?? 11,
            },
          ];
        }
        const block = questionBlocks.find((b) => b.id === placement.blockId);
        if (!block) return [];
        const text = formatPlacementValue(block, answers[placement.blockId], placement.part);
        if (text.trim().length === 0) return [];
        return [
          {
            blockId: placement.blockId,
            label: ('shortLabel' in block && block.shortLabel) || block.label,
            text,
            page: placement.page,
            xFrac: placement.xFrac,
            yFrac: placement.yFrac,
            fontSize: placement.fontSize ?? 11,
          },
        ];
      }),
    [fieldPlacements, questionBlocks, answers, houseAddress],
  );

  /**
   * The document as it will look, WITH the customer's answers already in it.
   *
   * The viewer used to show the untouched template, so the customer read a
   * blank form, agreed to it and signed — and the values appeared afterwards,
   * on the server, on a page nobody in the room had seen. Rendering it here is
   * what turns "trust us" into "read it".
   *
   * The SIGNATURE is deliberately absent: it does not exist yet, and drawing a
   * placeholder onto a contract preview would be a lie about a legal document.
   *
   * Falls back to the original on any failure — null uri means the viewer shows
   * exactly what it showed before. A preview is a courtesy; it must never be
   * the reason a signature cannot happen.
   */
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!signing.originalPdfBytes || !signatureAnchor || stampedOverlays.length === 0) {
      setPreviewUri(null);
      return;
    }
    void (async () => {
      try {
        const bytes = await renderDirectSignPdf(
          signing.originalPdfBytes as Uint8Array,
          // A 1x1 fully transparent PNG: renderDirectSignPdf always embeds a
          // signature, and this path has none yet. Invisible, so the preview
          // shows the fields and an empty signature line — the truth.
          { pngBytes: TRANSPARENT_PNG, page: signatureAnchor.page, xFrac: 0, yFrac: 1 },
          stampedOverlays,
        );
        const uri = await writePreviewPdf(bytes, await hashPdfBytes(bytes));
        if (!cancelled) setPreviewUri(uri);
      } catch {
        if (!cancelled) setPreviewUri(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signing.originalPdfBytes, signatureAnchor, stampedOverlays]);

  const signatureReachable = canAdvanceToSignature({ confirmedGates, belehrungBlock });
  const belehrungConfirmed = belehrungBlock
    ? confirmedGates.some((entry) => entry.blockId === belehrungBlock.id)
    : false;

  const goTo = useCallback(
    (requestedIndex: number) => {
      setStepIndex((current) =>
        advanceStep(current, requestedIndex, signatureReachable, signatureIndex),
      );
    },
    [signatureReachable, signatureIndex],
  );

  /**
   * A question is answered and the flow moves on — the same self-advancing
   * behaviour the wizard's blocks have, so a choice is one tap rather than a
   * tap plus a "Weiter".
   */
  const handleQuestionAnswer = useCallback(
    (fieldId: string, value: unknown) => {
      // D-15: an answer that hides a block also drops that block's answer. A
      // company name left behind after switching to "Privatperson" would
      // otherwise still be there at completion — and `customerCompany` outranks
      // `customerName`, so the contract would name the wrong party.
      const nextAnswers = pruneInvalidatedAnswers(authoredQuestionBlocks, {
        ...answers,
        [fieldId]: value,
      });
      setAnswers(nextAnswers);
      // The target is resolved against the list this answer produces, not the
      // one it was tapped in: answering `kundenart` inserts `customerName`, so
      // "the step after the block I just answered" and "current + 1" are only
      // the same index while every revealed block happens to sit after its
      // branch question (see useDirectSignFlow.nextQuestionStepIndex). The
      // signature index is recomputed from the same new list — the old one
      // belongs to a shorter flow and is the wrong clamp to hand advanceStep.
      const nextQuestionIds = visibleBlocks(authoredQuestionBlocks, nextAnswers).map((b) => b.id);
      const nextSignatureIndex = signatureStepIndex(deriveSteps(nextQuestionIds));
      setStepIndex((current) =>
        advanceStep(
          current,
          nextQuestionStepIndex(nextQuestionIds, fieldId, current),
          signatureReachable,
          nextSignatureIndex,
        ),
      );
    },
    [answers, signatureReachable, authoredQuestionBlocks],
  );

  const handleBelehrungAnswer = useCallback(
    async (_fieldId: string, value: boolean) => {
      if (value !== true || !belehrungBlock) return;
      const entry = await confirmBelehrung({ belehrungBlock, now, digestFn });
      setConfirmedGates((prev) => [...prev.filter((e) => e.blockId !== entry.blockId), entry]);
    },
    [belehrungBlock, now, digestFn],
  );

  // Signature capture + offline completion — mirrors SignatureBlock's
  // imperative readSignature()/onOK -> getData()/onGetData round trip, but
  // WITHOUT saving the PNG through the attachment queue here: completeDirectSign
  // owns that (it needs the base64 to both queue AND hash independently,
  // T-10-24 — saving it a second time here would be a second, divergent
  // write path for the same evidence).
  const signatureRef = useRef<SignatureViewRef>(null);
  const pendingPngBase64 = useRef<string | null>(null);
  const [canvasEmpty, setCanvasEmpty] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [completion, setCompletion] = useState<{
    dealReference: string;
    contractId: string;
    /** `file://` of the signed document, when the device rendered one. */
    documentUri: string | null;
  } | null>(null);
  // Same honest signal as FlowRunnerScreen — the local upload queue, per
  // contract, not an assumption about the network.
  const syncPending = useContractSyncPending(syncSource, completion?.contractId ?? null);
  const completingRef = useRef(false);
  // WR-02 (Phase 10 review): completeDirectSign's CompleteDirectSignParams.id/
  // signatureAttachmentId exist precisely so a retried completion re-targets
  // the SAME contract row (contractsRepo's `INSERT OR IGNORE`) and the SAME
  // local attachment record, instead of a fresh random id every attempt —
  // mirroring how FlowRunnerScreen.completeSigning derives its deterministic
  // contract id from the (stable) flow-draft id. There is no draft id
  // equivalent for the direct-sign flow, so these ids are generated ONCE per
  // screen mount (first signing attempt) and reused across retries within
  // that mount via refs — never regenerated on a retry.
  const signingIdRef = useRef<string | null>(null);
  const signatureAttachmentIdRef = useRef<string | null>(null);

  const runCompletion = useCallback(
    async (pngBase64: string, strokeData: unknown[]) => {
      if (completingRef.current || !signing.originalPdfBytes) return;
      completingRef.current = true;
      setCompleting(true);
      setCompleteError(null);
      if (!signingIdRef.current) signingIdRef.current = signing.generateUuid();
      if (!signatureAttachmentIdRef.current)
        signatureAttachmentIdRef.current = signing.generateUuid();
      try {
        const result = await completeDirectSign(
          {
            contractsRepo: signing.contractsRepo,
            attachmentQueue: signing.attachmentQueue,
            digestFn,
            generateUuid: signing.generateUuid,
            now,
          },
          {
            companyId: signing.companyId,
            repId: signing.repId,
            teamId: signing.teamId,
            productDefinitionId: signing.productDefinitionId,
            productVersion: signing.productVersion,
            directSignTemplateId: signing.directSignTemplateId,
            originalPdfBytes: signing.originalPdfBytes,
            originalTemplateSha256: signing.originalTemplateSha256,
            redeemedLeadId: signing.redeemedLeadId ?? null,
            houseId: signing.houseId,
            // What the device needs to render the finished page itself.
            // `stampedSummary` above already resolved exactly these values for
            // the customer to read — the SAME list is what gets stamped, so
            // the preview and the document cannot describe different things.
            signatureAnchor,
            fieldOverlays: stampedOverlays,
            // 0085: the answers the customer gave before the PDF. They are
            // what the server stamps into the artifact, and they are where
            // the dispatcher finds the address to mail the contract to —
            // this used to go out as {} and every direct-sign render job
            // dead-lettered on "no customer email on contract snapshot".
            answers,
            signaturePngBase64: pngBase64,
            signatureStrokeData: strokeData,
            confirmedGates,
            ...(await signing.getDeviceId()),
            gps: (await signing.getSignatureLocation()).gps,
            id: signingIdRef.current,
            signatureAttachmentId: signatureAttachmentIdRef.current,
          },
        );
        // Write the signed document out so the success screen can show it.
        // After the contract exists, never before: a failure here must not be
        // able to touch the legal write path.
        let documentUri: string | null = null;
        if (result.renderedArtifactBytes && result.renderedArtifactSha256) {
          documentUri = await writePreviewPdf(
            result.renderedArtifactBytes,
            result.renderedArtifactSha256,
          );
        }
        setCompletion({
          dealReference: result.dealReference,
          contractId: result.id,
          documentUri,
        });
        // Same contract as the block path: the pin follows the deal, fired at
        // persistence rather than at exit (see FlowRunnerScreen's note).
        onContractSigned?.();
      } catch (err) {
        // WR-03 (Phase 10 review): the real error (hash failure, disk-full
        // on attachmentQueue.saveFile, SQLite constraint violation on
        // insertContract, etc.) must never be discarded — this is the
        // terminal legal-signing step, offline, at a customer's door, and a
        // silent failure here is otherwise unrecoverable in the field. Trace
        // under __DEV__ only (never in production builds), matching
        // contractsRepo.ts's [DETAIL-TRACE] convention; the rep still only
        // ever sees the generic German copy below — no raw stack leaks to
        // the customer at the door.
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.error('[DETAIL-TRACE] DirectSignFlowScreen.runCompletion failed:', err);
        }
        // Demo builds append the underlying reason. The generic copy alone is
        // what a customer at the door should see, but it is also all a RELEASE
        // build shows — the [DETAIL-TRACE] above is __DEV__ only, so a failure
        // on a sideloaded device is undiagnosable. That turns every attempt
        // into a guess, which is exactly how this project has lost days.
        const detail =
          process.env.EXPO_PUBLIC_DEMO_BACKEND_OVERRIDE === '1'
            ? ` (${err instanceof Error ? err.message : String(err)})`
            : '';
        setCompleteError(t('flowRunner.completeError') + detail);
      } finally {
        completingRef.current = false;
        setCompleting(false);
      }
    },
    [answers, confirmedGates, digestFn, now, signing, signatureAnchor, stampedOverlays],
  );

  const handleCanvasOK = useCallback((pngDataUrl: string) => {
    pendingPngBase64.current = stripDataUrlPrefix(pngDataUrl);
    signatureRef.current?.getData();
  }, []);

  const handleCanvasGetData = useCallback(
    (json: string) => {
      const pngBase64 = pendingPngBase64.current;
      if (!pngBase64) return;
      void runCompletion(pngBase64, parseStrokeData(json));
    },
    [runCompletion],
  );

  const handleCanvasConfirm = useCallback(() => {
    if (canvasEmpty || completing) return;
    signatureRef.current?.readSignature();
  }, [canvasEmpty, completing]);

  const handleCanvasClear = useCallback(() => {
    signatureRef.current?.clearSignature();
    setCanvasEmpty(true);
    setCompleteError(null);
    pendingPngBase64.current = null;
  }, []);

  // DSGN-03: terminal success state — the offline audit package + append-only
  // contract insert has already completed (completeDirectSign) by the time
  // this renders. `syncPending` is DERIVED, not assumed: the old hardcoded
  // `true` here made the screen claim the contract was waiting for a network
  // the device already had, on every deal (same D-11/D-12 posture as
  // FlowRunnerScreen's completion state, which was fixed with it).
  if (completion) {
    return (
      <SuccessScreen
        dealReference={completion.dealReference}
        // The SAME derivation `contracts.customer_name` is written with
        // (deriveContractCustomerName): company first, then person. This screen
        // used to hardcode "Unbekannter Kunde" on a contract that knows exactly
        // who signed it — the name was three lines away in `answers` the whole
        // time. The fallback stays for a product that captures neither.
        customerName={deriveContractCustomerName(answers) ?? t('contracts.unknownCustomer')}
        syncPending={syncPending}
        // The door the consultation ran on. SuccessScreen has taken an
        // `addressLine` since it was written and no caller ever passed one.
        addressLine={houseAddress ?? undefined}
        // The PACKAGE, not the product slug.
        //
        // `product_definitions` has no human-readable name column — only
        // `slug` — so this line used to read "smaica-social-media-pdf" to a rep
        // who had just closed a deal. The package is the thing the customer
        // actually chose, it is already frozen onto the offer snapshot, and it
        // comes from the same derivation, so screen, snapshot and stamped PDF
        // cannot disagree. Falls back to the slug for a product with no priced
        // package, which is the old behaviour and still the only honest one.
        productName={derivePackageTerms(blocks, answers).packageLabel ?? signing.productName}
        priceMonthly={signing.priceMonthly}
        // The signed document. `completion.documentUri` was written above
        // (writePreviewPdf, right after the contract exists) and SuccessScreen
        // has taken a `documentUri` prop all along — it was simply never
        // passed, so the one screen whose job is to show the finished contract
        // showed everything about it except the contract.
        documentUri={completion.documentUri}
        onExit={onExit}
        onViewContracts={onViewContracts}
      />
    );
  }

  if (!belehrungBlock) {
    // Should never happen for a publishable product (assertDirectSignPublishable
    // structurally forbids it) — but never silently render a signable flow
    // without a notice gate to satisfy (T-10-20/T-10-21).
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{t('directSign.prefetchError')}</Text>
      </View>
    );
  }

  if (offer && showOffer) {
    // The SAME sheet the wizard renders — one consent-gated lead write path,
    // not a second one (D-17's client gate in useEndAsLead and the server's
    // leads_insert_by_rep WITH CHECK both still apply, untouched).
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.offerScroll}
        testID="direct-sign-offer"
      >
        <EndAsLeadSheet
          block={resolveOfferConsentBlock(blocks)}
          db={offer.db}
          companyId={signing.companyId}
          repId={signing.repId}
          teamId={signing.teamId}
          territoryId={offer.territoryId ?? null}
          defaultProductInterest={offer.productSlug}
          // D-5: the e-mail the customer already typed in this flow, prefilled
          // and still editable — never asked a second time.
          defaultContact={deriveOfferContactFromAnswers(blocks, answers)}
          // D-6: productSlug routes a later redemption back into THIS path.
          offerSnapshot={buildDirectSignOfferSnapshot({
            productSlug: offer.productSlug,
            answers,
            // ...and the pinned version is what the customer is actually shown
            // on redemption, instead of whatever got published in the meantime.
            productDefinitionId: signing.productDefinitionId,
            productVersion: signing.productVersion,
            // The blocks resolve the chosen package and its price out of the
            // answers, so the customer page shows the conditions he was quoted
            // instead of a bare date; the house is what puts his address on the
            // contract he later signs in the browser.
            blocks,
            houseId: signing.houseId,
          })}
          onClose={onExit}
        />
        <Pressable
          style={styles.offerCancel}
          accessibilityRole="button"
          onPress={() => setShowOffer(false)}
          testID="direct-sign-offer-cancel"
        >
          <Text style={styles.hint}>{t('offer.cancel')}</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // The customer-facing view of the same resolved list.
  const stampedSummary = stampedOverlays.map((o) => ({
    blockId: o.blockId,
    label: o.label,
    value: o.text,
  }));

  /**
   * An offer is only offerable once there is an OFFER.
   *
   * The exit used to appear on every step, including the first, where
   * `answers` is still empty. `buildDirectSignOfferSnapshot` would then freeze
   * `{ answers: {} }` — and everything downstream reads that snapshot: the
   * customer page shows "Ihre Konditionen" with nothing under it, and
   * /offer-portal/document renders a contract with no package and no price
   * stamped into it. The rep reads a code out at the door for a link that
   * leads to an empty document, and the snapshot is frozen, so it cannot heal
   * once the conversation continues.
   *
   * The package is the right gate because it is the first answer that has
   * commercial content: same derivation the snapshot itself uses, so "the chip
   * is visible" and "the snapshot will carry conditions" are one condition,
   * not two that can drift.
   *
   * NOT disabled — absent. A greyed-out control on a step where it can never
   * be right is a control the rep still tries to press in front of a customer.
   */
  const offerHasSomethingToSay =
    derivePackageTerms(blocks, answers).packageLabel !== undefined;

  const activeStep = steps[stepIndex];
  const activeQuestionId = activeStep ? questionBlockId(activeStep) : null;
  const activeQuestionBlock = activeQuestionId
    ? (questionBlocks.find((b) => b.id === activeQuestionId) ?? null)
    : null;

  // questionBlocks maps 1:1 onto steps 0..n-1, so a row's index IS the step to
  // jump to — no re-mapping, the same guarantee FlowRunnerScreen relies on.
  const reviewRows = buildReviewRows(questionBlocks, answers);

  if (stepIndex === signatureIndex && !reviewAcknowledged && !completion && reviewRows.length > 0) {
    return (
      <ReviewScreen
        rows={reviewRows}
        // Every question here is behind the rep already — this screen is only
        // reachable from the signature step — so every row is correctable.
        isJumpable={() => true}
        onJump={(targetIndex) => setStepIndex(targetIndex)}
        onContinue={() => setReviewAcknowledged(true)}
        onBack={() => setStepIndex(viewStepIndex)}
      />
    );
  }

  return (
    <View style={styles.container} testID="direct-sign-flow-screen">
      {/*
        Step chrome, which this path simply did not have. The wizard has shown
        "Schritt N von M" and a segmented bar since design 04; here the customer
        watched an unbounded sequence of unlabelled screens and could not tell
        whether one more question was coming or ten. The data was always exact —
        `steps` and `stepIndex` drive the flow itself — it was just never drawn.

        The back tile moves up here for the same reason: it sat bottom-left in
        this path and top-left in the wizard, so the same gesture lived in two
        different corners of one product.
      */}
      <View style={styles.stepHeader}>
        <Pressable
          style={styles.backTile}
          accessibilityRole="button"
          accessibilityLabel={t('flowRunner.back')}
          onPress={() => (stepIndex === 0 ? onExit() : setStepIndex((prev) => Math.max(0, prev - 1)))}
          testID="direct-sign-back-tile"
        >
          <MaterialCommunityIcons name="chevron-left" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.stepCounter}>
          {t('flow.stepCounter')
            .replace('{current}', String(Math.min(stepIndex + 1, steps.length)))
            .replace('{total}', String(steps.length))}
        </Text>
        {offer && offerHasSomethingToSay ? (
          <Pressable
            style={styles.offerChip}
            accessibilityRole="button"
            onPress={() => setShowOffer(true)}
            testID="direct-sign-offer-cta"
          >
            <MaterialCommunityIcons name="email-outline" size={16} color={colors.textPrimary} />
            <Text style={styles.offerChipText}>{t('offer.sendCta')}</Text>
          </Pressable>
        ) : (
          // Keeps the counter centred when there is no offer exit — and while
          // there is nothing yet to make an offer ABOUT.
          <View style={styles.backTile} />
        )}
      </View>
      <View style={styles.progressBar}>
        {steps.map((step, index) => (
          <View
            key={String(step)}
            style={[
              styles.progressSegment,
              index < stepIndex
                ? styles.progressSegmentDone
                : index === stepIndex
                  ? styles.progressSegmentActive
                  : null,
            ]}
          />
        ))}
      </View>
      <View style={styles.stepArea}>
        {activeQuestionBlock ? (
          <View
            /*
             * The block's id IS the subtree's identity. Without it React sees
             * "a ContactBlock in the same slot" across a step change and reuses
             * the instance, so ContactBlock.tsx:75-76's `touched`/`draft` (and
             * TextBlock's `draft`, SliderBlock's `current`) survive into the
             * NEXT question: leaving `customerName` for `email` carried the
             * typed name over as the email draft with touched=true, and the
             * freshly presented email block rendered "E-Mail ungueltig" for
             * something nobody had submitted.
             */
            key={activeQuestionBlock.id}
            style={styles.questionArea}
            testID={`direct-sign-question-${activeQuestionBlock.id}`}
          >
            {renderQuestionBlock(activeQuestionBlock, answers, handleQuestionAnswer)}
          </View>
        ) : null}

        {activeStep === 'view' ? (
          /*
           * SCROLLS, and the document gets a real height.
           *
           * `stepArea` is a plain View, so everything on this step shared one
           * screen: heading, hint, the stamped-answer summary and the PDF. The
           * summary grows with the template — nine anchors on the current one —
           * and the viewer, being the only `flex: 1` child, absorbed the whole
           * shortfall. The result was a contract rendered a couple of
           * centimetres tall, on the screen whose entire purpose is that the
           * customer READS it before signing.
           *
           * Height comes from the window rather than a flex share for the same
           * reason: inside a ScrollView `flex: 1` has no fixed space to divide,
           * and react-native-pdf needs bounded dimensions to lay out at all.
           */
          <ScrollView
            style={styles.viewStepScroll}
            contentContainerStyle={styles.viewStepContent}
            testID="direct-sign-view-step-scroll"
          >
            <Text style={styles.heading}>{t('directSign.viewStepHeading')}</Text>
            <Text style={styles.hint}>{t('directSign.viewStepHint')}</Text>
            {/* 0085: what the customer is about to sign, in words, before the
                document itself. The values below are the ones the server
                stamps into the PDF — same blocks, same formatting function —
                so nobody signs a document whose contents they never saw. */}
            {stampedSummary.length > 0 ? (
              <View style={styles.summaryCard} testID="direct-sign-answer-summary">
                <Text style={styles.summaryHeading}>{t('directSign.answerSummaryHeading')}</Text>
                {stampedSummary.map((entry) => (
                  <View key={entry.blockId} style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>{entry.label}</Text>
                    <Text style={styles.summaryValue}>{entry.value}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            <View style={{ height: pdfHeight }}>
              <DirectSignPdfViewer
                // The filled preview when there is one, the original otherwise.
                localFileUri={previewUri ?? pdf.localFileUri}
                onRequestPrefetch={pdf.onRequestPrefetch}
                prefetching={pdf.prefetching}
                prefetchError={pdf.prefetchError}
              />
            </View>
            <Pressable
              // Was painted fully enabled while disabled: a full-amber CTA that
              // swallowed taps, on the screen right before signing.
              style={[styles.primaryButton, !pdf.localFileUri ? styles.primaryButtonDisabled : null]}
              accessibilityRole="button"
              disabled={!pdf.localFileUri}
              onPress={() => goTo(viewStepIndex + 1)}
              testID="direct-sign-continue-to-belehrung"
            >
              <Text
                style={[
                  styles.primaryButtonText,
                  !pdf.localFileUri ? styles.primaryButtonTextDisabled : null,
                ]}
              >
                {t('directSign.continueToBelehrungCta')}
              </Text>
            </Pressable>
          </ScrollView>
        ) : null}

        {activeStep === 'belehrung' ? (
          <>
            <BelehrungBlock
              block={belehrungBlock}
              value={belehrungConfirmed ? true : undefined}
              onAnswer={handleBelehrungAnswer}
            />
            <Pressable
              style={[
                styles.primaryButton,
                !signatureReachable ? styles.primaryButtonDisabled : null,
              ]}
              accessibilityRole="button"
              disabled={!signatureReachable}
              onPress={() => goTo(signatureIndex)}
              testID="direct-sign-continue-to-signature"
            >
              <Text
                style={[
                  styles.primaryButtonText,
                  !signatureReachable ? styles.primaryButtonTextDisabled : null,
                ]}
              >
                {t('directSign.continueToSignatureCta')}
              </Text>
            </Pressable>
          </>
        ) : null}

        {activeStep === 'signature' ? (
          // Guarded above by advanceStep — this branch is only ever reached
          // once signatureReachable is true. Reuses signature.* i18n copy and
          // the SAME react-native-signature-canvas capture round trip as
          // SignatureBlock (onOK -> PNG, then getData() -> onGetData stroke
          // JSON) — completeDirectSign.ts (not this component) owns queueing
          // the PNG through the attachment queue and hashing it.
          <View style={styles.signatureArea} testID="direct-sign-signature-step">
            <Text style={styles.heading}>{t('signature.handoverHeading')}</Text>
            <Text style={styles.hint}>{t('signature.subheading')}</Text>
            <View style={styles.canvasWrapper} testID="direct-sign-signature-canvas">
              <SignatureCanvas
                ref={signatureRef}
                onBegin={() => setCanvasEmpty(false)}
                onEmpty={() => setCanvasEmpty(true)}
                onOK={handleCanvasOK}
                onGetData={handleCanvasGetData}
                webStyle=".m-signature-pad--footer { display: none; margin: 0; }"
              />
            </View>
            {completeError ? (
              <Text style={styles.errorText} testID="direct-sign-signature-error">
                {completeError}
              </Text>
            ) : null}
            <View style={styles.signatureFooterRow}>
              <Pressable
                style={styles.clearLink}
                accessibilityRole="button"
                onPress={handleCanvasClear}
                testID="direct-sign-signature-clear"
              >
                <Text style={styles.clearLinkText}>{t('signature.clearCta')}</Text>
              </Pressable>
            </View>
            <Pressable
              style={[
                styles.primaryButton,
                canvasEmpty || completing ? styles.primaryButtonDisabled : null,
              ]}
              accessibilityRole="button"
              disabled={canvasEmpty || completing}
              onPress={handleCanvasConfirm}
              testID="direct-sign-signature-confirm"
            >
              {completing ? <ActivityIndicator size="small" color={colors.onAccent} /> : null}
              <Text style={styles.primaryButtonText}>
                {completing ? t('flowRunner.completing') : t('signature.completeContractCta')}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {/* The offer exit used to sit here as well as in the step header, so every
          screen of this path carried TWO identical "Angebot senden" chips — both
          with the same testID, which also meant a test could only ever find the
          first. The footer copy is the leftover: it predates the step header,
          and when the header gained the chip (to match the wizard, which has
          always had exactly one, top right) this one was never removed.
          One chip, in the same corner as the wizard's. */}
    </View>
  );
}

/**
 * The four block types a direct-sign flow may ask (flow-schema's
 * DIRECT_SIGN_QUESTION_BLOCK_TYPES). Each is the SAME component the wizard
 * renders — deliberately not a second set of question widgets, so a choice
 * looks and behaves identically in both flows.
 */
function renderQuestionBlock(
  block: Block,
  answers: Record<string, unknown>,
  onAnswer: (fieldId: string, value: unknown) => void,
) {
  switch (block.type) {
    case 'text':
      return (
        <TextBlock
          block={block}
          value={answers[block.id] as string | undefined}
          onAnswer={onAnswer}
        />
      );
    case 'choice':
      return (
        <ChoiceBlock
          block={block}
          value={answers[block.id] as string | undefined}
          onAnswer={onAnswer}
        />
      );
    case 'slider':
      return (
        <SliderBlock
          block={block}
          value={answers[block.id] as number | undefined}
          onAnswer={onAnswer}
        />
      );
    case 'contact':
      return (
        <ContactBlock
          block={block}
          value={answers[block.id] as string | undefined}
          onAnswer={onAnswer}
        />
      );
    case 'iban-scan':
      return (
        <IbanScanBlock
          block={block}
          value={answers[block.id] as string | undefined}
          onAnswer={onAnswer}
        />
      );
    default:
      // directSignQuestionBlocks already filtered these out; rendering nothing
      // is the honest fallback for a block type this screen cannot ask.
      return null;
  }
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
    stepHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.sm,
    },
    stepCounter: { ...typography.label, color: colors.textSecondary, fontWeight: '600' },
    progressBar: { flexDirection: 'row', gap: spacing.sm - 1, marginBottom: spacing.lg },
    progressSegment: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.subtleFill },
    progressSegmentDone: { backgroundColor: colors.pine },
    progressSegmentActive: { backgroundColor: colors.ink },
    // Top-aligned, like the wizard's blockArea. Centring made the identical
    // ChoiceBlock/TextBlock jump ~200px when a rep switched between the two
    // paths mid-day.
    questionArea: { flex: 1 },
    summaryCard: {
      gap: spacing.xs,
      padding: spacing.md,
      borderRadius: radius.input,
      borderWidth: 1.5,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surface,
    },
    summaryHeading: { ...typography.label, fontWeight: '600', color: colors.textPrimary },
    summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
    summaryLabel: { ...typography.label, color: colors.textSecondary, flexShrink: 1 },
    summaryValue: {
      ...typography.label,
      fontWeight: '600',
      color: colors.textPrimary,
      flexShrink: 1,
      textAlign: 'right',
    },
    stepArea: { flex: 1, gap: spacing.md },
    viewStepScroll: { flex: 1 },
    viewStepContent: { gap: spacing.md, paddingBottom: spacing.lg },
    heading: { ...typography.display, color: colors.textPrimary },
    hint: { ...typography.label, color: colors.textSecondary },
    errorText: { ...typography.body, color: colors.destructive, padding: spacing.lg },
    primaryButton: {
      minHeight: spacing.touchTarget,
      borderRadius: radius.button,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
    },
    primaryButtonDisabled: { backgroundColor: colors.subtleFill },
    // The label kept `onAccent` (#FFFFFF) on a 6%-ink fill over a near-white
    // background — about 1.05:1, i.e. invisible. A disabled control still has
    // to be readable, or the rep cannot tell WHICH button is waiting on them.
    primaryButtonTextDisabled: { color: colors.textMuted },
    primaryButtonText: { ...typography.body, fontWeight: '600', color: colors.onAccent },
    signatureArea: { flex: 1, gap: spacing.sm },
    canvasWrapper: {
      flex: 1,
      minHeight: spacing.touchTarget * 3,
      borderRadius: radius.card,
      overflow: 'hidden',
      backgroundColor: colors.surface,
    },
    signatureFooterRow: { flexDirection: 'row', justifyContent: 'flex-end' },
    clearLink: {
      minHeight: spacing.touchTarget,
      justifyContent: 'center',
      paddingHorizontal: spacing.sm,
    },
    clearLinkText: { ...typography.label, fontWeight: '600', color: colors.textSecondary },
    offerChip: {
      minHeight: spacing.touchTarget,
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
      marginTop: spacing.md,
      borderRadius: radius.input,
      borderWidth: 1.5,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surface,
    },
    offerChipText: { ...typography.label, fontWeight: '600', color: colors.textPrimary },
    // `container` already pads by spacing.lg — this only adds the scroll tail.
    offerScroll: { paddingBottom: spacing['2xl'], gap: spacing.md },
    offerCancel: {
      minHeight: spacing.touchTarget,
      alignItems: 'center',
      justifyContent: 'center',
    },
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
  });
}
