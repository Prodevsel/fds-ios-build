import { describe, expect, it } from 'vitest';
import {
  type FieldBlock,
  formatPlacementValue as edgeFormat,
  resolveDirectSignFields as edgeResolve,
} from '../../../supabase/functions/webhook-dispatcher/directSignFields.ts';
import {
  formatPlacementValue as schemaFormat,
  resolveDirectSignFields as schemaResolve,
} from './direct-sign-fields.ts';
import type { Block } from './product-definition.ts';

/**
 * The Edge Function cannot import this package (Deno resolves neither the bare
 * `zod` specifier nor a path outside supabase/functions/), so the stamped-value
 * rule exists twice. A silent divergence would mean the customer signs a
 * document whose wording differs from the preview they approved — this test is
 * what keeps the copy a copy.
 */
const BLOCKS: Block[] = [
  {
    type: 'choice',
    id: 'paket',
    label: 'Paket',
    gate: false,
    options: [
      { value: 'basic', label: 'Basic — 12 Inhalte im Monat' },
      { value: 'plus', label: 'Plus — 20 Inhalte, acht Reels' },
    ],
  },
  {
    type: 'slider',
    id: 'standorte',
    label: 'Standorte',
    gate: false,
    min: 1,
    max: 10,
    step: 1,
    unit: 'Standorte',
  },
  { type: 'slider', id: 'nackt', label: 'Ohne Einheit', gate: false, min: 0, max: 5, step: 1 },
  { type: 'contact', id: 'email', label: 'E-Mail', gate: true, field: 'email', required: true },
  { type: 'text', id: 'notiz', label: 'Notiz', gate: false },
];

const ANSWER_CASES: Record<string, unknown>[] = [
  { paket: 'plus', standorte: 3, nackt: 0, email: 'a@b.de', notiz: 'Hallo' },
  { paket: 'unbekannt', standorte: 1, email: '', notiz: '   ' },
  { paket: undefined, standorte: null },
  {},
];

describe('flow-schema and the Edge Function agree on stamped values', () => {
  it('formats every block/answer pair identically', () => {
    for (const answers of ANSWER_CASES) {
      for (const block of BLOCKS) {
        expect(edgeFormat(block as FieldBlock, answers[block.id])).toBe(
          schemaFormat(block, answers[block.id]),
        );
      }
    }
  });

  it('resolves the same field list, including the drops', () => {
    const placements = [
      { blockId: 'paket', page: 1, xFrac: 0.5, yFrac: 0.4 },
      { blockId: 'standorte', page: 1, xFrac: 0.2, yFrac: 0.3, fontSize: 9 },
      { blockId: 'nackt', page: 2, xFrac: 0.1, yFrac: 0.1 },
      { blockId: 'email', page: 2, xFrac: 0.3, yFrac: 0.2 },
      { blockId: 'notiz', page: 2, xFrac: 0.4, yFrac: 0.5 },
      { blockId: 'geloescht', page: 1, xFrac: 0.9, yFrac: 0.9 },
    ];
    for (const answers of ANSWER_CASES) {
      expect(edgeResolve(placements, BLOCKS as FieldBlock[], answers)).toEqual(
        schemaResolve(placements, BLOCKS, answers),
      );
    }
  });
});

/**
 * The two lines that came back blank on the first contract a customer ever
 * signed: "Monatlich:" (the package price, which is not an answer of its own)
 * and "Anschrift:" (which the flow never asks, because the consultation was
 * started from a house that already has one). Both copies must agree on how
 * those are resolved, or the preview and the document say different things.
 */
describe('part and source resolve identically on both sides', () => {
  const PRICED_CHOICE = {
    type: 'choice' as const,
    id: 'paket',
    label: 'Paket',
    gate: false,
    options: [
      { value: 'plus', label: 'Plus', price: '199,00 EUR mtl.' },
      { value: 'basic', label: 'Basic' },
    ],
  };

  it("part: 'price' stamps the price, the default stamps the label", () => {
    expect(schemaFormat(PRICED_CHOICE, 'plus', 'price')).toBe('199,00 EUR mtl.');
    expect(edgeFormat(PRICED_CHOICE as never, 'plus', 'price')).toBe('199,00 EUR mtl.');
    expect(schemaFormat(PRICED_CHOICE, 'plus')).toBe('Plus');
    expect(edgeFormat(PRICED_CHOICE as never, 'plus')).toBe('Plus');
  });

  it('an option without a price stamps nothing, never an empty box', () => {
    expect(schemaFormat(PRICED_CHOICE, 'basic', 'price')).toBe('');
    expect(edgeFormat(PRICED_CHOICE as never, 'basic', 'price')).toBe('');
  });

  it('a source placement reads the context and needs no block at all', () => {
    const placements = [
      { blockId: 'unused', source: 'house.address', page: 1, xFrac: 0.2, yFrac: 0.3, fontSize: 11 },
    ];
    const ctx = { 'house.address': 'Marktplatz 8, 71229 Leonberg' };
    const a = schemaResolve(placements, [], {}, ctx);
    const b = edgeResolve(placements as never, [], {}, ctx);
    expect(a.map((f) => f.text)).toEqual(['Marktplatz 8, 71229 Leonberg']);
    expect(b.map((f) => f.text)).toEqual(a.map((f) => f.text));
  });

  it('an unknown context key stamps nothing, never the key name', () => {
    const placements = [
      { blockId: 'x', source: 'house.address', page: 1, xFrac: 0.2, yFrac: 0.3, fontSize: 11 },
    ];
    expect(schemaResolve(placements, [], {}, {})).toEqual([]);
    expect(edgeResolve(placements as never, [], {}, {})).toEqual([]);
  });
});
