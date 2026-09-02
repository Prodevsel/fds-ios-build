import { describe, expect, it, vi } from 'vitest';

const digestMock = vi.fn();
digestMock.mockImplementation(async () => new Uint8Array([0xde, 0xad, 0xbe, 0xef]).buffer);
vi.mock('expo-crypto', () => ({
  digest: (...args: unknown[]) => digestMock(...args),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

import {
  type DirectSignPdfCache,
  type DirectSignTemplateForPrefetch,
  prefetchDirectSignPdf,
} from './prefetchDirectSignPdf';

/**
 * T-10-11/T-10-12: injected fakes only — no real device I/O. Asserts
 * success (download → verify → cache), hash-mismatch-throws (corrupt/
 * tampered download never cached), and idempotency (a second prefetch for
 * an already-cached template never re-downloads/re-verifies).
 */

const TEMPLATE: DirectSignTemplateForPrefetch = {
  id: 'template-1',
  storagePath: 'company-x/contract-v3.pdf',
  sha256: 'expected-hash-abc',
};

function makeCache(initial: Record<string, Uint8Array> = {}): DirectSignPdfCache & {
  store: Record<string, Uint8Array>;
} {
  const store = { ...initial };
  return {
    store,
    async read(templateId) {
      return store[templateId] ?? null;
    },
    async write(templateId, bytes) {
      store[templateId] = bytes;
    },
  };
}

describe('prefetchDirectSignPdf', () => {
  it('downloads, verifies against template.sha256, caches, and returns the bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const downloadOriginal = vi.fn(async () => bytes);
    const hashBytes = vi.fn(async () => 'expected-hash-abc');
    const cache = makeCache();

    const result = await prefetchDirectSignPdf(TEMPLATE, { downloadOriginal, cache, hashBytes });

    expect(result).toBe(bytes);
    expect(downloadOriginal).toHaveBeenCalledExactlyOnceWith(TEMPLATE.storagePath);
    expect(hashBytes).toHaveBeenCalledExactlyOnceWith(bytes);
    expect(cache.store[TEMPLATE.id]).toBe(bytes);
  });

  it('throws on a hash mismatch and never caches the corrupt/tampered bytes', async () => {
    const bytes = new Uint8Array([9, 9, 9]);
    const downloadOriginal = vi.fn(async () => bytes);
    const hashBytes = vi.fn(async () => 'wrong-hash');
    const cache = makeCache();

    await expect(
      prefetchDirectSignPdf(TEMPLATE, { downloadOriginal, cache, hashBytes }),
    ).rejects.toThrow(/do not match the expected sha256/);
    expect(cache.store[TEMPLATE.id]).toBeUndefined();
  });

  it('is idempotent — a second prefetch of an already-cached template never re-downloads or re-verifies', async () => {
    const cachedBytes = new Uint8Array([7, 7, 7]);
    const downloadOriginal = vi.fn(async () => {
      throw new Error('must not be called for an already-cached template');
    });
    const hashBytes = vi.fn(async () => {
      throw new Error('must not be called for an already-cached template');
    });
    const cache = makeCache({ [TEMPLATE.id]: cachedBytes });

    const result = await prefetchDirectSignPdf(TEMPLATE, { downloadOriginal, cache, hashBytes });

    expect(result).toBe(cachedBytes);
    expect(downloadOriginal).not.toHaveBeenCalled();
    expect(hashBytes).not.toHaveBeenCalled();
  });

  it('defaults hashBytes to the real hashPdfBytes when omitted (no separate hashing utility)', async () => {
    // Regression guard for the "no new hashing utility" acceptance
    // criterion: omitting hashBytes must still work end-to-end via the
    // real expo-crypto-backed hashPdfBytes (mocked at expo-crypto's own
    // boundary above), not silently no-op/throw.
    const bytes = new Uint8Array([1, 2, 3]);
    const downloadOriginal = vi.fn(async () => bytes);
    const cache = makeCache();

    const result = await prefetchDirectSignPdf(
      { id: 'template-2', storagePath: 'x.pdf', sha256: 'deadbeef' },
      { downloadOriginal, cache },
    );

    expect(result).toBe(bytes);
    expect(cache.store['template-2']).toBe(bytes);
    expect(digestMock).toHaveBeenCalled();
  });
});
