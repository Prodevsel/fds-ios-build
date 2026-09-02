import { beforeEach, describe, expect, it, vi } from 'vitest';

const digestMock = vi.fn();

vi.mock('expo-crypto', () => ({
  digest: (...args: unknown[]) => digestMock(...args),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

import * as Crypto from 'expo-crypto';
import { hashPdfBytes } from './hashPdfBytes';

/**
 * hashPdfBytes wraps expo-crypto's raw-bytes `digest()` — the same module
 * the rest of the audit pipeline uses (D-26 single hashing path), just the
 * bytes-taking entry point instead of the string-taking
 * `digestStringAsync` (D-04: a PDF's bytes must never be coerced to a JS
 * string before hashing).
 */
describe('hashPdfBytes', () => {
  beforeEach(() => {
    digestMock.mockReset();
    // Fixed 32-byte digest so hex-encoding is trivially assertable.
    digestMock.mockImplementation(async () => new Uint8Array([0, 1, 2, 254, 255]).buffer);
  });

  it('returns a lowercase-hex SHA-256 digest of the raw bytes', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // '%PDF'
    const hash = await hashPdfBytes(bytes);
    expect(hash).toBe('0001' + '02' + 'fe' + 'ff');
  });

  it('calls expo-crypto Crypto.digest with SHA256 and the exact bytes (no re-encoding)', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await hashPdfBytes(bytes);
    expect(digestMock).toHaveBeenCalledExactlyOnceWith(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  });

  it('is deterministic — identical bytes yield the identical hash', async () => {
    const bytes = new Uint8Array([9, 9, 9]);
    const first = await hashPdfBytes(bytes);
    const second = await hashPdfBytes(bytes);
    expect(first).toBe(second);
  });

  it('produces a different hash string for a different digest output', async () => {
    digestMock.mockImplementationOnce(async () => new Uint8Array([0xaa, 0xbb]).buffer);
    const first = await hashPdfBytes(new Uint8Array([1]));
    digestMock.mockImplementationOnce(async () => new Uint8Array([0xcc, 0xdd]).buffer);
    const second = await hashPdfBytes(new Uint8Array([2]));
    expect(first).not.toBe(second);
  });
});
