import { describe, expect, it, vi } from 'vitest';

// reviewRows.ts imports contractsRepo.ts (for parseIdentityAnswerName,
// the SSOT this module deliberately reuses instead of re-deriving), which pulls
// expo-crypto at module scope for its id derivation. Mirrors the mocking
// precedent contractsRepo.test.ts / flowDraftsRepo.test.ts already set — the
// functions under test never reach it.
vi.mock('expo-crypto', () => ({
  digestStringAsync: vi.fn(),
  randomUUID: vi.fn(() => 'ab12cd34-ef56-7890-abcd-ef1234567890'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

import type { Block } from '@frontdoorsales/flow-schema';
import { buildReviewRows } from './reviewRows';

/**
 * The pre-signature review list is the last thing standing between a typo and
 * a legally binding contract, so these assertions are about two things and
 * nothing else: WHICH blocks earn a correctable row, and WHAT their answer is
 * allowed to read as on a screen the customer is holding.
 *
 * Every case builds the block list the way `FlowRunnerScreen` does — already
 * show-if filtered, in visible order — because `ReviewRow.index` is handed
 * straight back as a `currentIndex` jump target. A test that fed the raw
 * unfiltered list would assert indices the app never uses.
 */

function block(partial: Partial<Block> & { type: Block['type']; id: string }): Block {
  return { label: partial.id, gate: false, ...partial } as Block;
}

const textIntro = block({ type: 'text', id: 'intro', label: 'Willkommen' });
const textNote = block({ type: 'text', id: 'notiz', label: 'Notiz', multiline: true });
const choice = block({
  type: 'choice',
  id: 'paket',
  label: 'Paket',
  options: [
    { value: 'basic', label: 'Basic' },
    { value: 'max', label: 'Max' },
  ],
});
const slider = block({ type: 'slider', id: 'geraete', label: 'Geräte', min: 1, max: 9, step: 1, unit: 'Stück' });
const contact = block({ type: 'contact', id: 'mail', label: 'E-Mail', field: 'email', required: true });
const ibanScan = block({ type: 'iban-scan', id: 'iban', label: 'IBAN' });
const idScan = block({ type: 'id-scan', id: 'ausweis', label: 'Ausweis' });
const belehrung = block({ type: 'belehrung', id: 'widerruf', label: 'Widerrufsbelehrung', gate: true, noticeText: 'N' });
const discount = block({
  type: 'discount',
  id: 'rabatt',
  label: 'Türpreis',
  termsRef: 'terms-1',
  showComparisonPrice: true,
  emphasize: true,
});
const signature = block({ type: 'signature', id: 'unterschrift', label: 'Unterschrift', gate: true });

const SERIALIZED_ID = JSON.stringify({
  surname: 'MUSTERMANN',
  givenNames: 'ERIKA',
  birthDate: '12.08.1964',
  documentNumber: 'L01X00T47',
  nationality: 'DEU',
  expiryDate: '31.10.2031',
});

describe('buildReviewRows — which blocks earn a row', () => {
  it('skips blocks that have no answer at all', () => {
    expect(buildReviewRows([choice, slider], {})).toEqual([]);
  });

  it('skips the pure info text block even though tapping Next answered it', () => {
    // TextBlock renders no input when `multiline` is absent, so its stored ''
    // answer is a "seen it" acknowledgement, not something correctable.
    expect(buildReviewRows([textIntro], { intro: '' })).toEqual([]);
  });

  it('includes a multiline text block that actually holds a note', () => {
    const rows = buildReviewRows([textIntro, textNote], { intro: '', notiz: 'Hinterhof, 2. OG' });
    expect(rows).toEqual([
      { blockId: 'notiz', index: 1, label: 'Notiz', value: 'Hinterhof, 2. OG', masked: false },
    ]);
  });

  it('skips a multiline text block the rep left blank', () => {
    expect(buildReviewRows([textNote], { notiz: '   ' })).toEqual([]);
  });

  it('never rows the discount hero — its answer is an acknowledgement of a frozen price', () => {
    expect(buildReviewRows([discount], { rabatt: true })).toEqual([]);
  });

  it('never rows the signature block itself', () => {
    expect(buildReviewRows([signature], { unterschrift: true })).toEqual([]);
  });

  it('rows a confirmed withdrawal notice so the customer can see it was presented', () => {
    const rows = buildReviewRows([belehrung], { widerruf: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.blockId).toBe('widerruf');
  });

  it('does not row an unconfirmed withdrawal notice', () => {
    expect(buildReviewRows([belehrung], { widerruf: false })).toEqual([]);
  });
});

describe('buildReviewRows — how an answer reads', () => {
  it('renders the human option label, not the stored machine value', () => {
    const rows = buildReviewRows([choice], { paket: 'max' });
    expect(rows[0]?.value).toBe('Max');
  });

  it('falls back to the raw value when the chosen option no longer exists', () => {
    // A later product version can drop an option; an honest ugly row beats a
    // silently vanished one, because the vanished one cannot be corrected.
    const rows = buildReviewRows([choice], { paket: 'legacy_tier' });
    expect(rows[0]?.value).toBe('legacy_tier');
  });

  it('appends the authored slider unit', () => {
    expect(buildReviewRows([slider], { geraete: 3 })[0]?.value).toBe('3 Stück');
  });

  it('ignores a non-numeric slider answer rather than printing NaN', () => {
    expect(buildReviewRows([slider], { geraete: 'drei' })).toEqual([]);
  });

  it('shows a contact answer verbatim — a typo here is the whole point', () => {
    expect(buildReviewRows([contact], { mail: ' erika@example.de ' })[0]?.value).toBe('erika@example.de');
  });
});

describe('buildReviewRows — redaction is narrow on purpose (the screen exists to be read)', () => {
  it('prints the IBAN IN FULL — a masked IBAN cannot be checked, which is the screen\'s only job', () => {
    const rows = buildReviewRows([ibanScan], { iban: 'DE44 5001 0517 5407 3249 31' });
    expect(rows[0]?.value).toBe('DE44 5001 0517 5407 3249 31');
    expect(rows[0]?.masked).toBe(false);
    // The regression this guards: an OCR that reads a 6 as an 8 is invisible
    // behind "DE44 … 31", and the direct debit fails weeks after the booking.
    expect(rows[0]?.value).toContain('5001');
  });

  it('keeps the authored grouping of a partial IBAN instead of eliding it', () => {
    const rows = buildReviewRows([ibanScan], { iban: 'DE44' });
    expect(rows[0]?.value).toBe('DE44');
    expect(rows[0]?.masked).toBe(false);
  });

  it('never prints a full ID document number', () => {
    const rows = buildReviewRows([idScan], { ausweis: SERIALIZED_ID });
    expect(rows[0]?.value).toBe('ERIKA MUSTERMANN · 12.08.1964 · … 47');
    expect(rows[0]?.masked).toBe(true);
    expect(rows[0]?.value).not.toContain('L01X00T47');
  });

  it('degrades a legacy plain-string id answer to the raw value instead of throwing', () => {
    const rows = buildReviewRows([idScan], { ausweis: 'Erika Mustermann' });
    expect(rows[0]?.value).toBe('Erika Mustermann');
    expect(rows[0]?.masked).toBe(false);
  });

  it('survives a corrupt id answer', () => {
    const rows = buildReviewRows([idScan], { ausweis: '{not json' });
    expect(rows[0]?.value).toBe('{not json');
  });
});

describe('buildReviewRows — indices are jump targets into the visible list', () => {
  it('reports the index of the block within the list it was given', () => {
    const visible = [textIntro, choice, slider, ibanScan, idScan, belehrung, signature];
    const rows = buildReviewRows(visible, {
      intro: '',
      paket: 'basic',
      geraete: 2,
      iban: 'DE44 5001 0517 5407 3249 31',
      ausweis: SERIALIZED_ID,
      widerruf: true,
      unterschrift: true,
    });
    // Rows stay in flow order, and each index addresses the SAME array slot
    // FlowRunnerScreen's currentIndex addresses — this is what makes the tap
    // land on the right screen.
    expect(rows.map((row) => [row.blockId, row.index])).toEqual([
      ['paket', 1],
      ['geraete', 2],
      ['iban', 3],
      ['ausweis', 4],
      ['widerruf', 5],
    ]);
    for (const row of rows) {
      expect(visible[row.index]?.id).toBe(row.blockId);
    }
  });
});
