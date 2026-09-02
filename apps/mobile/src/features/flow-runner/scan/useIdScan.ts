import { parse } from 'mrz';
import { useCallback, useState } from 'react';
import {
  type CameraDevice,
  useCameraDevice,
  useCameraPermission,
} from 'react-native-vision-camera';

/**
 * Structured ID field object — the SAME shape the manual-entry fallback
 * produces (D-24, one downstream code path). No address field: the German
 * ID MRZ (TD1) does not carry the address.
 */
export interface IdFields {
  surname: string;
  givenNames: string;
  birthDate: string;
  documentNumber: string;
  nationality: string;
  expiryDate: string;
}

export interface ParseIdMrzResult {
  valid: boolean;
  fields?: IdFields;
}

/**
 * Pure, camera-independent MRZ→structured-fields core (CHKT-01), mockable
 * without a camera. `mrz.parse()` never throws — garbage/partial OCR text
 * always resolves to `{ valid: false }`, never an exception (CHKT-03's
 * fallback path depends on this contract).
 */
/**
 * Isolates MRZ-shaped lines from raw OCR text: spaces stripped (MRZ has
 * none), uppercased, only [A-Z0-9<], plausible length, and at least one
 * filler '<' (present in every real MRZ line). Shared by parseIdMrz and the
 * hook's live scan-progress feedback ("X von 3 Zeilen erkannt").
 */
/**
 * ML Kit reads the MRZ filler '<' as 'K' or 'C' (see cleanMrzName) — a line
 * whose fillers were eaten this way keeps no '<', gets rejected by the
 * shape filter, and is mis-segmented by mrz.parse(). Restore filler RUNS:
 * 2+ consecutive K/C (TD1 padding is long '<' runs; real names/doc-numbers
 * almost never contain KK/CC), plus any trailing K/C run (every TD1 line is
 * '<'-padded to 30 chars, so the tail is always filler). Single interior K/C
 * are left untouched. Conservative by design: mrz.parse()'s check digits stay
 * the accept gate, so an over-eager restore fails to validate rather than
 * yielding a wrong "valid" read — the SAME normalize-then-let-the-checksum-
 * decide strategy the (reliable) IBAN scan uses.
 */
export function restoreMrzFillers(line: string): string {
  // Same-char runs only: ML Kit reads '<' consistently as ONE glyph, so a
  // real doc-number 'C' adjacent to a 'KK' filler run ("KKC01…") must NOT be
  // swallowed — collapsing the mixed [KC] class did exactly that. Restore
  // K-runs and C-runs independently, then any trailing filler (the tail of a
  // '<'-padded TD1 line is always filler).
  return line
    .replace(/K{2,}/g, (run) => '<'.repeat(run.length))
    .replace(/C{2,}/g, (run) => '<'.repeat(run.length))
    .replace(/[KC]+$/g, (run) => '<'.repeat(run.length));
}

/** MRZ-shaped: plausible TD1/TD3 length, MRZ charset, and holds a '<' filler —
 *  either as read or after restoring K/C-eaten fillers. */
function isMrzShapedLine(line: string): boolean {
  if (line.length < 28 || line.length > 44) return false;
  if (!/^[A-Z0-9<]+$/.test(line)) return false;
  return line.includes('<') || restoreMrzFillers(line).includes('<');
}

export function extractMrzLines(rawText: string): string[] {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, '').toUpperCase())
    .filter(isMrzShapedLine);
}

/** Runs mrz.parse() over one line window and maps a valid result to our field
 *  shape; never throws (mrz.parse() is documented not to, guarded anyway). */
function tryParseMrzWindow(lines: string[]): ParseIdMrzResult {
  let result: ReturnType<typeof parse> | null = null;
  try {
    const attempt = parse(lines);
    if (attempt.valid) result = attempt;
  } catch {
    // Defensive only — mrz.parse() documents that it never throws.
  }
  if (!result || !result.valid) return { valid: false };

  const { fields } = result;
  if (
    !fields.lastName ||
    !fields.firstName ||
    !fields.birthDate ||
    !fields.documentNumber ||
    !fields.nationality ||
    !fields.expirationDate
  ) {
    return { valid: false };
  }
  return {
    valid: true,
    fields: {
      surname: cleanMrzName(fields.lastName),
      givenNames: cleanMrzName(fields.firstName),
      birthDate: fields.birthDate,
      documentNumber: fields.documentNumber,
      nationality: fields.nationality,
      expiryDate: fields.expirationDate,
    },
  };
}

export function parseIdMrz(rawText: string): ParseIdMrzResult {
  // OCR of the card back yields MANY lines (labels, authority text, …) —
  // mrz.parse() expects EXACTLY the 2-3 machine-readable lines.
  const rawLines = extractMrzLines(rawText);
  if (rawLines.length < 2) {
    return { valid: false };
  }

  // Try the raw lines AND a filler-restored variant (fillers OCR'd as K/C).
  // The MRZ check digits remain the ONLY accept gate — variants just widen
  // what we OFFER the parser, never what passes (IBAN-scan strategy). German
  // ID (TD1) is 3 lines; passports (TD3) are 2 — tightest windows, newest
  // lines last in OCR order.
  for (const lines of [rawLines, rawLines.map(restoreMrzFillers)]) {
    const windows = [lines.slice(-3), lines.slice(-2)].filter((c) => c.length >= 2);
    for (const window of windows) {
      const result = tryParseMrzWindow(window);
      if (result.valid) return result;
    }
  }
  return { valid: false };
}

/**
 * MRZ name lines are padded with '<' fillers that OCR routinely misreads as
 * 'K' (occasionally 'C') — and unlike documentNumber/birthDate/expiryDate,
 * the NAME region carries no check digit, so "SAM K K K" survives
 * mrz.parse() as a "valid" first name. Best-practice cleanup: strip trailing
 * runs of single-letter K/C tokens (filler artifacts sit at the END of the
 * name field; a genuine final single-letter given name "K" is not a thing on
 * German IDs) and collapse whitespace. Everything stays user-editable on the
 * confirm screen — this only removes known-noise defaults.
 */
export function cleanMrzName(rawName: string): string {
  let name = rawName.replace(/\s+/g, ' ').trim();
  name = name.replace(/(?:\s+[KC])+$/i, '');
  return name;
}

export interface UseIdScanResult {
  device: CameraDevice | undefined;
  hasPermission: boolean;
  requestPermission: () => Promise<boolean>;
  /** Non-null once a camera/permission error occurs — steers the block to manual entry (D-08). */
  cameraError: string | null;
  reportCameraError: (message: string) => void;
  /** Latest VALID parse only (garbage frames never overwrite a pending confirm). */
  latestParse: ParseIdMrzResult | null;
  /** Live scan progress: MRZ-shaped lines in the last OCR frame (0-3). */
  mrzLinesSeen: number;
  /**
   * Feed raw OCR result text (react-native-vision-camera-ocr-plus's
   * `<Camera mode="recognize">` `callback`/`resultText`) through parseIdMrz
   * and surface the latest valid parse.
   */
  handleOcrResult: (resultText: string) => void;
  resetLatestParse: () => void;
}

/**
 * Thin hook wrapping Vision Camera device/permission state around the pure
 * parseIdMrz core (pure-function-alongside-hook convention, see
 * useShowIf.ts). The installed react-native-vision-camera@5.1.x "outputs"
 * API has no useFrameProcessor/worklet hook — react-native-vision-camera-ocr-plus's
 * self-contained `<Camera mode="recognize">` component (JS-thread callback)
 * is this plugin's actual supported integration for this stack, so the block
 * wires OCR text through handleOcrResult rather than a manual frame processor.
 */
export function useIdScan(): UseIdScanResult {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [latestParse, setLatestParse] = useState<ParseIdMrzResult | null>(null);
  const [mrzLinesSeen, setMrzLinesSeen] = useState(0);

  const handleOcrResult = useCallback((resultText: string) => {
    if (__DEV__ && resultText.trim().length > 0) {
      // Dev-only OCR trace (grep logcat for OCR-TRACE) — shows the raw ML Kit
      // MRZ read so misread glyphs can be diagnosed against the printed card,
      // exactly as the IBAN scan does. Drives the filler/glyph normalization.
      console.log(`[OCR-TRACE][id] ${JSON.stringify(resultText.slice(0, 300))}`);
    }
    // Live progress for the scanning overlay: how many MRZ-shaped lines the
    // last frame contained (real signal, capped at the 3 a German ID has).
    setMrzLinesSeen(Math.min(extractMrzLines(resultText).length, 3));
    const parsed = parseIdMrz(resultText);
    if (__DEV__) {
      console.log(`[OCR-TRACE][id] parsed=${parsed.valid ? 'VALID' : 'no'}`);
    }
    if (!parsed.valid || !parsed.fields) {
      return;
    }
    // A valid mrz.parse() means every MRZ check digit passed — a strong gate
    // (like the IBAN mod-97 checksum), so accept the FIRST valid frame rather
    // than waiting for two to agree. The old consensus made scans crawl and
    // often never converged on a noisy read; the check digits already rule
    // out a false accept, and the name (no check digit) is verified by the
    // rep on the editable confirm screen.
    setLatestParse(parsed);
  }, []);

  const resetLatestParse = useCallback(() => {
    setLatestParse(null);
    setMrzLinesSeen(0);
  }, []);

  return {
    device,
    hasPermission,
    requestPermission,
    cameraError,
    reportCameraError: setCameraError,
    latestParse,
    mrzLinesSeen,
    handleOcrResult,
    resetLatestParse,
  };
}
