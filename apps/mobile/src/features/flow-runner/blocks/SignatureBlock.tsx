import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import SignatureCanvas, { type SignatureViewRef } from 'react-native-signature-canvas';
import type { SignatureBlock as SignatureBlockDef } from '@frontdoorsales/flow-schema';
import { radius, spacing, typography } from '../../../design/tokens';
import { ForceLightTheme } from '../../settings/theme/forceLightTheme';
import { useThemeColors } from '../../settings/theme/useThemeColors';
import { t } from '../../../i18n';
import {
  saveSignaturePng,
  type SignatureAttachmentQueue,
} from '../../../lib/db/attachments/signatureAttachments';
import { useHandoverSuspension } from '../../app-lock/autoLock/useIdleTimer';

/**
 * Signature block — real eIDAS-SES capture (SIGN-02/SIGN-03, D-16), replacing
 * the Phase-3 acknowledge-only placeholder. Frozen props (D-06) extended with
 * onSignatureCaptured (mirrors DiscountBlock's onSnapshotCaptured) — the
 * boolean gate answer via onAnswer stays untouched.
 *
 * `react-native-signature-canvas`'s canvas runs in an embedded WebView — both
 * `readSignature()`/`onOK` (PNG) and `getData()`/`onGetData` (stroke JSON) are
 * imperative-call + async-callback round trips, NOT synchronous returns
 * (04-STROKE-SPIKE.md corrects 04-RESEARCH.md's illustrative `toData()` call).
 */

export interface SignatureCapturePayload {
  signatureAttachmentId: string;
  strokeData: unknown[];
}

export interface SignatureBlockProps {
  block: SignatureBlockDef;
  value: boolean | undefined;
  onAnswer: (fieldId: string, value: boolean) => void | Promise<void>;
  /** Mirrors DiscountBlock.onSnapshotCaptured — emits the audit-package inputs for FlowRunnerScreen to hold. */
  onSignatureCaptured: (payload: SignatureCapturePayload) => void;
  /** Attachment queue instance (createSignatureAttachmentQueue) — provided by FlowRunnerScreen. */
  queue: SignatureAttachmentQueue;
  customerName: string;
  productName: string;
  price: number;
  /** Design 08: signing is a full-screen ACTION — reported true so the shell
   *  hides its step chrome (no "Schritt X von Y", no progress bar, no footer). */
  onImmersiveChange?: (immersive: boolean) => void;
  /** Back tile → step back off the signature screen. */
  onCancel?: () => void;
  /** Shell is finalizing the contract (post-capture) — spin the CTA in place. */
  completing?: boolean;
  /** Finalize failure surfaced inline (the shell footer is hidden here). */
  completeError?: string | null;
}

const DATA_URL_PREFIX_RE = /^data:image\/\w+;base64,/;

/** Strips a `data:image/png;base64,` prefix if present — the queue's local storage adapter expects a bare base64 string. */
export function stripDataUrlPrefix(pngDataUrl: string): string {
  return pngDataUrl.replace(DATA_URL_PREFIX_RE, '');
}

/**
 * Parses `onGetData`'s JSON string into the verbatim point-group array
 * (04-STROKE-SPIKE.md's frozen shape) — never re-derived/re-shaped by hand.
 */
export function parseStrokeData(json: string): unknown[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error('getData() JSON did not parse to an array of point-groups');
  }
  return parsed;
}

function formatPrice(value: number): string {
  return `${value.toFixed(2).replace('.', ',')} €`;
}

/**
 * SET-05 hard exception (12-UI-SPEC.md § Theme resolution model): a
 * signature captured on a dark canvas is an evidence problem — the audit
 * package and rendered contract PDF must show ink-on-white regardless of the
 * rep's theme. `ForceLightTheme` wraps the WHOLE content subtree (never a
 * per-screen dark-scheme conditional branch, which is easy to forget), so
 * `useThemeColors()` inside `SignatureBlockContent` always resolves the
 * light palette — proven directly against `resolveThemeColors` in
 * `SignatureBlock.test.tsx` (T-12-12-01).
 */
export function SignatureBlock(props: SignatureBlockProps) {
  return (
    <ForceLightTheme>
      <SignatureBlockContent {...props} />
    </ForceLightTheme>
  );
}

function SignatureBlockContent({
  block,
  value,
  onAnswer,
  onSignatureCaptured,
  queue,
  customerName,
  productName,
  price,
  onImmersiveChange,
  onCancel,
  completing = false,
  completeError = null,
}: SignatureBlockProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const acknowledged = value === true;
  // 15-07 (D-07): registers this screen as the customer-handover surface for
  // the WHOLE lifetime it is mounted — mount registers, unmount (back tile,
  // app switch, or the step advancing past signing) clears, which is exactly
  // when the D-07 idle-timeout suspension must end. `warningVisible` drives
  // ONLY the informational heads-up line below; there is no "extend" action
  // anywhere in this file (UI-SPEC §3, D-08's unconditional cap).
  const { warningVisible } = useHandoverSuspension();
  const [isEmpty, setIsEmpty] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const signatureRef = useRef<SignatureViewRef>(null);
  const pendingAttachmentId = useRef<string | null>(null);

  // Design 08: the signature owns the whole screen — tell the shell to drop
  // its step chrome for the lifetime of this block (restored on unmount).
  useLayoutEffect(() => {
    onImmersiveChange?.(true);
    return () => onImmersiveChange?.(false);
  }, [onImmersiveChange]);

  // One CTA that captures then (via the shell) finalizes — busy through both.
  const busy = isSaving || completing;

  const handleBegin = () => setIsEmpty(false);
  const handleEmpty = () => {
    // Defensive: readSignature() on a truly empty canvas reports onEmpty
    // instead of onOK — confirm is disabled while empty so this should not
    // normally fire, but never leave isSaving stuck true if it does.
    setIsEmpty(true);
    setIsSaving(false);
  };

  const handleClear = () => {
    signatureRef.current?.clearSignature();
    setIsEmpty(true);
    setIsSaving(false);
    setSaveError(null);
    pendingAttachmentId.current = null;
  };

  const handleOK = (pngDataUrl: string) => {
    void (async () => {
      try {
        setSaveError(null);
        const attachmentId = await saveSignaturePng(queue, stripDataUrlPrefix(pngDataUrl));
        pendingAttachmentId.current = attachmentId;
        signatureRef.current?.getData();
      } catch {
        // WR-01: never leave isSaving stuck true — re-enable Confirm and
        // surface a retry-safe inline error instead of blocking signing forever.
        pendingAttachmentId.current = null;
        setIsSaving(false);
        setSaveError(t('signature.saveError'));
      }
    })();
  };

  const handleGetData = (json: string) => {
    void (async () => {
      try {
        const attachmentId = pendingAttachmentId.current;
        if (!attachmentId) return;
        const strokeData = parseStrokeData(json);
        onSignatureCaptured({ signatureAttachmentId: attachmentId, strokeData });
        await onAnswer(block.id, true);
        setIsSaving(false);
      } catch {
        // WR-01: malformed getData() JSON or a failing onAnswer must not
        // leave isSaving stuck true — reset and let the rep retry.
        pendingAttachmentId.current = null;
        setIsSaving(false);
        setSaveError(t('signature.saveError'));
      }
    })();
  };

  const handleConfirm = () => {
    if (isEmpty || busy) return;
    setIsSaving(true);
    signatureRef.current?.readSignature();
  };

  return (
    <View style={styles.container}>
      {/* Design 08 header: a back tile (left) then the two-line title — no
          step counter / progress bar (this is an action, not a step). */}
      <View style={styles.header}>
        <Pressable
          style={styles.backTile}
          accessibilityRole="button"
          accessibilityLabel={t('flowRunner.back')}
          onPress={() => onCancel?.()}
          testID={`signature-back-${block.id}`}
        >
          <MaterialCommunityIcons name="chevron-left" size={24} color={colors.onAccent} />
        </Pressable>
        <View style={styles.heading}>
          <Text style={styles.headingText}>{t('signature.handoverHeading')}</Text>
          <Text style={styles.headingSub}>{t('signature.subheading')}</Text>
        </View>
      </View>

      {/* 15-UI-SPEC.md §3 (D-07/D-08): the single-line, non-alarming
          heads-up — rep-facing chrome ABOVE the summary/canvas, never inside
          the canvas, never overlapping anything the customer touches.
          Invisible for the first ~8 minutes; no icon; no color escalation;
          no button — the D-08 cap is unconditional and offering a way to
          push it later would misrepresent that. */}
      {warningVisible ? (
        <Text style={styles.handoverTimeoutWarning} testID={`signature-handover-warning-${block.id}`}>
          {t('sec.handoverTimeoutWarning')}
        </Text>
      ) : null}

      {/* Design 08: handover summary on the dark surface — Kunde / Tarif /
          Monatlich (the amber price), stacked rows above the signature field. */}
      <View style={styles.summaryCard} testID={`signature-summary-${block.id}`}>
        <View style={[styles.summaryRow, styles.summaryRowDivider]}>
          <Text style={styles.summaryLabel}>{t('signature.summaryCustomerLabel')}</Text>
          <Text style={styles.summaryValue}>{customerName}</Text>
        </View>
        <View style={[styles.summaryRow, styles.summaryRowDivider]}>
          <Text style={styles.summaryLabel}>{t('signature.summaryTariffLabel')}</Text>
          <Text style={styles.summaryValue}>{productName}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>{t('signature.summaryMonthlyLabel')}</Text>
          <Text style={styles.summaryPrice}>{formatPrice(price)}</Text>
        </View>
      </View>

      {/* White signature card: label, canvas, then a dashed footer with the
          mono capture-meta line (left) and the Löschen affordance (right). */}
      <View style={styles.signatureCard}>
        <Text style={styles.canvasLabel}>{t('signature.canvasLabel')}</Text>
        <View style={styles.canvasWrapper} testID={`signature-canvas-${block.id}`}>
          <SignatureCanvas
            ref={signatureRef}
            onBegin={handleBegin}
            onEmpty={handleEmpty}
            onOK={handleOK}
            onGetData={handleGetData}
            webStyle=".m-signature-pad--footer { display: none; margin: 0; }"
          />
        </View>
        <View style={styles.canvasFooter}>
          <Text style={styles.metaText} numberOfLines={1}>
            {t('signature.captureMetaHint')}
          </Text>
          <Pressable style={styles.clearLink} accessibilityRole="button" onPress={handleClear}>
            <Text style={styles.clearLinkText}>{t('signature.clearCta')}</Text>
          </Pressable>
        </View>
      </View>

      {saveError || completeError ? (
        <Text style={styles.errorText} testID={`signature-error-${block.id}`}>
          {saveError ?? completeError}
        </Text>
      ) : null}

      {/* Design 08: ONE amber CTA. It captures the signature; the shell then
          finalizes the contract automatically (spinner runs through both). */}
      <Pressable
        style={[
          styles.confirmButton,
          isEmpty || busy || (acknowledged && !completeError) ? styles.confirmButtonDisabled : null,
        ]}
        accessibilityRole="button"
        disabled={isEmpty || busy || (acknowledged && !completeError)}
        onPress={handleConfirm}
      >
        {busy ? <ActivityIndicator size="small" color={colors.onAccent} /> : null}
        <Text style={styles.confirmButtonText}>
          {completing ? t('flowRunner.completing') : t('signature.completeContractCta')}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * `colors` here is always `lightColors` (the `ForceLightTheme` wrapper
 * above), so this factory never needs a dark-branch — but it still goes
 * through `useThemeColors()`/`makeStyles(colors)` like every other migrated
 * block rather than importing `lightColors` directly, so a future reader
 * cannot mistake this for an accidental omission of the theme hook.
 */
function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    // Design 08: dark handover surface that OWNS the full screen (the shell
    // hides its step chrome while signing). No card radius; top inset clears
    // the status bar/notch now that nothing sits above it.
    container: {
      flex: 1,
      backgroundColor: colors.ink,
      paddingHorizontal: spacing.lg - 4,
      paddingTop: spacing['2xl'],
      paddingBottom: spacing.lg - 4,
    },
    // Design 08 header: back tile (left) + two-line title.
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      marginBottom: spacing.lg - 2,
    },
    backTile: {
      width: spacing.touchTarget,
      height: spacing.touchTarget,
      borderRadius: radius.md,
      backgroundColor: 'rgba(255,255,255,0.12)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    heading: { flexShrink: 1 },
    headingText: { ...typography.heading, color: colors.onAccent },
    headingSub: { ...typography.label, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
    // 15-UI-SPEC.md §3 (D-07/D-08): colors.textSecondary/typography.label
    // exactly as specified — no icon, no color escalation, deliberately no
    // button style exists to pair with this text.
    handoverTimeoutWarning: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.sm },
    summaryCard: {
      backgroundColor: 'rgba(255,255,255,0.07)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.14)',
      borderRadius: radius.card,
      paddingHorizontal: spacing.md + 2,
      paddingVertical: spacing.xs,
      marginBottom: spacing.lg - 2,
    },
    summaryRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      paddingVertical: spacing.sm + 2,
    },
    summaryRowDivider: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.12)' },
    summaryLabel: { ...typography.label, color: 'rgba(255,255,255,0.6)' },
    summaryValue: {
      ...typography.label,
      fontWeight: '600',
      color: colors.onAccent,
      flexShrink: 1,
      textAlign: 'right',
    },
    summaryPrice: { ...typography.price, color: colors.accentOnDark },
    signatureCard: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: radius.card,
      padding: spacing.md + 2,
      marginBottom: spacing.lg - 2,
    },
    canvasLabel: { ...typography.label, fontWeight: '500', color: colors.textSecondary },
    canvasWrapper: {
      flex: 1,
      minHeight: spacing.touchTarget * 3,
      overflow: 'hidden',
      backgroundColor: colors.surface,
    },
    canvasFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderTopWidth: 1.5,
      borderTopColor: 'rgba(18,32,58,0.2)',
      borderStyle: 'dashed',
      paddingTop: spacing.sm + 2,
    },
    metaText: {
      ...typography.mono,
      color: colors.textSecondary,
      flexShrink: 1,
      marginRight: spacing.sm,
    },
    clearLink: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs + 1,
      minHeight: spacing.touchTarget,
      paddingHorizontal: spacing.sm,
    },
    clearLinkText: { ...typography.label, fontWeight: '600', color: colors.textSecondary },
    confirmButton: {
      minHeight: 58,
      flexDirection: 'row',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      backgroundColor: colors.accent,
      borderRadius: radius.button,
      alignItems: 'center',
      justifyContent: 'center',
      // ponytail: glow removed (accent-tinted shadow = halo). The accent
      // fill already carries the state; the shadow only added a bloom.
    },
    confirmButtonDisabled: { backgroundColor: 'rgba(255,255,255,0.14)', shadowOpacity: 0 },
    confirmButtonText: { fontSize: 18, fontWeight: '600', color: colors.onAccent },
    errorText: { ...typography.label, color: colors.accentOnDark, marginBottom: spacing.sm },
  });
}
