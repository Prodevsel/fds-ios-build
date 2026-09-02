// apps/mobile/src/features/spike/directSignPdfLibSpike.ts
//
// Phase 10 Plan 07 (10-07) — SC1 on-device @cantoo/pdf-lib@2.8.1 feasibility
// spike (D-01, DSGN-03). PARALLEL / non-blocking per D-01: the server-side
// `renderDirectSignPdf.ts` (webhook-dispatcher) is the DEFAULT signing path
// regardless of this spike's outcome. This module is the pure measurement
// core — load / hash / embed a real PDF's bytes ON-DEVICE (RN/Hermes),
// mirroring renderDirectSignPdf.ts's LOAD-never-.create() + additive-overlay
// shape, but instrumented with per-phase timings and a byte-preservation
// check instead of a real placement result.
//
// Reuses hashPdfBytes.ts (10-05) verbatim (D-26 single hashing path) rather
// than a parallel hashing utility.

import { PDFDocument } from '@cantoo/pdf-lib';
import { hashPdfBytes } from '../flow-runner/direct-sign/hashPdfBytes';

/** Fixed signature stamp footprint in PDF points — matches renderDirectSignPdf.ts's convention. */
const SIGNATURE_WIDTH_PT = 140;
const SIGNATURE_HEIGHT_PT = 50;

export interface DirectSignPdfLibSpikeResult {
  /** ms for PDFDocument.load(originalBytes). */
  loadMs: number;
  /** ms for hashPdfBytes(originalBytes) — the SAME hasher the real audit package uses. */
  hashMs: number;
  /** ms for embedPng + drawImage + save() combined (the actual embed work). */
  embedMs: number;
  /** hashPdfBytes(originalBytes) — recorded so a human can diff against the template row's sha256. */
  originalHash: string;
  /** hashPdfBytes(the saved, signature-embedded bytes) — MUST differ from originalHash. */
  derivedHash: string;
  /**
   * True only if `originalBytes` (the caller's own buffer) is still
   * byte-for-byte identical AFTER PDFDocument.load()+embedPng()+save() ran
   * against it — proves pdf-lib never mutates its input in place on-device,
   * the same guarantee renderDirectSignPdf.test.ts proves server-side.
   */
  originalBytesUnchanged: boolean;
  originalByteLength: number;
  embeddedByteLength: number;
}

/**
 * Runs the full load -> hash -> embed -> byte-preserve cycle once, on
 * whatever `originalBytes` the caller loaded from disk. Never throws for a
 * "normal" pdf-lib error (load failure, embed failure) — those ARE the
 * feasibility signal and must surface to the caller, not be swallowed here.
 */
export async function runDirectSignPdfLibSpike(
  originalBytes: Uint8Array,
  signaturePngBytes: Uint8Array,
): Promise<DirectSignPdfLibSpikeResult> {
  // Snapshot BEFORE any pdf-lib call touches originalBytes, so
  // originalBytesUnchanged is a real byte-for-byte comparison against pdf-lib's
  // actual in-place-mutation behavior on-device, not an assumption carried
  // over from the server-side (Deno) proof.
  const snapshot = new Uint8Array(originalBytes);

  const loadStart = Date.now();
  const pdfDoc = await PDFDocument.load(originalBytes as BufferSource);
  const loadMs = Date.now() - loadStart;

  const hashStart = Date.now();
  const originalHash = await hashPdfBytes(originalBytes);
  const hashMs = Date.now() - hashStart;

  const embedStart = Date.now();
  const firstPage = pdfDoc.getPage(0);
  const img = await pdfDoc.embedPng(signaturePngBytes as BufferSource);
  firstPage.drawImage(img, {
    x: 20,
    y: 20,
    width: SIGNATURE_WIDTH_PT,
    height: SIGNATURE_HEIGHT_PT,
  });
  const embeddedBytes = await pdfDoc.save({ useObjectStreams: false });
  const embedMs = Date.now() - embedStart;

  const derivedHash = await hashPdfBytes(embeddedBytes);

  const originalBytesUnchanged =
    snapshot.length === originalBytes.length && snapshot.every((byte, index) => byte === originalBytes[index]);

  return {
    loadMs,
    hashMs,
    embedMs,
    originalHash,
    derivedHash,
    originalBytesUnchanged,
    originalByteLength: originalBytes.length,
    embeddedByteLength: embeddedBytes.length,
  };
}

// A minimal, valid, tiny (68-byte) 1x1 transparent PNG — well-known W3C/PNG
// test fixture bytes, embedded here so the spike never needs to bundle a
// binary image asset just to have "a signature PNG" to embed. This is NOT
// a real signature capture; it stands in for one exactly the way
// renderDirectSignPdf.ts's `signature.pngBytes` slot is filled in production
// (a captured signature PNG of a similar/larger size) — swap in a real
// captured PNG on-device if a closer size approximation is wanted.
export const SPIKE_SIGNATURE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

/**
 * Decodes a base64 string into raw bytes. Hermes (RN 0.85) ships `atob`
 * globally; the `Buffer` fallback matches the exact idiom
 * FlowRunnerScreen.tsx's decodeJwtIatClaim already uses for the same
 * cross-environment (Hermes vs. vitest/Node) concern.
 */
export function base64ToBytes(base64: string): Uint8Array {
  const binaryString =
    typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
