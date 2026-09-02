import { describe, expect, it, vi } from 'vitest';

// No react-test-renderer in this repo (IbanScanBlock.test.tsx precedent) —
// only the pure, exported parseIdMrz core is exercised. useIdScan.ts imports
// 'react-native-vision-camera' at module scope for the hook half of the
// file, so it must be mocked here even though useIdScan() itself is never
// invoked (no camera/permission native module in a Vitest node environment).
vi.mock('react-native-vision-camera', () => ({
  useCameraDevice: () => undefined,
  useCameraPermission: () => ({ hasPermission: false, requestPermission: async () => false }),
}));

import { cleanMrzName, parseIdMrz, restoreMrzFillers } from './useIdScan';

// A hand-assembled, checksum-valid TD1 (German ID card) MRZ sample —
// verified valid via mrz.parse() directly against this exact triple during
// authoring (all per-field + composite check digits pass ICAO 9303 mod-10
// weighted checksum, weights 7/3/1).
const VALID_TD1_LINES = [
  'IDD<<C01X00T478<<<<<<<<<<<<<<<',
  '6408125F2910312DEU<<<<<<<<<<<4',
  'MUSTERMANN<<ERIKA<<<<<<<<<<<<<',
];

describe('parseIdMrz (CHKT-01: OCR-text -> structured ID fields, camera-independent)', () => {
  it('returns the 6-field structured object on a valid German TD1 MRZ read', () => {
    const result = parseIdMrz(VALID_TD1_LINES.join('\n'));

    expect(result.valid).toBe(true);
    expect(result.fields).toEqual({
      surname: 'MUSTERMANN',
      givenNames: 'ERIKA',
      birthDate: '640812',
      documentNumber: 'C01X00T47',
      nationality: 'DEU',
      expiryDate: '291031',
    });
  });

  it('returns { valid: false } on garbage/partial text, never throwing (CHKT-03 fallback contract)', () => {
    expect(() => parseIdMrz('not an mrz at all')).not.toThrow();
    expect(parseIdMrz('not an mrz at all')).toEqual({ valid: false });

    expect(parseIdMrz('')).toEqual({ valid: false });

    // Partial/truncated MRZ (only one of the three TD1 lines).
    expect(parseIdMrz(VALID_TD1_LINES[0] ?? '')).toEqual({ valid: false });
  });

  it('returns { valid: false } for a corrupted check digit (bad OCR read of one character)', () => {
    const corrupted = [...VALID_TD1_LINES];
    // Flip the composite check digit (last char of line 2) so ICAO checksum fails.
    corrupted[1] = `${(corrupted[1] ?? '').slice(0, -1)}9`;
    expect(parseIdMrz(corrupted.join('\n'))).toEqual({ valid: false });
  });

  it('reads an MRZ whose < fillers were OCR-read as K (ML Kit filler misread — IBAN-parity robustness)', () => {
    // The exact failure the old `.includes("<")` filter dropped: ML Kit eats
    // every '<' into 'K', so the line holds no literal '<'. restoreMrzFillers
    // brings the padding runs back; the check digits still gate acceptance.
    const kEaten = VALID_TD1_LINES.map((line) => line.replace(/</g, 'K'));
    const result = parseIdMrz(kEaten.join('\n'));
    expect(result.valid).toBe(true);
    expect(result.fields?.documentNumber).toBe('C01X00T47');
    expect(result.fields?.givenNames).toBe('ERIKA'); // a genuine interior 'K' survives
    expect(result.fields?.nationality).toBe('DEU');
  });

  it('never throws for arbitrary/malformed input (defensive contract)', () => {
    expect(() => parseIdMrz('\n\n\n')).not.toThrow();
    expect(() => parseIdMrz('a'.repeat(500))).not.toThrow();
  });
});

describe('parseIdMrz field keys match the manual-entry fallback shape (D-24)', () => {
  it('produces exactly surname/givenNames/birthDate/documentNumber/nationality/expiryDate', () => {
    const result = parseIdMrz(VALID_TD1_LINES.join('\n'));
    expect(result.fields ? Object.keys(result.fields).sort() : []).toEqual(
      ['birthDate', 'documentNumber', 'expiryDate', 'givenNames', 'nationality', 'surname'].sort(),
    );
  });
});

describe('module loads without a live camera (react-native-vision-camera mocked)', () => {
  it('useIdScan is exported alongside the pure core', async () => {
    const mod = await import('./useIdScan');
    expect(typeof mod.useIdScan).toBe('function');
    expect(typeof mod.parseIdMrz).toBe('function');
  });
});

describe('restoreMrzFillers (ML Kit reads < as K/C)', () => {
  it('restores runs of 2+ K/C and any trailing run to <', () => {
    expect(restoreMrzFillers('MUSTERMANNKKERIKAKKKKK')).toBe('MUSTERMANN<<ERIKA<<<<<');
    expect(restoreMrzFillers('6408125F2910312DEUKKKKKKKKKKK4')).toBe('6408125F2910312DEU<<<<<<<<<<<4');
  });
  it('leaves single interior K/C alone (genuine letters — names, doc-number alphabet)', () => {
    expect(restoreMrzFillers('ERIKA')).toBe('ERIKA'); // interior K preserved
    expect(restoreMrzFillers('C01X00T47')).toBe('C01X00T47'); // leading doc-number C preserved
  });
});

describe('cleanMrzName (OCR filler artifacts)', () => {
  it('strips trailing single-letter K/C runs — "<" fillers misread by OCR', () => {
    expect(cleanMrzName('SAM K K K')).toBe('SAM');
    expect(cleanMrzName('ERIKA GISELA C K')).toBe('ERIKA GISELA');
  });

  it('keeps legitimate names and collapses inner whitespace', () => {
    expect(cleanMrzName('KARL  HEINZ')).toBe('KARL HEINZ');
    expect(cleanMrzName('KIM')).toBe('KIM');
  });
});
