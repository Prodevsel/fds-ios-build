import { describe, expect, it, vi } from 'vitest';

// contractPdfAccess imports the shared raw-bytes hasher, which pulls in
// expo-crypto — a native module that is never loaded in this Node test
// environment (vitest.config.ts). Only pure functions are exercised here, so
// the hasher is stubbed at the module boundary rather than reimplemented.
vi.mock('../flow-runner/direct-sign/hashPdfBytes', () => ({
  hashPdfBytes: vi.fn(async () => 'stub'),
}));

import { contractPdfFileName, deriveContractPdfState } from './contractPdfAccess';

const READY = {
  artifact_status: 'ready',
  pdf_path: '10000000-0000-0000-0000-000000000001/50000000-0000-0000-0000-000000000001/a.pdf',
  pdf_sha256: 'c'.repeat(64),
  rendered_at: '2026-08-27T10:00:00Z',
};

describe('deriveContractPdfState', () => {
  it('maps zero rows to "unavailable" — not visible and not existing are the same answer', () => {
    expect(deriveContractPdfState({ rows: [] })).toBe('unavailable');
  });

  it('maps artifact_status "pending" to "pending"', () => {
    expect(
      deriveContractPdfState({
        rows: [{ artifact_status: 'pending', pdf_path: null, pdf_sha256: null, rendered_at: null }],
      }),
    ).toBe('pending');
  });

  it('maps artifact_status "failed" to "failed"', () => {
    expect(
      deriveContractPdfState({
        rows: [{ artifact_status: 'failed', pdf_path: null, pdf_sha256: null, rendered_at: null }],
      }),
    ).toBe('failed');
  });

  it('maps artifact_status "ready" with a path to "ready"', () => {
    expect(deriveContractPdfState({ rows: [READY] })).toBe('ready');
  });

  it('maps "ready" with a NULL pdf_path to "failed" — a null path never reaches the downloader', () => {
    expect(deriveContractPdfState({ rows: [{ ...READY, pdf_path: null }] })).toBe('failed');
  });

  it('maps a transport error to "offline", distinctly from "failed"', () => {
    const state = deriveContractPdfState({
      rows: null,
      error: new Error('Network request failed'),
    });
    expect(state).toBe('offline');
    expect(state).not.toBe('failed');
  });
});

describe('contractPdfFileName', () => {
  it('embeds a truncated sha and strips every character outside [A-Za-z0-9-] from the contract id', () => {
    const name = contractPdfFileName('../../etc/pass wd', 'a'.repeat(64));
    expect(name.endsWith('.pdf')).toBe(true);
    // The stem — everything the caller influences — carries no separator and
    // no dot, so `..` and `/` cannot walk out of the cache directory.
    const stem = name.replace(/\.pdf$/, '');
    expect(stem).not.toContain('/');
    expect(stem).not.toContain('.');
    expect(stem).toMatch(/^[A-Za-z0-9-]*$/);
    expect(name).toContain('aaaaaaaa');
  });

  it('returns a DIFFERENT name for the same contract id with a different sha (D-19 regeneration)', () => {
    const contractId = '50000000-0000-0000-0000-000000000001';
    expect(contractPdfFileName(contractId, 'a'.repeat(64))).not.toBe(
      contractPdfFileName(contractId, 'b'.repeat(64)),
    );
  });
});
