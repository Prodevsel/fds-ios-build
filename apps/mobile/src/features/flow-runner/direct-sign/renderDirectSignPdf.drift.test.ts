import { describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import {
  renderDirectSignPdf as deviceRender,
  toWinAnsi as deviceWinAnsi,
  topOriginToPdfY as deviceY,
} from './renderDirectSignPdf';
import {
  renderDirectSignPdf as edgeRender,
  toWinAnsi as edgeWinAnsi,
  topOriginToPdfY as edgeY,
} from '../../../../../../supabase/functions/webhook-dispatcher/renderDirectSignPdf.ts';

/**
 * The device renderer and the Edge renderer must produce the SAME DOCUMENT.
 *
 * Deno resolves neither the bare `@cantoo/pdf-lib` specifier this workspace
 * uses nor a path outside supabase/functions/, so the renderer exists twice —
 * the same wall that already forced `direct-sign-fields.ts` to be duplicated.
 * This is the file that keeps the copy a copy, and it compares BYTES rather
 * than descriptions of behaviour: a divergence here means the customer signed
 * one document and the archive holds another, which is the exact failure the
 * whole on-device rendering change exists to prevent.
 *
 * Vitest can import the Deno module directly (it is plain TypeScript once the
 * https: pdf-lib specifier resolves through the workspace copy), the same trick
 * `direct-sign-fields.drift.test.ts` already uses.
 */

/** A minimal valid 1x1 transparent PNG — the signature artifact stand-in. */
const ONE_PX_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  ),
  (c) => c.charCodeAt(0),
);

async function fixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  doc.addPage([595, 842]);
  return await doc.save({ useObjectStreams: false });
}

const SIGNATURE = { pngBytes: ONE_PX_PNG, page: 1, xFrac: 0.3125, yFrac: 0.8432 };
const FIELDS = [
  { text: 'Vizionists GmbH', page: 1, xFrac: 0.2621, yFrac: 0.2209, fontSize: 11 },
  { text: 'Max', page: 1, xFrac: 0.2621, yFrac: 0.3492, fontSize: 11 },
  { text: 'DE02120300000000202051', page: 2, xFrac: 0.2621, yFrac: 0.5286, fontSize: 11 },
];

describe('renderDirectSignPdf: device vs Edge', () => {
  it('produces byte-identical documents for the same input', async () => {
    const original = await fixture();
    const a = await deviceRender(new Uint8Array(original), SIGNATURE, FIELDS);
    const b = await edgeRender(new Uint8Array(original), SIGNATURE, FIELDS);
    // A PDF carries no creation timestamp here (pdf-lib only writes one via
    // setCreationDate, which neither renderer calls), so equal input must give
    // equal output. If this ever fails on a metadata field rather than on
    // content, THAT is the finding — do not weaken it to a length check.
    expect(Buffer.from(b).toString('base64')).toBe(Buffer.from(a).toString('base64'));
  });

  it('agrees on the y-axis origin', () => {
    for (const f of [0, 0.25, 0.5, 0.8432, 1]) {
      expect(deviceY(f, 842)).toBe(edgeY(f, 842));
    }
  });

  it('agrees on what Helvetica can draw', () => {
    for (const s of ['Müller', 'Erdoğan', 'Łukasz', 'Straße 12', 'Ünal & Söhne']) {
      expect(deviceWinAnsi(s)).toBe(edgeWinAnsi(s));
    }
  });

  it('rejects an out-of-range page on both sides, with the same message', async () => {
    const original = await fixture();
    const bad = { ...SIGNATURE, page: 9 };
    const a = await deviceRender(new Uint8Array(original), bad).catch((e: Error) => e.message);
    const b = await edgeRender(new Uint8Array(original), bad).catch((e: Error) => e.message);
    expect(a).toBe(b);
  });
});
