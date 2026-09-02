import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps, ComponentType } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Camera as OcrCamera } from 'react-native-vision-camera-ocr-plus';

// ocr-plus's published types omit `style`, but its Camera spreads all extra
// props onto the underlying VisionCamera view (verified in lib/commonjs/
// Camera.js: `createElement(NativeCamera, { ...p, ... })`). Without an
// explicit style the native view lays out at 0x0 — a black preview on
// device. Same type-declaration-gap workaround as IdScanBlock.tsx.
type OcrCameraProps = ComponentProps<typeof OcrCamera> & {
  style?: StyleProp<ViewStyle>;
};
const TypedOcrCamera = OcrCamera as unknown as ComponentType<OcrCameraProps>;
import { isValidIBAN } from 'ibantools';
import type { IbanScanBlock as IbanScanBlockDef } from '@frontdoorsales/flow-schema';
import { radius, spacing, statusColor, typography } from '../../../design/tokens';
import { ForceLightTheme } from '../../settings/theme/forceLightTheme';
import { useThemeColors } from '../../settings/theme/useThemeColors';
import { t } from '../../../i18n';
import { FieldBlankedForRecording } from '../../app-lock/screenProtection/FieldBlankedForRecording';
import { useSensitiveScreen } from '../../app-lock/screenProtection/sensitiveScreen';
import {
  type RecordingState,
  shouldBlankField,
  useRecordingDetection,
} from '../../app-lock/screenProtection/useRecordingDetection';
import { useIbanScan } from '../scan/useIbanScan';
import {
  buildScanTelemetryEvent,
  recordScanTelemetry,
  type ScanOutcome,
  type ScanTelemetryRepoLike,
} from '../scan/scanTelemetry';

export interface IbanScanBlockProps {
  block: IbanScanBlockDef;
  value: string | undefined;
  /** `null` when the step was skipped (only possible when `block.optional`).
   * Never an empty string — that would read as a captured IBAN downstream. */
  onAnswer: (fieldId: string, value: string | null) => void | Promise<void>;
  /** Camera capture is a full-screen ACTION, not a step (design 06 camera):
   *  reported true while the live camera is up so the shell hides its step
   *  chrome, false once we hit the confirm/manual input (a real step). */
  onImmersiveChange?: (immersive: boolean) => void;
  /** X-cancel from the camera surface: abandons the scan action and steps back. */
  onCancel?: () => void;
}

export interface IbanValidationResult {
  valid: boolean;
  normalized: string;
}

/**
 * Normalizes manual IBAN entry (strips whitespace, uppercases) and
 * checksum-validates via `ibantools.isValidIBAN` (D-06/CHKT-03) — no
 * hand-rolled mod-97 checksum logic. The SAME function is called for both
 * the camera-scan confirm path and the manual-entry path (CHKT-03).
 */
export function validateIban(rawIban: string): IbanValidationResult {
  const normalized = rawIban.replace(/\s+/g, '').toUpperCase();
  return { valid: isValidIBAN(normalized), normalized };
}

/**
 * Presentation-only IBAN mask (design 06: "DE44 •••• •••• •••• •••• 31") —
 * shows the country/check prefix and the last two digits, dotting the middle.
 * Never used for validation or the persisted answer; a too-short draft is
 * returned verbatim so nothing is hidden that could not be revealed.
 */
export function maskIban(rawIban: string): string {
  const normalized = rawIban.replace(/\s+/g, '').toUpperCase();
  if (normalized.length < 6) return normalized;
  return `${normalized.slice(0, 4)} •••• •••• •••• •••• ${normalized.slice(-2)}`;
}

/** One IBAN-scan-session telemetry event (CHKT-04) — DI'd for testability without a device (no react-test-renderer in this repo, mirrors scanTelemetry.ts's own pure/DI style). */
export interface RecordIbanScanTelemetryParams {
  telemetryRepo: ScanTelemetryRepoLike;
  outcome: ScanOutcome;
  startedAt: number;
  endedAt: number;
  deviceModel: string;
  appVersion: string;
  createdBy: string;
  teamId: string;
}

/**
 * Records exactly one CHKT-04 telemetry event for a completed IBAN-scan
 * session — best-effort (never blocks/throws, delegated to
 * `recordScanTelemetry`). Exported separately from the component so the
 * per-outcome recording behavior is directly unit-testable via an injected
 * fake repo.
 */
export async function recordIbanScanTelemetry(
  params: RecordIbanScanTelemetryParams,
): Promise<void> {
  const { telemetryRepo, outcome, startedAt, endedAt, deviceModel, appVersion, createdBy, teamId } =
    params;
  const event = buildScanTelemetryEvent({
    scanType: 'iban',
    outcome,
    startedAt,
    endedAt,
    deviceModel,
    appVersion,
    createdBy,
    teamId,
  });
  await recordScanTelemetry(telemetryRepo, event);
}

/**
 * Production wiring for `recordIbanScanTelemetry`'s context: the real local
 * PowerSync db (singleton), the authenticated rep's id, their currently
 * locked territory's team (same `locked_by === userId` match MapScreen uses
 * to find "own territory"), and the device model/app version. Every step is
 * wrapped so a missing session/db/territory degrades to `null` (telemetry is
 * best-effort field-test tooling, D-14 — it must NEVER block the scan flow
 * or a close). Resolved via dynamic import so this native-module-touching
 * path is never hit at test time (IbanScanBlock.test.tsx never renders the
 * component, matching this repo's no-react-test-renderer precedent).
 */
async function resolveTelemetryContext(): Promise<{
  telemetryRepo: ScanTelemetryRepoLike;
  createdBy: string;
  teamId: string;
  deviceModel: string;
  appVersion: string;
} | null> {
  try {
    const [{ openDatabase }, { getSupabase }, { createScanTelemetryRepo }, Device, Application] =
      await Promise.all([
        import('../../../lib/db/powersync'),
        import('../../../lib/auth/supabase'),
        import('../db/scanTelemetryRepo'),
        import('expo-device'),
        import('expo-application'),
      ]);

    const db = await openDatabase();
    const { data } = await getSupabase().auth.getSession();
    const createdBy = data.session?.user.id;
    if (!createdBy) {
      return null;
    }

    const territoryRow = await db
      .getOptional<{ team_id: string }>(
        'SELECT team_id FROM territories WHERE locked_by = ? LIMIT 1',
        [createdBy],
      )
      .catch(() => null);
    const teamId = territoryRow?.team_id;
    if (!teamId) {
      return null;
    }

    return {
      telemetryRepo: createScanTelemetryRepo({ db }),
      createdBy,
      teamId,
      deviceModel: Device.modelName ?? 'unknown',
      appVersion: Application.nativeApplicationVersion ?? 'unknown',
    };
  } catch {
    return null;
  }
}

/** Best-effort session-end recorder: resolves real production context, then delegates to `recordIbanScanTelemetry`. Swallows every failure (never blocks the scan/manual/close flow). */
async function recordSessionOutcome(outcome: ScanOutcome, startedAt: number): Promise<void> {
  const context = await resolveTelemetryContext();
  if (!context) {
    return;
  }
  await recordIbanScanTelemetry({ ...context, outcome, startedAt, endedAt: Date.now() }).catch(
    () => {
      // Best-effort (D-14) — already logged inside recordScanTelemetry; never rethrow.
    },
  );
}

type IbanScanScreenState = 'scanning' | 'confirm' | 'manual';

/**
 * IBAN scan block — real camera scan (useIbanScan + ML Kit OCR via
 * react-native-vision-camera-ocr-plus) with a checksum-valid-read confirm
 * screen (D-08) and an always-visible manual-entry fallback (D-06). Both
 * paths converge on the SAME `validateIban` checksum and the SAME normalized
 * answer shape (CHKT-03). No IBAN image is retained (T-04-16/T-04-14) — no
 * attachment-queue or photo-album save call is made anywhere in this file.
 */
/**
 * SET-05 hard exception (12-UI-SPEC.md § Theme resolution model): a dark
 * chrome around a live camera preview changes what the OCR sees and what
 * the rep can verify. `ForceLightTheme` wraps the WHOLE content subtree
 * (scanning/confirm/manual — never a per-screen dark-scheme conditional
 * branch), so `useThemeColors()` inside `IbanScanBlockContent` always
 * resolves the light palette — proven directly against `resolveThemeColors`
 * in `IbanScanBlock.test.tsx` (T-12-12-02).
 */
export function IbanScanBlock(props: IbanScanBlockProps) {
  return (
    <ForceLightTheme>
      <IbanScanBlockContent {...props} />
    </ForceLightTheme>
  );
}

export interface IbanConfirmScreenProps {
  block: IbanScanBlockDef;
  colors: ReturnType<typeof useThemeColors>;
  styles: ReturnType<typeof makeStyles>;
  recordingState: RecordingState;
  confirmDraft: string;
  ibanRevealed: boolean;
  onChangeConfirmDraft: (next: string) => void;
  onToggleReveal: () => void;
  onRescan: () => void;
  onConfirm: () => void;
}

/**
 * D-14b (SEC-05, plan 15-09): the confirm-screen JSX, pulled out into a
 * standalone HOOKLESS component so it is directly invocable in tests (no
 * react-native-testing-library in this repo — mirrors
 * `FieldBlankedForRecording.tsx`'s DI convention and `IdScanBlock.tsx`'s
 * own `IdConfirmScreen` split). Everything it needs arrives as props from
 * `IbanScanBlockContent`'s own hook-backed state; this component owns no
 * state and calls no hook.
 *
 * The ONLY thing D-14b changes here is the IBAN-value row: while
 * `shouldBlankField(recordingState)` is true, `FieldBlankedForRecording`
 * REPLACES both the masked-text box AND the reveal-toggle editable input
 * outright (never an overlay — no IBAN-derived text is mounted underneath).
 * The "gescanntes Bild" preview badge above it carries no real account data
 * (it is a static placeholder, per its own header comment) and is left
 * untouched. Every other element (account holder/bank placeholders, rescan,
 * confirm, the encrypted-storage hint) is unconditional on `recordingState`
 * — a recording never blocks the rep from finishing the step (T-15-09-04).
 */
export function IbanConfirmScreen({
  block,
  colors,
  styles,
  recordingState,
  confirmDraft,
  ibanRevealed,
  onChangeConfirmDraft,
  onToggleReveal,
  onRescan,
  onConfirm,
}: IbanConfirmScreenProps) {
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.confirmScroll}>
      <View style={styles.bankHeader}>
        <Text style={styles.bankHeading}>{t('checkout.bankHeading')}</Text>
      </View>

      {/* Design 06: the frozen "gescanntes Bild" preview with a green
          "Erkannt" badge. The scan image itself is never retained
          (T-04-16) — this is a diagonal-striped placeholder standing in for
          the transient captured frame, not a stored asset. No real account
          data lives here, so D-14b does not blank it. */}
      <View style={styles.scanPreview}>
        <View style={styles.recognizedBadge}>
          <MaterialCommunityIcons name="check" size={13} color={colors.onAccent} />
          <Text style={styles.recognizedBadgeText}>{t('checkout.ibanRecognizedBadge')}</Text>
        </View>
        <View style={styles.scanPreviewTag}>
          <Text style={styles.scanPreviewTagText}>{t('checkout.ibanScannedImageTag')}</Text>
        </View>
      </View>
      <Text style={styles.confirmHint}>{t('checkout.ibanConfirmHint')}</Text>

      <Text style={styles.fieldLabel}>{t('checkout.ibanFieldLabel')}</Text>
      <View style={styles.ibanRow}>
        {shouldBlankField(recordingState) ? (
          <FieldBlankedForRecording colors={colors} testID={`iban-blanked-${block.id}`} />
        ) : ibanRevealed ? (
          <TextInput
            style={[styles.fieldBox, styles.ibanInput]}
            value={confirmDraft}
            autoCapitalize="characters"
            onChangeText={onChangeConfirmDraft}
            autoFocus
            testID={`iban-confirm-input-${block.id}`}
          />
        ) : (
          <View style={[styles.fieldBox, styles.ibanMaskBox]}>
            <Text style={styles.ibanMaskText} numberOfLines={1}>
              {maskIban(confirmDraft)}
            </Text>
          </View>
        )}
        {shouldBlankField(recordingState) ? null : (
          <Pressable
            style={styles.revealButton}
            accessibilityRole="button"
            onPress={onToggleReveal}
            testID={`iban-reveal-${block.id}`}
          >
            <Text style={styles.revealButtonText}>
              {ibanRevealed ? t('checkout.ibanHideCta') : t('checkout.ibanRevealCta')}
            </Text>
          </Pressable>
        )}
      </View>

      {/* Kontoinhaber / Bank are shown for parity with the design's
          "gemeinsam prüfen" review, but the block's captured/validated answer
          is the IBAN alone (CHKT-03) — these rows are presentational and are
          never written to onAnswer. */}
      <Text style={styles.fieldLabel}>{t('checkout.accountHolderLabel')}</Text>
      <View style={styles.fieldBox} />

      <Text style={styles.fieldLabel}>
        {t('checkout.bankLabel')}{' '}
        <Text style={styles.checkSuffix}>{t('checkout.bankCheckSuffix')}</Text>
      </Text>
      <View style={[styles.fieldBox, styles.fieldBoxCheck]} />

      <View style={styles.confirmRow}>
        <Pressable
          style={[styles.footerButton, styles.secondaryButton]}
          accessibilityRole="button"
          onPress={onRescan}
          testID={`iban-rescan-${block.id}`}
        >
          <Text style={styles.secondaryButtonText}>{t('checkout.rescanCta')}</Text>
        </Pressable>
        <Pressable
          style={[styles.footerButton, styles.nextButton]}
          accessibilityRole="button"
          onPress={onConfirm}
          testID={`iban-confirm-accept-${block.id}`}
        >
          <Text style={styles.nextButtonText}>{t('checkout.ibanConfirmCta')}</Text>
        </Pressable>
      </View>
      {/* The "IBAN wird verschlüsselt gespeichert und erst beim Sync
          übertragen. Prüfsumme lokal validiert." hint used to sit here,
          unconditionally. It described internal mechanics a rep can neither
          act on nor change, on the screen where they are trying to finish a
          bank detail with a customer watching — and it asserted "erst beim
          Sync" on a device that is usually online and syncing immediately.
          Removed rather than made conditional: there is no state in which it
          tells anyone something they can use. */}
    </ScrollView>
  );
}

function IbanScanBlockContent({
  block,
  value,
  onAnswer,
  onImmersiveChange,
  onCancel,
}: IbanScanBlockProps) {
  const colors = useThemeColors();
  useSensitiveScreen('iban'); // D-14c (SEC-05, 15-08): registers this IBAN surface for the silent screenshot listener.
  const recordingState = useRecordingDetection(); // D-14b (SEC-05, 15-09): drives the confirm screen's IBAN-value blanking.
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const {
    device,
    hasPermission,
    permissionDenied,
    handleRecognizedText,
    validIban,
    lastCandidate,
    resetValidIban,
  } = useIbanScan();

  const [screen, setScreen] = useState<IbanScanScreenState>(
    permissionDenied ? 'manual' : 'scanning',
  );
  const [confirmDraft, setConfirmDraft] = useState('');
  const [manualDraft, setManualDraft] = useState(value ?? '');
  const [manualError, setManualError] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  // Presentation-only (design 06): the IBAN reads masked until "Anzeigen" is
  // tapped, then becomes the editable field. Never touches confirmDraft/
  // validation — purely a reveal toggle.
  const [ibanRevealed, setIbanRevealed] = useState(false);

  const sessionStartedAt = useRef(Date.now());
  const sessionRecorded = useRef(false);
  // OcrCamera forwards an `any`-typed ref to the underlying CameraController
  // (react-native-vision-camera v5's torch control is imperative, not a
  // declarative prop) — guarded so a missing/unsupported controller method
  // never throws (device torch support varies, D-23 viewfinder scope).
  const cameraRef = useRef<{ setTorchMode?: (mode: 'on' | 'off') => void } | null>(null);

  // D-08: camera permission denied redirects straight to manual entry.
  useEffect(() => {
    if (permissionDenied && screen === 'scanning') {
      setScreen('manual');
    }
  }, [permissionDenied, screen]);

  // A checksum-valid camera read advances scanning -> confirm (D-08 mirrors the ID pattern).
  useEffect(() => {
    if (validIban && screen === 'scanning') {
      setConfirmDraft(validIban);
      setScreen('confirm');
    }
  }, [validIban, screen]);

  // The full-screen camera action (design 06 camera) shows ONLY when scanning
  // with a resolved device; confirm/manual (and scanning w/o a camera, which
  // falls back to the manual input) are step screens. Layout effect so the
  // shell drops/restores its chrome before paint; cleanup restores on unmount.
  const cameraActive = screen === 'scanning' && !!device;
  useLayoutEffect(() => {
    onImmersiveChange?.(cameraActive);
    return () => onImmersiveChange?.(false);
  }, [cameraActive, onImmersiveChange]);

  const recordOnce = useCallback((outcome: ScanOutcome) => {
    if (sessionRecorded.current) {
      return;
    }
    sessionRecorded.current = true;
    void recordSessionOutcome(outcome, sessionStartedAt.current);
  }, []);

  // Session ends (component unmounts without an explicit accept) — record 'aborted' at most once.
  useEffect(() => {
    return () => recordOnce('aborted');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGoManual = useCallback(() => {
    resetValidIban();
    setScreen('manual');
  }, [resetValidIban]);

  const handleRescan = useCallback(() => {
    resetValidIban();
    setConfirmDraft('');
    setScreen('scanning');
  }, [resetValidIban]);

  const handleConfirmAccept = useCallback(() => {
    const { valid, normalized } = validateIban(confirmDraft);
    if (!valid) {
      // The confirm screen's field stays editable — an invalid edit simply
      // does not advance; no attempt-counting/blocking modal (D-06).
      return;
    }
    recordOnce('scan_success');
    void onAnswer(block.id, normalized);
  }, [block.id, confirmDraft, onAnswer, recordOnce]);

  const handleManualChangeText = useCallback((next: string) => {
    setManualDraft(next);
    setManualError(null);
  }, []);

  const handleManualAccept = useCallback(() => {
    const { valid, normalized } = validateIban(manualDraft);
    if (!valid) {
      setManualError(t('flowRunner.ibanInvalid'));
      return;
    }
    setManualError(null);
    recordOnce('manual_fallback');
    void onAnswer(block.id, normalized);
  }, [block.id, manualDraft, onAnswer, recordOnce]);

  /**
   * Leave the step without an IBAN, when the product allows it
   * (`block.optional`). Answers with an EMPTY STRING is exactly what this must
   * not do — '' reads as a captured IBAN to the review list, the contract row
   * and the mandate. `null` is the value that says nothing was collected.
   */
  const handleSkip = useCallback(() => {
    // No telemetry row: scan_telemetry records SCAN outcomes, and a skip is the
    // absence of one. Adding a value to that enum means a migration and a CHECK
    // change for a number nobody is asking for yet.
    void onAnswer(block.id, null);
  }, [block.id, onAnswer]);

  const handleToggleTorch = useCallback(() => {
    setTorchOn((prev) => {
      const next = !prev;
      try {
        // setTorchMode is async under the hood (CameraX setTorchAsync) and
        // rejects with "Camera is not active" during view transitions — a
        // sync try/catch alone lets that rejection escape as an unhandled
        // promise error on device.
        void Promise.resolve(cameraRef.current?.setTorchMode?.(next ? 'on' : 'off')).catch(
          () => {},
        );
      } catch {
        // Torch unsupported on this device — the icon still reflects intent,
        // no crash (D-23 viewfinder scope is best-effort, not guaranteed).
      }
      return next;
    });
  }, []);

  if (screen === 'confirm') {
    return (
      <IbanConfirmScreen
        block={block}
        colors={colors}
        styles={styles}
        recordingState={recordingState}
        confirmDraft={confirmDraft}
        ibanRevealed={ibanRevealed}
        onChangeConfirmDraft={setConfirmDraft}
        onToggleReveal={() => setIbanRevealed((prev) => !prev)}
        onRescan={handleRescan}
        onConfirm={handleConfirmAccept}
      />
    );
  }

  if (screen === 'scanning' && device) {
    // Design 06 camera: a dark full-screen ACTION (the shell hides its step
    // chrome). Header = X-cancel (left) / title / torch (right); a camera
    // action has no step "Back", it has a close.
    return (
      <View style={styles.scanScreen} testID={`iban-camera-${block.id}`}>
        <View style={styles.scanHeader}>
          <Pressable
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel={t('cta.cancel')}
            onPress={() => onCancel?.()}
            testID={`iban-scan-cancel-${block.id}`}
          >
            <MaterialCommunityIcons name="close" size={22} color={colors.onAccent} />
          </Pressable>
          <Text style={styles.scanHeaderTitle}>{t('checkout.ibanScanTitle')}</Text>
          <Pressable
            style={[styles.headerButton, torchOn ? styles.headerButtonOn : null]}
            accessibilityRole="button"
            accessibilityLabel={t('checkout.torchToggleLabel')}
            onPress={handleToggleTorch}
            testID={`iban-torch-${block.id}`}
          >
            <MaterialCommunityIcons
              name={torchOn ? 'flash' : 'flash-off'}
              size={22}
              color={colors.onAccent}
            />
          </Pressable>
        </View>

        <View style={styles.scanBody}>
          {/* Fixed camera-box geometry is intentionally unchanged (Android
              SurfaceView positioning fix, device-pass). No guide box: ML Kit
              reads the FULL frame — a narrow "target strip" suggested a crop
              that never existed and made users frame worse. */}
          <View style={styles.cameraContainer}>
            <TypedOcrCamera
              ref={cameraRef}
              style={styles.camera}
              device={device}
              isActive={hasPermission}
              mode="recognize"
              options={{ language: 'latin', frameSkipThreshold: 3 }}
              callback={handleRecognizedText}
            />
            <View style={styles.scanningRow} testID={`iban-scanning-indicator-${block.id}`}>
              <ActivityIndicator size="small" color={colors.onAccent} />
              <Text style={styles.scanningHint}>
                {lastCandidate
                  ? t('checkout.ibanScanCandidateHint').replace('{candidate}', lastCandidate)
                  : t('checkout.ibanScanActiveHint')}
              </Text>
            </View>
          </View>
        </View>

        <Pressable
          style={styles.manualButton}
          accessibilityRole="button"
          onPress={handleGoManual}
          testID={`iban-manual-entry-${block.id}`}
        >
          <Text style={styles.manualButtonText}>{t('checkout.manualEntryCta')}</Text>
        </Pressable>
      </View>
    );
  }

  // 'manual' screen, OR 'scanning' with no resolved camera device yet — the
  // manual TextInput fallback is always reachable, never a dead end (D-06/D-08).
  return (
    // The block forces the LIGHT palette (SET-05, so the camera chrome does not
    // change what the OCR sees) but drew no background of its own — so
    // light-palette ink landed on the dark screen behind it: dark blue on dark
    // blue. The forced theme has to bring its own surface with it.
    <View style={styles.forcedLightSurface}>
      <Text style={styles.label}>{block.label}</Text>
      {permissionDenied ? (
        <Text style={styles.helpText} testID={`iban-permission-denied-${block.id}`}>
          {t('errorState.cameraPermissionDenied')}
        </Text>
      ) : null}
      <TextInput
        style={styles.input}
        value={manualDraft}
        autoCapitalize="characters"
        onChangeText={handleManualChangeText}
        testID={`iban-input-${block.id}`}
      />
      {manualError ? (
        <Text style={styles.error} testID={`iban-error-${block.id}`}>
          {manualError}
        </Text>
      ) : null}
      <Pressable
        style={styles.nextButton}
        accessibilityRole="button"
        onPress={handleManualAccept}
        testID={`iban-manual-accept-${block.id}`}
      >
        <Text style={styles.nextButtonText}>{t('flowRunner.next')}</Text>
      </Pressable>
      {block.optional ? (
        <Pressable
          style={styles.skipButton}
          accessibilityRole="button"
          onPress={handleSkip}
          testID={`iban-skip-${block.id}`}
        >
          <Text style={styles.skipButtonText}>{t('flowRunner.ibanSkip')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    forcedLightSurface: {
      backgroundColor: colors.background,
      borderRadius: radius.card,
      padding: spacing.md,
      margin: -spacing.md,
    },
    label: { ...typography.display, color: colors.textPrimary, marginBottom: spacing.lg },
    // Quiet on purpose: skipping is a legitimate exit, not the recommended one.
    // A second filled button beside "Weiter" would read as an equal choice.
    skipButton: {
      marginTop: spacing.sm,
      minHeight: spacing.touchTarget,
      alignItems: 'center',
      justifyContent: 'center',
    },
    skipButtonText: { ...typography.label, color: colors.textSecondary, fontWeight: '600' },
    helpText: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.md },

    // --- design 06: Bankverbindung confirm ---
    // ForceLightTheme wraps this subtree so the camera chrome cannot change what
    // the OCR sees — but a forced palette has to bring its OWN surface, or its
    // dark ink lands on the app's dark background and the heading disappears.
    // Same defect the manual IBAN entry carried until it got `forcedLightSurface`.
    confirmScroll: { paddingBottom: spacing.xl, backgroundColor: colors.background },
    bankHeader: { marginBottom: spacing.lg },
    bankHeading: { ...typography.display, color: colors.textPrimary },
    scanPreview: {
      height: 120,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: '#E9EDF3',
      overflow: 'hidden',
      justifyContent: 'flex-end',
      padding: spacing.md - 2,
      marginBottom: spacing.sm,
    },
    recognizedBadge: {
      position: 'absolute',
      top: spacing.sm + 2,
      right: spacing.sm + 2,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs + 1,
      backgroundColor: statusColor.success,
      borderRadius: radius.pill,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm + 1,
    },
    recognizedBadgeText: { ...typography.label, fontWeight: '600', color: colors.onAccent },
    scanPreviewTag: {
      alignSelf: 'flex-start',
      backgroundColor: 'rgba(255,255,255,0.7)',
      borderRadius: radius.sm - 2,
      paddingVertical: 2,
      paddingHorizontal: spacing.xs + 2,
    },
    scanPreviewTagText: { ...typography.mono, color: colors.textSecondary },
    confirmHint: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.lg },
    fieldLabel: {
      ...typography.label,
      fontWeight: '600',
      color: colors.textSecondary,
      marginBottom: spacing.sm,
    },
    checkSuffix: { color: statusColor.follow_up, fontWeight: '500' },
    ibanRow: { flexDirection: 'row', gap: spacing.sm + 2, marginBottom: spacing.lg },
    fieldBox: {
      minHeight: 56,
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1.5,
      borderColor: colors.borderStrong,
      borderRadius: radius.input,
      paddingHorizontal: spacing.md,
      marginBottom: spacing.lg,
    },
    fieldBoxCheck: { borderColor: statusColor.follow_up },
    ibanMaskBox: { flex: 1, minWidth: 0, marginBottom: 0 },
    ibanMaskText: {
      ...typography.mono,
      fontSize: 16,
      letterSpacing: 0.5,
      color: colors.textPrimary,
    },
    ibanInput: {
      flex: 1,
      minWidth: 0,
      marginBottom: 0,
      ...typography.mono,
      fontSize: 16,
      letterSpacing: 0.5,
    },
    revealButton: {
      minHeight: 56,
      paddingHorizontal: spacing.md,
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1.5,
      borderColor: colors.borderStrong,
      borderRadius: radius.input,
    },
    revealButtonText: { ...typography.label, fontWeight: '600', color: colors.textPrimary },
    input: {
      minHeight: spacing.touchTarget + spacing.sm,
      borderWidth: 1.5,
      borderColor: colors.borderStrong,
      borderRadius: radius.input,
      padding: spacing.md,
      marginBottom: spacing.sm,
      backgroundColor: colors.surface,
      ...typography.mono,
      fontSize: 16,
      color: colors.textPrimary,
    },
    error: { ...typography.label, color: colors.brick, marginBottom: spacing.md },
    nextButton: {
      minHeight: 56,
      backgroundColor: colors.accent,
      borderRadius: radius.button,
      alignItems: 'center',
      justifyContent: 'center',
    },
    nextButtonText: { fontSize: 18, fontWeight: '600', color: colors.onAccent },
    confirmRow: { flexDirection: 'row', gap: spacing.sm },
    footerButton: {
      flex: 1,
      minHeight: 56,
      borderRadius: radius.button,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryButton: {
      backgroundColor: colors.surface,
      borderWidth: 1.5,
      borderColor: colors.borderStrong,
    },
    secondaryButtonText: { fontSize: 18, fontWeight: '600', color: colors.textPrimary },
    // Design 06 camera: a dark full-screen action surface that OWNS the screen
    // (the shell hides its step chrome while scanning). Top inset clears the
    // status-bar/notch now that nothing sits above it.
    scanScreen: {
      flex: 1,
      backgroundColor: colors.ink,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing['2xl'],
      paddingBottom: spacing.lg,
    },
    scanHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: spacing.touchTarget,
      marginBottom: spacing.sm,
    },
    scanHeaderTitle: { ...typography.heading, color: colors.onAccent },
    headerButton: {
      // 48dp floor: these are the ONLY controls on a full-screen dark
      // surface, tapped one-handed outdoors.
      width: spacing.touchTarget,
      height: spacing.touchTarget,
      borderRadius: radius.md,
      backgroundColor: 'rgba(255,255,255,0.12)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerButtonOn: {
      backgroundColor: colors.accent,
      // ponytail: glow removed (accent-tinted shadow = halo). The accent
      // fill already carries the state; the shadow only added a bloom.
    },
    scanBody: { flex: 1, justifyContent: 'center' },
    // Fixed height instead of flex: the Android camera SurfaceView mispositions
    // itself when its frame comes from an indeterminate flex chain (observed on
    // the SM-S938B device pass — same fix as IdScanBlock.tsx). Geometry unchanged.
    cameraContainer: {
      height: 420,
      position: 'relative',
      borderRadius: radius.card,
      overflow: 'hidden',
      backgroundColor: colors.ink,
    },
    // RN 0.85 types dropped absoluteFillObject — spell out the absolute fill.
    camera: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
    // Scanning indicator as a bottom scrim over the camera frame.
    scanningRow: {
      position: 'absolute',
      left: spacing.lg,
      right: spacing.lg,
      bottom: spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      padding: spacing.md,
      backgroundColor: 'rgba(13,22,38,0.62)',
      borderRadius: radius.input,
    },
    scanningHint: { ...typography.label, color: colors.onAccent, opacity: 0.85, flexShrink: 1 },
    manualButton: {
      minHeight: 56,
      marginTop: spacing.md,
      backgroundColor: 'rgba(255,255,255,0.08)',
      borderWidth: 1.5,
      borderColor: 'rgba(255,255,255,0.4)',
      borderRadius: radius.button,
      alignItems: 'center',
      justifyContent: 'center',
    },
    manualButtonText: { fontSize: 18, fontWeight: '600', color: colors.onAccent },
  });
}
