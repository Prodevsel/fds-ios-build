import { describe, expect, it } from 'vitest';
import { MAX_TEMPLATE_BYTES, sha256Hex, validateTemplateFile } from './useDirectSignTemplates';

/** A minimal File stub — jsdom's File constructor works fine for size/type checks. */
function mkFile(name: string, type: string, sizeBytes: number): File {
  const bytes = new Uint8Array(sizeBytes);
  return new File([bytes], name, { type });
}

describe('validateTemplateFile (T-10-16/V5 write-boundary validation)', () => {
  it('accepts a PDF within the size limit', () => {
    expect(validateTemplateFile(mkFile('vertrag.pdf', 'application/pdf', 1024))).toBeNull();
  });

  it('rejects a non-PDF mime type', () => {
    expect(validateTemplateFile(mkFile('vertrag.png', 'image/png', 1024))).toBe('invalidType');
  });

  it('rejects a file larger than MAX_TEMPLATE_BYTES', () => {
    expect(
      validateTemplateFile(mkFile('vertrag.pdf', 'application/pdf', MAX_TEMPLATE_BYTES + 1)),
    ).toBe('tooLarge');
  });

  it('accepts a file exactly at MAX_TEMPLATE_BYTES', () => {
    expect(validateTemplateFile(mkFile('vertrag.pdf', 'application/pdf', MAX_TEMPLATE_BYTES))).toBeNull();
  });
});

describe('sha256Hex (D-04 documentHashSha256 cross-check source)', () => {
  it('hashes the exact bytes deterministically (known test vector)', async () => {
    const bytes = new TextEncoder().encode('abc').buffer;
    const hex = await sha256Hex(bytes as ArrayBuffer);
    expect(hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('produces different hashes for different bytes', async () => {
    const a = await sha256Hex(new TextEncoder().encode('abc').buffer as ArrayBuffer);
    const b = await sha256Hex(new TextEncoder().encode('abd').buffer as ArrayBuffer);
    expect(a).not.toBe(b);
  });
});
