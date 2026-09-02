import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { IdScanBlock as IdScanBlockDef } from '@frontdoorsales/flow-schema';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import type { ComponentType } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';
import {
  Camera as OcrCamera,
  type CameraTypes as OcrCameraTypes,
  type Text as OcrText,
} from 'react-native-vision-camera-ocr-plus';
import { radius, spacing, typography } from '../../../design/tokens';
import { ForceLightTheme } from '../../settings/theme/forceLightTheme';
import { useThemeColors } from '../../settings/theme/useThemeColors';
import { type TranslationKey, t } from '../../../i18n';
import { getSupabase } from '../../../lib/auth/supabase';
import { openDatabase } from '../../../lib/db/powersync';
import { FieldBlankedForRecording } from '../../app-lock/screenProtection/FieldBlankedForRecording';
import { useSensitiveScreen } from '../../app-lock/screenProtection/sensitiveScreen';
import {
  type RecordingState,
  shouldBlankField,
  useRecordingDetection,
} from '../../app-lock/screenProtection/useRecordingDetection';
import { createScanTelemetryRepo } from '../db/scanTelemetryRepo';
import {
  type ScanOutcome,
  type ScanTelemetryRepoLike,
  buildScanTelemetryEvent,
  recordScanTelemetry,
} from '../scan/scanTelemetry';
import { type IdFields, useIdScan } from '../scan/useIdScan';

/**
 * WORKAROUND (documented per CLAUDE.md "Root Cause, Not Symptom"): ocr-plus's
 * exported `CameraTypes` (2.0.1) omits `style`/`torchMode` from its
 * TypeScript surface even though its implementation (Camera.js) spreads all
 * extra props — including `style`/`torchMode`/`onError` — straight onto the
 * REAL `react-native-vision-camera` `<Camera>` view underneath (verified by
 * reading Camera.js: `React.createElement(NativeCamera, { ...p, ... })`).
 * This is a type-declaration gap in the published package, not a runtime
 * incompatibility — remove this cast once ocr-plus ships accurate types.
 */
type OcrCameraProps = OcrCameraTypes & {
  style?: StyleProp<ViewStyle>;
  torchMode?: 'on' | 'off';
  onError?: (error: { message: string }) => void;
};
const TypedOcrCamera = OcrCamera as unknown as ComponentType<OcrCameraProps>;

export interface IdScanBlockProps {
  block: IdScanBlockDef;
  value: string | undefined;
  onAnswer: (fieldId: string, value: string) => void | Promise<void>;
  /** Camera capture is a full-screen ACTION, not a step (design 05): reported
   *  true while scanning so the shell hides its step chrome, false once we hit
   *  the confirm/manual input (design 06, a real step). */
  onImmersiveChange?: (immersive: boolean) => void;
  /** X-cancel from the camera surface: abandons the scan action and steps back. */
  onCancel?: () => void;
}

/**
 * The structured ID field object (D-24) — the SAME shape produced by both the
 * camera-scan-confirm path and the manual-entry fallback (one downstream code
 * path). No address field: the German ID MRZ (TD1) does not carry it.
 */
export interface IdFieldsDraft {
  surname: string;
  givenNames: string;
  birthDate: string;
  documentNumber: string;
  nationality: string;
  expiryDate: string;
}

export const EMPTY_ID_FIELDS: IdFieldsDraft = {
  surname: '',
  givenNames: '',
  birthDate: '',
  documentNumber: '',
  nationality: '',
  expiryDate: '',
};

/**
 * Serializes the structured field object into the stringified answer (D-24).
 * Every value is trimmed and inner whitespace collapsed — MRZ-derived values
 * carry filler artifacts and OCR padding ("ERIKA  " / " MUSTERMANN") that
 * must never reach the frozen contract snapshot. `documentNumber`/
 * `nationality` are additionally uppercased here so the PERSISTED value
 * matches the canonical uppercase alphabet `validateIdFields` already checks
 * against (a manually-entered lowercase document number must not diverge
 * from the value actually validated/frozen into the legal answer).
 */
export function serializeIdFields(fields: IdFieldsDraft): string {
  const trimmed = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, value.replace(/\s+/g, ' ').trim()]),
  ) as unknown as IdFieldsDraft;
  trimmed.documentNumber = trimmed.documentNumber.toUpperCase();
  trimmed.nationality = trimmed.nationality.toUpperCase();
  return JSON.stringify(trimmed);
}

/** Parses a previously-saved answer (from EITHER path) back into an editable draft. */
export function parseIdFieldsAnswer(value: string | undefined): IdFieldsDraft {
  if (!value) {
    return { ...EMPTY_ID_FIELDS };
  }
  try {
    const parsed = JSON.parse(value) as Partial<IdFieldsDraft>;
    return { ...EMPTY_ID_FIELDS, ...parsed };
  } catch {
    return { ...EMPTY_ID_FIELDS };
  }
}

/** Maps a parseIdMrz() valid result into an editable confirm-screen draft (same shape as manual). */
export function idFieldsFromScan(fields: IdFields): IdFieldsDraft {
  return { ...fields };
}

/**
 * German ID document numbers use a RESTRICTED 9-char alphabet (BSI/BMI
 * spec): digits plus consonants C F G H J K L M N P R T V W X Y Z — vowels
 * and B/D/Q/S are excluded to prevent confusion. Passports share the shape.
 */
const DOCUMENT_NUMBER_RE = /^[0-9CFGHJKLMNPRTVWXYZ]{9}$/;
/** Names: letters (incl. umlauts/accents), space, hyphen, apostrophe. */
const NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ÿẞß' -]+$/;
/** MRZ date (YYMMDD) or German notation (DD.MM.YYYY). */
const DATE_MRZ_RE = /^(\d{2})(\d{2})(\d{2})$/;
const DATE_DE_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/;

function isPlausibleDate(value: string): boolean {
  const mrz = DATE_MRZ_RE.exec(value);
  const de = DATE_DE_RE.exec(value);
  if (!mrz && !de) return false;
  const month = Number(mrz ? mrz[2] : de?.[2]);
  const day = Number(mrz ? mrz[3] : de?.[1]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

export type IdFieldErrors = Partial<Record<keyof IdFieldsDraft, TranslationKey>>;

/**
 * Field-level format rules for BOTH the scan-confirm and manual-entry paths
 * (CHKT-03: one converged validation). Purely structural — content truth is
 * the rep comparing against the physical document; expiry-in-the-past is
 * deliberately NOT blocked here (process decision for the Fachanwalt list).
 */
export function validateIdFields(fields: IdFieldsDraft): IdFieldErrors {
  const errors: IdFieldErrors = {};
  const surname = fields.surname.trim();
  const givenNames = fields.givenNames.trim();
  if (!surname || !NAME_RE.test(surname)) errors.surname = 'checkout.idErrorName';
  if (!givenNames || !NAME_RE.test(givenNames)) errors.givenNames = 'checkout.idErrorName';
  if (!isPlausibleDate(fields.birthDate.trim())) errors.birthDate = 'checkout.idErrorDate';
  if (!isPlausibleDate(fields.expiryDate.trim())) errors.expiryDate = 'checkout.idErrorDate';
  if (!DOCUMENT_NUMBER_RE.test(fields.documentNumber.trim().toUpperCase())) {
    errors.documentNumber = 'checkout.idErrorDocumentNumber';
  }
  if (!/^[A-Za-z]{1,3}$/.test(fields.nationality.trim())) {
    errors.nationality = 'checkout.idErrorNationality';
  }
  return errors;
}

type IdScanUiState = 'scanning' | 'confirm' | 'manual';

/** Structural session-context resolver (injectable for tests, D-15/CHKT-04). */
export interface ScanSessionDeps {
  getUserId: () => Promise<string | null>;
  getTeamIdForUser: (userId: string) => Promise<string | null>;
}

export interface ScanSessionContext {
  createdBy: string;
  teamId: string;
}

/**
 * Best-effort telemetry-context resolution: createdBy from the Supabase
 * session, teamId from the rep's currently-locked territory (same signal
 * MapScreen already uses for "ownTerritory"). IdScanBlock's props are FROZEN
 * to { block, value, onAnswer } (D-06) — no db/teamId is threaded in via
 * FlowRunnerScreen, so this resolves entirely internally. If either half is
 * unresolvable, telemetry recording is skipped silently (never blocks the
 * scan/close flow, D-14).
 */
export async function resolveScanSessionContext(
  deps: ScanSessionDeps,
): Promise<ScanSessionContext | null> {
  try {
    const userId = await deps.getUserId();
    if (!userId) return null;
    const teamId = await deps.getTeamIdForUser(userId);
    if (!teamId) return null;
    return { createdBy: userId, teamId };
  } catch {
    return null;
  }
}

export interface RecordIdScanOutcomeParams {
  outcome: ScanOutcome;
  startedAt: number;
  endedAt: number;
  deviceModel: string;
  appVersion: string;
  sessionContext: ScanSessionContext | null;
  repo: ScanTelemetryRepoLike;
}

/**
 * CHKT-04: one telemetry event per scan session. Pure/DI'd so it is testable
 * with a fake repo without mounting the component. A missing session context
 * (createdBy/teamId unresolvable) means this is a silent no-op — telemetry is
 * best-effort and must never block or fail the scan/close flow (D-14).
 */
export async function recordIdScanOutcome(params: RecordIdScanOutcomeParams): Promise<void> {
  const { outcome, startedAt, endedAt, deviceModel, appVersion, sessionContext, repo } = params;
  if (!sessionContext) return;
  const event = buildScanTelemetryEvent({
    scanType: 'id',
    outcome,
    startedAt,
    endedAt,
    deviceModel,
    appVersion,
    createdBy: sessionContext.createdBy,
    teamId: sessionContext.teamId,
  });
  await recordScanTelemetry(repo, event);
}

async function defaultGetUserId(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.user.id ?? null;
}

async function defaultGetTeamIdForUser(userId: string): Promise<string | null> {
  const db = await openDatabase();
  const rows = await db.getAll<{ team_id: string }>(
    'SELECT team_id FROM territories WHERE locked_by = ? LIMIT 1',
    [userId],
  );
  return rows[0]?.team_id ?? null;
}

const FIELD_ORDER: Array<{ key: keyof IdFieldsDraft; labelKey: TranslationKey }> = [
  { key: 'surname', labelKey: 'checkout.idFieldSurname' },
  { key: 'givenNames', labelKey: 'checkout.idFieldGivenNames' },
  { key: 'birthDate', labelKey: 'checkout.idFieldBirthDate' },
  { key: 'documentNumber', labelKey: 'checkout.idFieldDocumentNumber' },
  { key: 'nationality', labelKey: 'checkout.idFieldNationality' },
  { key: 'expiryDate', labelKey: 'checkout.idFieldExpiryDate' },
];

/**
 * ID-document scan block (CHKT-01/03/04) — real camera + MRZ capture with a
 * confirm screen and an always-visible manual fallback (D-05/D-06/D-08). Both
 * paths converge on the SAME structured field object (D-24); no ID-document
 * image is ever retained (D-07) — nothing is written to the attachment queue
 * here.
 */
/**
 * SET-05 hard exception (12-UI-SPEC.md § Theme resolution model): a dark
 * chrome around a live camera preview changes what the OCR sees and what
 * the rep can verify. `ForceLightTheme` wraps the WHOLE content subtree
 * (scanning/confirm/manual — never a per-screen dark-scheme conditional
 * branch), so `useThemeColors()` inside `IdScanBlockContent` always
 * resolves the light palette — proven directly against `resolveThemeColors`
 * in `IdScanBlock.test.tsx` (T-12-12-02).
 */
export function IdScanBlock(props: IdScanBlockProps) {
  return (
    <ForceLightTheme>
      <IdScanBlockContent {...props} />
    </ForceLightTheme>
  );
}

export interface IdConfirmScreenProps {
  block: IdScanBlockDef;
  draft: IdFieldsDraft;
  fieldErrors: IdFieldErrors;
  recordingState: RecordingState;
  colors: ReturnType<typeof useThemeColors>;
  styles: ReturnType<typeof makeStyles>;
  onUpdateField: (key: keyof IdFieldsDraft, next: string) => void;
  onRescan: () => void;
  onConfirm: () => void;
}

/**
 * D-14b (SEC-05, plan 15-09): the confirm-screen JSX, pulled out into a
 * standalone HOOKLESS component so it is directly invocable in tests (no
 * react-native-testing-library in this repo — mirrors
 * `FieldBlankedForRecording.tsx`'s DI convention). Everything it needs
 * (draft, errors, recording state, callbacks) arrives as props from
 * `IdScanBlockContent`'s own hook-backed state; this component itself owns
 * no state and calls no hook.
 *
 * The ONLY thing D-14b changes here is the document-preview branch: while
 * `shouldBlankField(recordingState)` is true, `FieldBlankedForRecording`
 * REPLACES the frozen-frame preview outright (never an overlay — the real
 * preview view is not mounted underneath). Every other element (fields,
 * rescan, confirm) is unconditional on `recordingState` — a recording never
 * blocks the rep from finishing the step (T-15-09-04).
 */
export function IdConfirmScreen({
  block,
  draft,
  fieldErrors,
  recordingState,
  colors,
  styles,
  onUpdateField,
  onRescan,
  onConfirm,
}: IdConfirmScreenProps) {
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollContent}>
      <Text style={styles.label}>{t('checkout.idConfirmTitle')}</Text>
      {/* Frozen-frame thumbnail — TRANSIENT UI state only (D-07): nothing
          here is written to the attachment queue or any storage. D-14b:
          replaced (not overlaid) by FieldBlankedForRecording while a
          screen recording is detected. */}
      {shouldBlankField(recordingState) ? (
        <FieldBlankedForRecording colors={colors} testID={`id-scan-blanked-${block.id}`} />
      ) : (
        <View style={styles.frozenFrame} testID={`id-scan-frozen-frame-${block.id}`} />
      )}
      <Text style={styles.helpText}>{t('checkout.confirmEditableHint')}</Text>
      {FIELD_ORDER.map(({ key, labelKey }) => (
        <View key={key} style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>{t(labelKey)}</Text>
          <TextInput
            style={styles.input}
            value={draft[key]}
            onChangeText={(next) => onUpdateField(key, next)}
            testID={`id-confirm-${key}-${block.id}`}
          />
          {fieldErrors[key] ? <Text style={styles.fieldError}>{t(fieldErrors[key])}</Text> : null}
        </View>
      ))}
      <View style={styles.confirmRow}>
        <Pressable
          style={[styles.secondaryButton, styles.confirmRowButton]}
          accessibilityRole="button"
          onPress={onRescan}
        >
          <Text style={styles.secondaryButtonText}>{t('checkout.rescanCta')}</Text>
        </Pressable>
        <Pressable
          style={[styles.nextButton, styles.confirmRowButton]}
          accessibilityRole="button"
          onPress={onConfirm}
          testID={`id-confirm-accept-${block.id}`}
        >
          <Text style={styles.nextButtonText}>{t('checkout.idConfirmCta')}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function IdScanBlockContent({
  block,
  value,
  onAnswer,
  onImmersiveChange,
  onCancel,
}: IdScanBlockProps) {
  const colors = useThemeColors();
  useSensitiveScreen('id'); // D-14c (SEC-05, 15-08): registers this ID surface for the silent screenshot listener.
  const recordingState = useRecordingDetection(); // D-14b (SEC-05, 15-09): drives the confirm screen's document-preview blanking.
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const initialDraft = useMemo(() => parseIdFieldsAnswer(value), [value]);
  const [uiState, setUiState] = useState<IdScanUiState>('scanning');
  const [draft, setDraft] = useState<IdFieldsDraft>(initialDraft);
  const [fieldErrors, setFieldErrors] = useState<IdFieldErrors>({});
  // undefined until first toggle: VisionCamera's useTorchModeUpdater calls
  // setTorchMode() uncaught in an effect — passing 'off' at mount races the
  // camera becoming active and surfaces "Camera is not active" as an
  // unhandled promise rejection on device. undefined skips the call entirely.
  const [torchMode, setTorchMode] = useState<'on' | 'off' | undefined>(undefined);
  const torchOn = torchMode === 'on';
  const setTorchOn = (updater: (prev: boolean) => boolean) =>
    setTorchMode((prev) => (updater(prev === 'on') ? 'on' : 'off'));
  const sessionStartedAt = useRef(Date.now());
  const telemetryRecorded = useRef(false);

  const {
    device,
    hasPermission,
    requestPermission,
    cameraError,
    reportCameraError,
    latestParse,
    mrzLinesSeen,
    handleOcrResult,
  } = useIdScan();

  const recordOutcome = useCallback(async (outcome: ScanOutcome) => {
    if (telemetryRecorded.current) return;
    telemetryRecorded.current = true;
    try {
      const db = await openDatabase();
      const repo = createScanTelemetryRepo({ db });
      const sessionContext = await resolveScanSessionContext({
        getUserId: defaultGetUserId,
        getTeamIdForUser: defaultGetTeamIdForUser,
      });
      await recordIdScanOutcome({
        outcome,
        startedAt: sessionStartedAt.current,
        endedAt: Date.now(),
        deviceModel: Device.modelName ?? 'unknown',
        appVersion: Application.nativeApplicationVersion ?? 'unknown',
        sessionContext,
        repo,
      });
    } catch (error) {
      // Best-effort (D-14): never blocks or surfaces to the scan/close flow.
      // eslint-disable-next-line no-console
      console.warn('id scan telemetry record failed (best-effort, ignored):', error);
    }
  }, []);

  const goToManual = useCallback(
    (reason: 'permission-denied' | 'manual-button') => {
      if (reason === 'permission-denied') {
        reportCameraError(t('errorState.cameraPermissionDenied'));
      }
      setUiState('manual');
    },
    [reportCameraError],
  );

  const handleOcrText = useCallback(
    (data: OcrText | string) => {
      const resultText = typeof data === 'string' ? data : data.resultText;
      handleOcrResult(resultText);
    },
    [handleOcrResult],
  );

  // A fresh valid parse (from useIdScan's latestParse) advances scanning -> confirm.
  useEffect(() => {
    if (uiState === 'scanning' && latestParse?.valid && latestParse.fields) {
      setDraft(idFieldsFromScan(latestParse.fields));
      setUiState('confirm');
    }
  }, [uiState, latestParse]);

  // Only the live camera sub-state is the full-screen action (design 05);
  // confirm/manual are input steps (design 06). Layout effect so the shell
  // drops/restores its chrome before paint (no one-frame flash), and the
  // cleanup restores chrome if the block unmounts mid-scan.
  useLayoutEffect(() => {
    onImmersiveChange?.(uiState === 'scanning');
    return () => onImmersiveChange?.(false);
  }, [uiState, onImmersiveChange]);

  const handleRescan = () => {
    setUiState('scanning');
  };

  const acceptDraft = (outcome: 'scan_success' | 'manual_fallback') => {
    const errors = validateIdFields(draft);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }
    void recordOutcome(outcome);
    void onAnswer(block.id, serializeIdFields(draft));
  };

  const handleConfirmFromScan = () => acceptDraft('scan_success');
  const handleConfirmFromManual = () => acceptDraft('manual_fallback');

  const updateField = (key: keyof IdFieldsDraft, next: string) => {
    setDraft((prev) => ({ ...prev, [key]: next }));
    // Clear the field's error as soon as the user edits it again.
    setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  if (uiState === 'manual') {
    return (
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollContent}>
        <Text style={styles.label}>{block.label}</Text>
        <Text style={styles.helpText}>{t('flowRunner.idScanManualHint')}</Text>
        {FIELD_ORDER.map(({ key, labelKey }) => (
          <View key={key} style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>{t(labelKey)}</Text>
            <TextInput
              style={styles.input}
              value={draft[key]}
              onChangeText={(next) => updateField(key, next)}
              testID={`id-scan-manual-${key}-${block.id}`}
            />
            {fieldErrors[key] ? <Text style={styles.fieldError}>{t(fieldErrors[key])}</Text> : null}
          </View>
        ))}
        <Pressable
          style={styles.nextButton}
          accessibilityRole="button"
          onPress={handleConfirmFromManual}
          testID={`id-scan-manual-confirm-${block.id}`}
        >
          <Text style={styles.nextButtonText}>{t('flowRunner.next')}</Text>
        </Pressable>
      </ScrollView>
    );
  }

  if (uiState === 'confirm') {
    return (
      <IdConfirmScreen
        block={block}
        draft={draft}
        fieldErrors={fieldErrors}
        recordingState={recordingState}
        colors={colors}
        styles={styles}
        onUpdateField={updateField}
        onRescan={handleRescan}
        onConfirm={handleConfirmFromScan}
      />
    );
  }

  // uiState === 'scanning' — design screen 05: dark immersive capture surface.
  return (
    <View style={styles.scanContainer}>
      <View style={styles.scanHeader}>
        {/* Design 05: X-cancel (left) abandons the scan action and steps back
            — a camera action has no step "Back", it has a close. */}
        <Pressable
          style={styles.cancelButton}
          accessibilityRole="button"
          accessibilityLabel={t('cta.cancel')}
          onPress={() => onCancel?.()}
          testID={`id-scan-cancel-${block.id}`}
        >
          <MaterialCommunityIcons name="close" size={22} color={colors.onAccent} />
        </Pressable>
        <Text style={styles.scanHeaderTitle}>{t('checkout.idScanHeaderTitle')}</Text>
        <Pressable
          style={[styles.torchButton, torchOn ? styles.torchButtonOn : null]}
          accessibilityRole="button"
          accessibilityLabel={t('checkout.torchToggleLabel')}
          onPress={() => setTorchOn((prev) => !prev)}
        >
          <MaterialCommunityIcons
            name={torchOn ? 'flash' : 'flash-off'}
            size={22}
            color={colors.onAccent}
          />
        </Pressable>
      </View>

      {!hasPermission ? (
        <View style={styles.scanBody}>
          <Text style={styles.scanCaption}>{t('checkout.idScanBackHint')}</Text>
          <Pressable
            style={styles.nextButton}
            accessibilityRole="button"
            onPress={() => {
              void requestPermission().then((granted) => {
                if (!granted) goToManual('permission-denied');
              });
            }}
          >
            <Text style={styles.nextButtonText}>{t('flowRunner.next')}</Text>
          </Pressable>
        </View>
      ) : device && !cameraError ? (
        <View style={styles.scanBody}>
          {/* ID guide frame: amber corner brackets only. The dashed MRZ
              sub-zone + "MRZ-Zeile hier ausrichten" hint were removed by
              request — they were purely visual (OCR reads the whole frame
              regardless), so this changes the look, not the read path. */}
          <View style={styles.guideFrame}>
            <TypedOcrCamera
              style={styles.camera}
              device={device}
              isActive
              mode="recognize"
              options={{ language: 'latin', frameSkipThreshold: 3 }}
              callback={handleOcrText}
              torchMode={torchMode}
              onError={(error: { message: string }) => {
                reportCameraError(error.message);
                goToManual('permission-denied');
              }}
            />
            <View style={[styles.corner, styles.cornerTL]} pointerEvents="none" />
            <View style={[styles.corner, styles.cornerTR]} pointerEvents="none" />
            <View style={[styles.corner, styles.cornerBL]} pointerEvents="none" />
            <View style={[styles.corner, styles.cornerBR]} pointerEvents="none" />
          </View>
          <View
            style={styles.scanningRow}
            pointerEvents="none"
            testID={`id-scanning-indicator-${block.id}`}
          >
            <ActivityIndicator size="small" color={colors.onAccent} />
            <Text style={styles.scanningHint}>
              {mrzLinesSeen > 0
                ? t('checkout.idScanProgressHint').replace('{count}', String(mrzLinesSeen))
                : t('checkout.idScanActiveHint')}
            </Text>
          </View>
          <Text style={styles.scanCaption}>{t('checkout.idScanFrameCaption')}</Text>
        </View>
      ) : (
        <View style={styles.scanBody}>
          <Text style={styles.scanCaptionMuted}>{t('errorState.scanUnreadableHint')}</Text>
        </View>
      )}

      <Pressable
        style={styles.manualButton}
        accessibilityRole="button"
        onPress={() => goToManual('manual-button')}
        testID={`id-scan-manual-entry-${block.id}`}
      >
        <MaterialCommunityIcons name="pencil-outline" size={19} color={colors.onAccent} />
        <Text style={styles.manualButtonText}>{t('checkout.manualEntryCta')}</Text>
      </Pressable>
    </View>
  );
}

const CORNER = 38;

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    label: { ...typography.display, color: colors.textPrimary, marginBottom: spacing.sm },
    helpText: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.md },
    // ForceLightTheme wraps this subtree so the camera chrome cannot change what
    // the OCR sees — but a forced palette has to bring its OWN surface, or its
    // dark ink lands on the app's dark background and the heading disappears.
    // Same defect the manual IBAN entry carried until it got `forcedLightSurface`.
    scrollContent: { paddingBottom: spacing.xl, backgroundColor: colors.background },
    // Design screen 05: a dark immersive capture surface that OWNS the full
    // screen (the shell hides its step chrome while scanning) — no card radius,
    // top inset clears the status-bar/notch now that nothing sits above it.
    scanContainer: {
      flex: 1,
      backgroundColor: '#0d1420',
      overflow: 'hidden',
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
    cancelButton: {
      // 48dp floor: these are the ONLY controls on a full-screen dark
      // surface, tapped one-handed outdoors.
      width: spacing.touchTarget,
      height: spacing.touchTarget,
      borderRadius: radius.md,
      backgroundColor: 'rgba(255,255,255,0.12)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    torchButton: {
      // 48dp floor: these are the ONLY controls on a full-screen dark
      // surface, tapped one-handed outdoors.
      width: spacing.touchTarget,
      height: spacing.touchTarget,
      borderRadius: radius.md,
      backgroundColor: 'rgba(255,255,255,0.12)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    torchButtonOn: {
      backgroundColor: colors.accent,
      // ponytail: glow removed (accent-tinted shadow = halo). The accent
      // fill already carries the state; the shadow only added a bloom.
    },
    scanBody: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    // aspect-ratio frame (design 05: 1.58 card ratio) — a determinate width from
    // the padded block area yields a determinate height, keeping the Android
    // SurfaceView correctly positioned (the SM-S938B mispositioning fix).
    guideFrame: {
      width: '100%',
      aspectRatio: 1.58,
      borderRadius: radius.card,
      overflow: 'hidden',
      position: 'relative',
      backgroundColor: 'rgba(255,255,255,0.04)',
    },
    camera: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
    corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: colors.accent },
    cornerTL: { top: -2, left: -2, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 14 },
    cornerTR: {
      top: -2,
      right: -2,
      borderTopWidth: 4,
      borderRightWidth: 4,
      borderTopRightRadius: 14,
    },
    cornerBL: {
      bottom: -2,
      left: -2,
      borderBottomWidth: 4,
      borderLeftWidth: 4,
      borderBottomLeftRadius: 14,
    },
    cornerBR: {
      bottom: -2,
      right: -2,
      borderBottomWidth: 4,
      borderRightWidth: 4,
      borderBottomRightRadius: 14,
    },
    scanningRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      marginTop: spacing.lg,
    },
    scanningHint: { ...typography.label, color: colors.onAccent, opacity: 0.85 },
    scanCaption: {
      ...typography.body,
      color: 'rgba(255,255,255,0.85)',
      textAlign: 'center',
      marginTop: spacing.lg,
    },
    scanCaptionMuted: { ...typography.body, color: 'rgba(255,255,255,0.6)', textAlign: 'center' },
    manualButton: {
      flexDirection: 'row',
      gap: spacing.sm,
      minHeight: 56,
      backgroundColor: 'rgba(255,255,255,0.08)',
      borderWidth: 1.5,
      borderColor: 'rgba(255,255,255,0.4)',
      borderRadius: radius.button,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: spacing.md,
    },
    manualButtonText: { fontSize: 18, fontWeight: '600', color: colors.onAccent },
    frozenFrame: {
      height: spacing.touchTarget * 3,
      backgroundColor: colors.subtleFill,
      borderRadius: radius.card,
      marginBottom: spacing.md,
    },
    fieldRow: { marginBottom: spacing.sm + spacing.xs },
    fieldError: { ...typography.mono, color: colors.brick, marginTop: 2 },
    fieldLabel: {
      ...typography.label,
      fontWeight: '600',
      color: colors.textSecondary,
      marginBottom: spacing.xs,
    },
    input: {
      minHeight: spacing.touchTarget + spacing.sm,
      borderWidth: 1.5,
      borderColor: colors.borderStrong,
      borderRadius: radius.input,
      padding: spacing.md,
      backgroundColor: colors.surface,
      fontSize: 16,
      color: colors.textPrimary,
    },
    confirmRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    confirmRowButton: { flex: 1 },
    secondaryButton: {
      minHeight: 56,
      backgroundColor: colors.surface,
      borderWidth: 1.5,
      borderColor: colors.borderStrong,
      borderRadius: radius.button,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryButtonText: { fontSize: 18, fontWeight: '600', color: colors.textPrimary },
    nextButton: {
      minHeight: 56,
      backgroundColor: colors.accent,
      borderRadius: radius.button,
      alignItems: 'center',
      justifyContent: 'center',
    },
    nextButtonText: { fontSize: 18, fontWeight: '600', color: colors.onAccent },
  });
}
