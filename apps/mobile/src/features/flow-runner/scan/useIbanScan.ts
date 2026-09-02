import { useCallback, useEffect, useState } from 'react';
import { useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import type { Text as OcrRecognizedText } from 'react-native-vision-camera-ocr-plus';
import { validateIban } from '../blocks/IbanScanBlock';

/**
 * Matches the first IBAN-shaped substring anywhere in OCR-recognized text: 2
 * letters (country code) + 2 digits (checksum) + 11-30 further alphanumerics,
 * tolerating whitespace between groups (ML Kit commonly splits a printed
 * IBAN into space-separated 4-character blocks, e.g. "DE89 3704 0044 0532
 * 0130 00"). Whitespace is stripped and the match uppercased — extraction
 * NEVER guesses/computes a checksum, it only shapes a candidate string for
 * `validateIban` (ibantools) to check separately (CHKT-02/CHKT-03).
 */
/** ISO 13616: 2 country letters + 2 CHECK DIGITS (always digits) + 11-30 alphanumerics. */
const STRICT_IBAN_REGEX = /([A-Za-z]{2}[ ]?\d{2}(?:[ ]?[A-Za-z0-9]){11,30})/g;
/**
 * Recovery tier ONLY: the two check-digit positions additionally accept the
 * known OCR digit-confusables (O I L T S B Z G — device pass read "DES0" for
 * "DE50"). These positions are ALWAYS digits per ISO — any confusable here is
 * normalized straight back to its digit before the checksum ever sees it.
 */
const CONFUSED_CHECK_DIGIT_REGEX = /([A-Za-z]{2}[ ]?[0-9OILTSBZGoiltsbzg]{2}(?:[ ]?[A-Za-z0-9]){11,30})/g;

/**
 * Pure, camera-independent core (04-RESEARCH.md Pattern 2 fallback branch;
 * useShowIf.ts pure-function-alongside-hook convention). Exported separately
 * so it is directly unit-testable without mounting a component or touching
 * any native camera module.
 *
 * Two device-pass findings baked in (OCR-TRACE, Kreissparkasse card):
 * 1. ML Kit splits the printed IBAN across text lines ("DE50 6025 00To o\n
 *    001779 9") — ALL whitespace incl. newlines is flattened before matching
 *    so a wrapped IBAN still assembles into one candidate.
 * 2. Misreads hit the CHECK DIGITS too ("DES0" for "DE50") — the two chars
 *    after the country code accept letters as well; the glyph normalization
 *    + mod-97 checksum decide what is real, never the regex alone.
 * Returns every distinct match (a flattened frame can contain several
 * IBAN-shaped runs; false glues simply fail the checksum downstream).
 */
export function extractIbanCandidates(rawText: string): string[] {
  const seen = new Set<string>();
  const collect = (text: string, regex: RegExp) => {
    for (const match of text.matchAll(regex)) {
      // Both regexes carry exactly one capture group, so a match always has
      // group 1 — but noUncheckedIndexedAccess cannot see that. Narrow rather
      // than assert with `!`: CLAUDE.md forbids escaping into `any`, and a
      // non-null assertion is the same move in different clothing.
      const captured = match[1];
      if (!captured) continue;
      seen.add(captured.replace(/\s+/g, '').toUpperCase());
    }
  };
  // Cleanest reads first: strict ISO shape within a single OCR line.
  for (const line of rawText.split(/\r?\n/)) {
    collect(line, STRICT_IBAN_REGEX);
  }
  // Line-wrapped IBANs (device pass: ML Kit split the printed IBAN across
  // text lines) — same strict shape over the whitespace-flattened text.
  const flattened = rawText.replace(/\s+/g, ' ');
  collect(flattened, STRICT_IBAN_REGEX);
  // Recovery tier: misread check digits ("DES0" for "DE50"). Guarded by a
  // digit-share plausibility check — a real IBAN is majority digits after
  // glyph normalization (DE: 20/22), ordinary word runs never are.
  for (const match of flattened.matchAll(CONFUSED_CHECK_DIGIT_REGEX)) {
    // Same single-capture-group narrowing as in collect() above.
    const captured = match[1];
    if (!captured) continue;
    const candidate = captured.replace(/\s+/g, '').toUpperCase();
    const normalized = digitNormalizedIbanCandidate(candidate);
    const digitCount = (normalized.match(/\d/g) ?? []).length;
    if (digitCount / normalized.length >= 0.5) {
      seen.add(candidate);
    }
  }
  return [...seen];
}

/** Back-compat single-candidate wrapper (first match) — prefer extractIbanCandidates. */
export function extractIbanCandidate(rawText: string): string | null {
  return extractIbanCandidates(rawText)[0] ?? null;
}

/**
 * Flattening glues neighbouring tokens onto the IBAN (OCR-TRACE:
 * "DE50…7799" + the misread "1BAN" label → one 24-char run), so the true
 * IBAN is a PREFIX of the matched run. Try every plausible prefix length
 * (longest first — prefer the fullest read) on both the raw candidate and
 * its glyph-normalized variant; ibantools validates country-specific length
 * AND mod-97, so a wrong prefix can't pass. Returns the first checksum-valid
 * IBAN or null.
 */
export function checksumValidIbanFrom(candidate: string): string | null {
  const variants = [candidate, digitNormalizedIbanCandidate(candidate)];
  const maxLen = Math.min(candidate.length, 34);
  for (let len = maxLen; len >= 15; len--) {
    for (const variant of variants) {
      const prefix = variant.slice(0, len);
      if (validateIban(prefix).valid) {
        return prefix;
      }
    }
  }
  return null;
}

/**
 * ML Kit routinely confuses visually similar glyphs in printed IBANs
 * (O↔0, I/L↔1, S↔5, B↔8, Z↔2, G↔6) — each misread fails the mod-97
 * checksum and the user waits scan-loop after scan-loop. After the country
 * code, most IBAN bodies (all German ones) are digits, so a digit-forced
 * variant of the tail is a legitimate second candidate. The checksum in
 * `validateIban` stays the only accept gate — this only widens what we OFFER
 * it, never what passes.
 */
export function digitNormalizedIbanCandidate(candidate: string): string {
  const head = candidate.slice(0, 2);
  const tail = candidate
    .slice(2)
    .replace(/O/g, '0')
    .replace(/[ILT]/g, '1') // T: embossed serif "1" reads as T (OCR-TRACE: "00To" for "0010")
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/Z/g, '2')
    .replace(/G/g, '6');
  return head + tail;
}

export interface UseIbanScanResult {
  /** `undefined` while no matching back camera device has been resolved yet. */
  device: ReturnType<typeof useCameraDevice>;
  hasPermission: boolean;
  /**
   * True once camera permission has been explicitly denied (or the request
   * itself failed) — steers `IbanScanBlock` straight to manual entry (D-08),
   * matching `errorState.cameraPermissionDenied`.
   */
  permissionDenied: boolean;
  /**
   * Feed every OCR result from the `react-native-vision-camera-ocr-plus`
   * `<Camera mode="recognize" callback={...} />` wrapper through this. A
   * checksum-valid IBAN candidate surfaces via `validIban`; anything else is
   * silently ignored (no attempt-counting/timeout UI, D-06).
   */
  handleRecognizedText: (data: OcrRecognizedText | string) => void;
  /** Latest checksum-valid IBAN found this session, or `null`. */
  validIban: string | null;
  /** Latest IBAN-shaped (not necessarily checksum-valid) read — live scan feedback. */
  lastCandidate: string | null;
  /** Clears the latest valid read (e.g. after "Erneut scannen"). */
  resetValidIban: () => void;
}

/**
 * Wraps camera frames (via the caller's `<Camera mode="recognize" />`)
 * around `extractIbanCandidate` + the existing `validateIban` (ibantools) —
 * no hand-rolled mod-97 checksum here or anywhere else (CHKT-03). A
 * camera/permission error surfaces via `permissionDenied` so `IbanScanBlock`
 * can redirect straight to manual entry (D-08).
 */
export function useIbanScan(): UseIbanScanResult {
  const device = useCameraDevice('back');
  const { hasPermission, status, requestPermission } = useCameraPermission();
  const [validIban, setValidIban] = useState<string | null>(null);
  const [lastCandidate, setLastCandidate] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  useEffect(() => {
    if (hasPermission) {
      return;
    }
    if (status === 'denied' || status === 'restricted') {
      setPermissionDenied(true);
      return;
    }
    requestPermission()
      .then((granted) => {
        if (!granted) {
          setPermissionDenied(true);
        }
      })
      .catch(() => {
        setPermissionDenied(true);
      });
  }, [hasPermission, status, requestPermission]);

  const handleRecognizedText = useCallback((data: OcrRecognizedText | string) => {
    const resultText = typeof data === 'string' ? data : data.resultText;
    if (__DEV__ && resultText.trim().length > 0) {
      // Dev-only OCR trace (grep logcat for OCR-TRACE) — shows the raw ML Kit
      // read so misread glyphs can be diagnosed against the printed IBAN.
      console.log(`[OCR-TRACE][iban] ${JSON.stringify(resultText.slice(0, 200))}`);
    }
    const candidates = extractIbanCandidates(resultText);
    // Bind the first element once and narrow on IT rather than on `.length` —
    // noUncheckedIndexedAccess types `candidates[0]` as `string | undefined`
    // and cannot connect it to the length check. Same early return under the
    // same condition: an empty array has no first element.
    const first = candidates[0];
    if (!first) {
      return;
    }
    // Live progress for the scanning overlay: real signal that an IBAN-shaped
    // string is being read (even while the checksum still rejects misreads).
    setLastCandidate(first);
    for (const candidate of candidates) {
      // Longest-prefix search over raw + glyph-normalized variants — the
      // mod-97 checksum (+ country length) stays the only accept gate.
      const accepted = checksumValidIbanFrom(candidate);
      if (__DEV__) {
        console.log(`[OCR-TRACE][iban] candidate=${candidate} accepted=${accepted ?? 'no'}`);
      }
      if (accepted) {
        setValidIban(accepted);
        return;
      }
    }
  }, []);

  const resetValidIban = useCallback(() => {
    setValidIban(null);
    setLastCandidate(null);
  }, []);

  return { device, hasPermission, permissionDenied, handleRecognizedText, validIban, lastCandidate, resetValidIban };
}
