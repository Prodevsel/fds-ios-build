import { describe, expect, it } from 'vitest';
import {
  directSignQuestionBlocks,
  formatPlacementValue,
  resolveDirectSignFields,
} from './direct-sign-fields.ts';
import type { Block } from './product-definition.ts';

const PAKET: Block = {
  type: 'choice',
  id: 'paket',
  label: 'Welches Paket passt zum Bedarf?',
  gate: false,
  options: [
    { value: 'basic', label: 'Basic — 12 Inhalte im Monat, ein Kanal' },
    { value: 'plus', label: 'Plus — 20 Inhalte im Monat, bis zu acht Reels' },
  ],
};

const STANDORTE: Block = {
  type: 'slider',
  id: 'standorte',
  label: 'Fuer wie viele Standorte?',
  gate: false,
  min: 1,
  max: 10,
  step: 1,
  unit: 'Standorte',
};

const EMAIL: Block = {
  type: 'contact',
  id: 'email',
  label: 'E-Mail',
  gate: true,
  field: 'email',
  required: true,
};

const SIGNATURE: Block = { type: 'signature', id: 'sig', label: 'Unterschrift', gate: false };

describe('directSignQuestionBlocks', () => {
  it('keeps what a package selection needs and drops the fixed/unsupported steps', () => {
    const blocks: Block[] = [
      PAKET,
      STANDORTE,
      EMAIL,
      SIGNATURE,
      { type: 'belehrung', id: 'b', label: 'Widerruf', gate: true, noticeText: 'x' },
      // iban-scan is ASKABLE here: it writes one normalized string and retains
      // no image, so the "attachment machinery" that justified excluding it
      // never applied. Without it a direct_pdf product could sell a monthly
      // price with no way to collect it.
      { type: 'iban-scan', id: 'iban', label: 'IBAN', gate: false, optional: false },
    ];
    expect(directSignQuestionBlocks(blocks).map((b) => b.id)).toEqual([
      'paket',
      'standorte',
      'email',
      'iban',
    ]);
  });

  it('still drops id-scan: a COMPANY has no identity document to present', () => {
    const blocks: Block[] = [
      PAKET,
      { type: 'id-scan', id: 'ausweis', label: 'Ausweis', gate: false },
    ];
    expect(directSignQuestionBlocks(blocks).map((b) => b.id)).toEqual(['paket']);
  });

  it('keeps a company contact field — the customer is not always a person', () => {
    const blocks: Block[] = [
      { type: 'contact', id: 'customerCompany', label: 'Firma', gate: true, field: 'company', required: true },
    ];
    expect(directSignQuestionBlocks(blocks).map((b) => b.id)).toEqual(['customerCompany']);
  });
});

describe('formatPlacementValue', () => {
  it('stamps the option LABEL a customer chose, never the database key', () => {
    expect(formatPlacementValue(PAKET, 'plus')).toBe(
      'Plus — 20 Inhalte im Monat, bis zu acht Reels',
    );
  });

  it('falls back to the raw value for an option that no longer exists', () => {
    expect(formatPlacementValue(PAKET, 'max')).toBe('max');
  });

  it('appends a slider unit', () => {
    expect(formatPlacementValue(STANDORTE, 3)).toBe('3 Standorte');
  });

  it('renders an unanswered block as empty, never "undefined"', () => {
    expect(formatPlacementValue(PAKET, undefined)).toBe('');
    expect(formatPlacementValue(EMAIL, null)).toBe('');
  });
});

describe('resolveDirectSignFields', () => {
  const placements = [
    { blockId: 'paket', page: 1, xFrac: 0.5, yFrac: 0.4 },
    { blockId: 'standorte', page: 2, xFrac: 0.2, yFrac: 0.8, fontSize: 9 },
  ];

  it('joins placement, block and answer, defaulting the font size', () => {
    const fields = resolveDirectSignFields(placements, [PAKET, STANDORTE], {
      paket: 'basic',
      standorte: 2,
    });
    expect(fields).toEqual([
      {
        text: 'Basic — 12 Inhalte im Monat, ein Kanal',
        page: 1,
        xFrac: 0.5,
        yFrac: 0.4,
        fontSize: 11,
      },
      { text: '2 Standorte', page: 2, xFrac: 0.2, yFrac: 0.8, fontSize: 9 },
    ]);
  });

  it('drops a placement whose block is gone from this product version', () => {
    const fields = resolveDirectSignFields(placements, [PAKET], { paket: 'basic', standorte: 2 });
    expect(fields.map((f) => f.text)).toEqual(['Basic — 12 Inhalte im Monat, ein Kanal']);
  });

  it('drops an unanswered placement instead of stamping a blank box', () => {
    const fields = resolveDirectSignFields(placements, [PAKET, STANDORTE], { paket: 'basic' });
    expect(fields).toHaveLength(1);
  });
});

/**
 * The seeded smaica contract, end to end.
 *
 * Not a unit test of the resolver — a pin on the SEEDED DATA. Every
 * direct_sign_templates row in the demo carried `field_placements = []`, so the
 * variable machinery built in d422ff3 stamped nothing into any document, and
 * nothing failed to say so. These assertions fail loudly if a block id in the
 * product and a blockId in the placements ever drift apart again.
 */
describe('smaica direct-sign template v2 (seeded placements)', () => {
  const PLACEMENTS = [
    { blockId: 'customerName', page: 1, xFrac: 0.2621, yFrac: 0.2209, fontSize: 11 },
    { blockId: 'customerCompany', page: 1, xFrac: 0.2621, yFrac: 0.2209, fontSize: 11 },
    { blockId: 'email', page: 1, xFrac: 0.2621, yFrac: 0.2684, fontSize: 11 },
    { blockId: 'ansprechpartner', page: 1, xFrac: 0.2621, yFrac: 0.2922, fontSize: 11 },
    { blockId: 'paket', page: 1, xFrac: 0.2621, yFrac: 0.3492, fontSize: 11 },
    { blockId: 'standorte', page: 1, xFrac: 0.2621, yFrac: 0.373, fontSize: 11 },
    { blockId: 'iban', page: 1, xFrac: 0.2621, yFrac: 0.5286, fontSize: 11 },
  ];

  const PAKET_PRICED: Block = {
    type: 'choice',
    id: 'paket',
    label: 'Welches Paket?',
    gate: false,
    options: [
      { value: 'basic', label: 'Basic', description: '12 Inhalte', price: '99,00 EUR mtl.' },
      { value: 'max', label: 'Max', description: '30 Inhalte', price: '499,00 EUR mtl.' },
    ],
  };
  const BLOCKS: Block[] = [
    PAKET_PRICED,
    STANDORTE,
    { type: 'contact', id: 'customerName', label: 'Name', gate: true, field: 'name', required: true },
    { type: 'contact', id: 'customerCompany', label: 'Firma', gate: true, field: 'company', required: true },
    { type: 'contact', id: 'ansprechpartner', label: 'Ansprechperson', gate: false, field: 'name', required: false },
    EMAIL,
    { type: 'iban-scan', id: 'iban', label: 'IBAN', gate: false, optional: true },
  ];

  it('stamps a COMPANY close: firma, ansprechperson, paket, standorte, iban — and no person name', () => {
    const fields = resolveDirectSignFields(PLACEMENTS, BLOCKS, {
      customerCompany: 'Vizionists GmbH',
      ansprechpartner: 'Sam Elkhalil',
      email: 'sam@elkhalil.dev',
      paket: 'max',
      standorte: 3,
      iban: 'DE02120300000000202051',
    });
    const texts = fields.map((f) => f.text);
    expect(texts).toContain('Vizionists GmbH');
    expect(texts).toContain('Sam Elkhalil');
    expect(texts).toContain('sam@elkhalil.dev');
    // The option NAME, never the database key — 'max' would be meaningless on a contract.
    expect(texts).toContain('Max');
    expect(texts).toContain('3 Standorte');
    expect(texts).toContain('DE02120300000000202051');
    expect(fields).toHaveLength(6);
  });

  it('stamps a PERSON close and leaves the company/ansprechperson lines blank', () => {
    const fields = resolveDirectSignFields(PLACEMENTS, BLOCKS, {
      customerName: 'Erika Mustermann',
      email: 'e@example.de',
      paket: 'basic',
      standorte: 1,
    });
    const texts = fields.map((f) => f.text);
    expect(texts).toContain('Erika Mustermann');
    expect(texts).toContain('Basic');
    // A skipped IBAN writes NO answer, so it must produce no stamp rather than
    // an empty box on a signed contract.
    expect(fields.some((f) => f.text.startsWith('DE'))).toBe(false);
    expect(fields).toHaveLength(4);
  });

  it('puts firma and person name on the SAME line — the form has one "Name / Firma" row', () => {
    const person = resolveDirectSignFields(PLACEMENTS, BLOCKS, { customerName: 'A' })[0];
    const firma = resolveDirectSignFields(PLACEMENTS, BLOCKS, { customerCompany: 'B' })[0];
    expect({ x: person.xFrac, y: person.yFrac }).toEqual({ x: firma.xFrac, y: firma.yFrac });
  });
});

