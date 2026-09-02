// apps/mobile/src/features/flow-runner/direct-sign/renderDirectSignPdf.ts
//
// The direct-sign artifact, rendered ON THE DEVICE.
//
// ── Why this exists twice ───────────────────────────────────────────────────
//
// The authoritative copy is supabase/functions/webhook-dispatcher/
// renderDirectSignPdf.ts. Deno resolves neither the bare `@cantoo/pdf-lib`
// specifier this workspace uses nor a path outside supabase/functions/, so the
// two cannot share a module — the same wall that already forced
// direct-sign-fields.ts to exist twice, with `direct-sign-fields.drift.test.ts`
// holding the copies together. `renderDirectSignPdf.drift.test.ts` does the
// same job here, and it compares BYTES, not behaviour descriptions.
//
// ── Why the device renders at all ───────────────────────────────────────────
//
// Until now the customer signed a BLANK form: the viewer showed the untouched
// template, the signature was captured, and the values were stamped afterwards
// on the server. The audit package froze `originalTemplateSha256` — the hash of
// the EMPTY document. Nobody ever hashed what the customer actually agreed to.
//
// That is a Blankounterschrift: the customer signs, the other party fills in
// the content afterwards. Rendering here closes it — the device produces the
// finished document, hashes THOSE bytes, and the audit package records the hash
// of the page that was signed.
//
// Measured before this was written (V8, @cantoo/pdf-lib 2.8.1): a 4 kB template
// renders in 15 ms, a 138 kB 60-page contract in 92 ms, a 0.84 MB document with
// images in 44 ms. Load time tracks the object-graph size, NOT the byte count —
// pdf-lib parses the structure and never decodes images. Hermes is slower than
// V8 by a factor, and the headroom absorbs it.
//
// LOAD, never PDFDocument.create(): the tenant's document is overlaid, never
// regenerated. That is the whole meaning of "signed unchanged".

import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';

/** Bumped independently of the server's — the two are compared, not assumed equal. */
export const DEVICE_DIRECT_SIGN_GENERATOR_VERSION = 'mobile/renderDirectSignPdf@1.0.0';

/** Fixed signature stamp footprint in PDF points. Mirrors the server renderer. */
/**
 * The signature's BOX, not its size.
 *
 * It used to be drawn at a fixed 140x50, which stretched every signature to
 * that exact ratio — a wide flourish got squashed, a tall one got pulled
 * sideways, and neither looked like the mark the customer actually made. On a
 * contract that is not a cosmetic problem: a signature is compared against
 * other signatures.
 *
 * The stamp is now FITTED inside this box, keeping the captured aspect ratio
 * and centred on the anchor's baseline.
 */
const SIGNATURE_MAX_WIDTH_PT = 160;
const SIGNATURE_MAX_HEIGHT_PT = 56;

/** Largest size that keeps `img`'s aspect ratio inside the box above. */
function fitSignature(imgWidth: number, imgHeight: number): { width: number; height: number } {
  if (!(imgWidth > 0) || !(imgHeight > 0)) {
    // A degenerate PNG must not produce NaN on a legal document.
    return { width: SIGNATURE_MAX_WIDTH_PT, height: SIGNATURE_MAX_HEIGHT_PT };
  }
  const scale = Math.min(SIGNATURE_MAX_WIDTH_PT / imgWidth, SIGNATURE_MAX_HEIGHT_PT / imgHeight);
  return { width: imgWidth * scale, height: imgHeight * scale };
}

export interface FieldOverlay {
  text: string;
  /** ONE-based, the stored convention end to end. */
  page: number;
  xFrac: number;
  yFrac: number;
  fontSize: number;
}

export interface SignatureOverlay {
  pngBytes: Uint8Array;
  /** ONE-based, verbatim from `direct_sign_templates.signature_page`. */
  page: number;
  xFrac: number;
  yFrac: number;
}

/**
 * A stored `yFrac` counts from the TOP of the page; pdf-lib's y axis counts
 * from the BOTTOM. The single conversion point, mirroring the server's.
 *
 * The server passed the value through unconverted until this was found, so
 * every stamp landed mirrored — `signature_y_frac = 0.8432`, meant for the
 * signature line at the foot, put the signature at y=710pt on the contractor's
 * address line at the head of the page.
 */
export function topOriginToPdfY(yFrac: number, pageHeight: number): number {
  return (1 - yFrac) * pageHeight;
}

/** Map a string onto what Helvetica/WinAnsi can draw. Copy of winAnsi.ts. */
export function toWinAnsi(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    if (ch.charCodeAt(0) <= 0xff) {
      out += ch;
      continue;
    }
    const base = ch.normalize('NFD')[0];
    if (base && base.charCodeAt(0) <= 0xff) out += base;
  }
  return out;
}

export async function renderDirectSignPdf(
  originalPdfBytes: Uint8Array,
  signature: SignatureOverlay,
  fields: readonly FieldOverlay[] = [],
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(originalPdfBytes as BufferSource);
  const pageCount = pdfDoc.getPageCount();
  if (!Number.isInteger(signature.page) || signature.page < 1 || signature.page > pageCount) {
    throw new Error(
      `direct-sign signature.page (${signature.page}) is out of range for a ${pageCount}-page document — expected a 1-based page number between 1 and ${pageCount}`,
    );
  }
  const page = pdfDoc.getPage(signature.page - 1);
  const img = await pdfDoc.embedPng(signature.pngBytes as BufferSource);
  const { width, height } = page.getSize();

  const fitted = fitSignature(img.width, img.height);
  page.drawImage(img, {
    // CENTRED on the anchor, not started at it.
    //
    // pdf-lib's drawImage places the image's BOTTOM-LEFT corner at (x, y), so
    // passing the anchor straight through made a signature grow up and to the
    // RIGHT of the clicked point — a full 160x56pt box of drift from a point
    // the operator believed was the middle of the signature line. Text
    // placements never showed this because drawText takes a BASELINE, so the
    // same click meant two different things depending on which kind of anchor
    // it was.
    //
    // Centring is what the operator already means: on the current template the
    // stored x lands at 186pt against a signature line running 66..300pt, whose
    // middle is 183pt. It is also the industry reading — Adobe's seal
    // FieldLocation and DocuSign's tabs both define a signature as a RECTANGLE
    // the signature is fitted into, never a bare point. This keeps the stored
    // point but gives it the only unambiguous meaning a point can have: the
    // centre of the box.
    x: signature.xFrac * width - fitted.width / 2,
    // Vertically the anchor stays a BASELINE: a signature sits ON its line, it
    // does not straddle it.
    y: topOriginToPdfY(signature.yFrac, height),
    width: fitted.width,
    height: fitted.height,
  });

  if (fields.length > 0) {
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    for (const field of fields) {
      if (!Number.isInteger(field.page) || field.page < 1 || field.page > pageCount) {
        throw new Error(
          `direct-sign field page (${field.page}) is out of range for a ${pageCount}-page document`,
        );
      }
      const target = pdfDoc.getPage(field.page - 1);
      const size = target.getSize();
      target.drawText(toWinAnsi(field.text), {
        x: field.xFrac * size.width,
        y: topOriginToPdfY(field.yFrac, size.height),
        size: field.fontSize,
        font,
        color: rgb(0, 0, 0),
      });
    }
  }

  // useObjectStreams:false keeps the content stream uncompressed (D-19
  // verifiability) AND is load-bearing for the drift test: the two renderers
  // must produce identical bytes, and object streams reorder freely.
  return await pdfDoc.save({ useObjectStreams: false });
}

/**
 * A 1x1 fully transparent PNG.
 *
 * `renderDirectSignPdf` always embeds a signature, because on the real path
 * there always is one. The PREVIEW runs before the customer has signed, and a
 * preview must not show a signature that does not exist — drawing a
 * placeholder onto a contract would be a lie about a legal document. Embedding
 * something invisible keeps ONE renderer instead of a second "preview mode"
 * that could drift from the real one.
 */
export const TRANSPARENT_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

