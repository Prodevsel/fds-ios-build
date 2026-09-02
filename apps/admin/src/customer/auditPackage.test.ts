import { describe, expect, it } from 'vitest';
import {
  buildBrowserAuditPackage,
  buildConfirmedGateEntry,
  canonicalizeForHash,
  computeDocumentHash,
  computePackageHash,
  sha256Hex,
} from './auditPackage';

/**
 * The evidence rules for a contract signed in a customer's browser.
 *
 * The parity block at the bottom is the thing to read first: it measures this
 * canonicalizer against the SAME example values
 * apps/mobile/src/features/flow-runner/audit/canonicalize.test.ts measures the
 * app's against. That is what holds two implementations of one rule together
 * until the shared package exists — a weaker guarantee than one implementation,
 * kept honest by being written down instead of assumed.
 */

describe('canonicalizeForHash — parity with the mobile serializer', () => {
  it('is key-order independent for flat objects', () => {
    expect(canonicalizeForHash({ b: 1, a: 2 })).toBe(canonicalizeForHash({ a: 2, b: 1 }));
  });

  it('sorts nested object keys recursively', () => {
    const nested = canonicalizeForHash({ z: { b: 1, a: 2 }, a: 1 });
    expect(nested).toBe(canonicalizeForHash({ a: 1, z: { a: 2, b: 1 } }));
    expect(nested).toBe('{"a":1,"z":{"a":2,"b":1}}');
  });

  it('preserves array order', () => {
    expect(canonicalizeForHash({ list: [3, 1, 2] })).toBe('{"list":[3,1,2]}');
  });

  it('sorts object keys nested inside arrays', () => {
    expect(canonicalizeForHash({ list: [{ b: 1, a: 2 }] })).toBe('{"list":[{"a":2,"b":1}]}');
  });

  it('produces no insignificant whitespace', () => {
    const out = canonicalizeForHash({ a: 1, b: [1, 2, 3], c: { d: 'x' } });
    expect(out).not.toMatch(/[\n\t]|(?<=[{,:[])\s|\s(?=[},:\]])/);
  });

  it('omits undefined-valued keys deterministically', () => {
    expect(canonicalizeForHash({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
  });

  it('preserves null values', () => {
    expect(canonicalizeForHash({ a: null, b: 1 })).toBe('{"a":null,"b":1}');
  });

  it('handles primitives directly', () => {
    expect(canonicalizeForHash('x')).toBe('"x"');
    expect(canonicalizeForHash(42)).toBe('42');
    expect(canonicalizeForHash(null)).toBe('null');
    expect(canonicalizeForHash(true)).toBe('true');
  });

  it('is byte-identical across repeated calls', () => {
    const value = { a: 1, nested: { z: 1, y: [1, { b: 2, a: 1 }] } };
    expect(canonicalizeForHash(value)).toBe(canonicalizeForHash(value));
  });
});

describe('buildConfirmedGateEntry', () => {
  it('hashes exactly the delivered noticeText and no other string', async () => {
    const noticeText = 'Sie haben das Recht, binnen 14 Tagen zu widerrufen.';
    const seen: string[] = [];
    const entry = await buildConfirmedGateEntry(
      { id: 'withdrawal-notice', noticeText },
      '2026-08-28T09:00:00.000Z',
      async (input) => {
        seen.push(input);
        return 'digest';
      },
    );
    // The whole point: not the label, not the block, not a rendered heading
    // glued onto the text. One digest call, over one string.
    expect(seen).toEqual([noticeText]);
    expect(entry).toEqual({
      blockId: 'withdrawal-notice',
      confirmedAtIso: '2026-08-28T09:00:00.000Z',
      noticeTextSha256: 'digest',
    });
  });

  it('produces a real SHA-256 through the default digest', async () => {
    const entry = await buildConfirmedGateEntry({ id: 'b', noticeText: 'abc' }, '2026-08-28T09:00:00.000Z');
    // The published SHA-256 of "abc" — a fixed external value, so this test
    // fails if the digest is ever quietly swapped for something else.
    expect(entry.noticeTextSha256).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('sha256Hex', () => {
  it('matches the published digest of the empty string', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('buildBrowserAuditPackage', () => {
  const inputs = {
    documentHashSha256: 'a'.repeat(64),
    signedAtIso: '2026-08-28T09:05:00.000Z',
    confirmedGates: [
      { blockId: 'withdrawal-notice', confirmedAtIso: '2026-08-28T09:04:00.000Z', noticeTextSha256: 'b'.repeat(64) },
    ],
    signatureStrokeData: [[{ x: 1, y: 2, t: 10 }, { x: 3, y: 4, t: 20 }]],
  };

  it('marks the channel and leaves every unknowable field null — no placeholders', () => {
    const pkg = buildBrowserAuditPackage(inputs);
    expect(pkg.channel).toBe('customer-browser');
    expect(pkg.deviceIdSource).toBe('browser');
    expect(pkg.deviceId).toBeNull();
    expect(pkg.serverTimeAnchor).toBeNull();
    expect(pkg.gps).toBeNull();
    // The server owns both of these; a browser-held guess beside the
    // authoritative value would be a second, weaker source.
    expect(pkg.productVersion).toBeNull();
    expect(pkg.dealReference).toBeNull();
  });

  it('never invents a value — no field is an empty string or a zero', () => {
    const pkg = buildBrowserAuditPackage(inputs) as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(pkg)) {
      expect(value, `${key} was filled with a placeholder`).not.toBe('');
      expect(value, `${key} was filled with a placeholder`).not.toBe('unknown');
    }
  });

  it('carries the strokes verbatim, with no synthesized pressure field', () => {
    const pkg = buildBrowserAuditPackage(inputs);
    expect(pkg.signatureStrokeData).toEqual(inputs.signatureStrokeData);
    expect(Object.keys(pkg.signatureStrokeData[0]![0]!).sort()).toEqual(['t', 'x', 'y']);
  });

  it('keeps the field names of the app package so both contracts read alike', () => {
    const pkg = buildBrowserAuditPackage(inputs);
    for (const field of [
      'documentHashSha256',
      'signedAtIso',
      'serverTimeAnchor',
      'deviceId',
      'deviceIdSource',
      'gps',
      'confirmedGates',
      'signatureStrokeData',
      'productVersion',
      'dealReference',
    ]) {
      expect(field in pkg).toBe(true);
    }
  });
});

describe('the two hashes', () => {
  it('hashes the document over what the customer actually saw, key order aside', async () => {
    const seen: string[] = [];
    const digest = async (input: string) => {
      seen.push(input);
      return 'd';
    };
    await computeDocumentHash({ doorPrice: 49.9, comparisonPrice: 59.9 }, { q1: 'ja' }, digest);
    await computeDocumentHash({ comparisonPrice: 59.9, doorPrice: 49.9 }, { q1: 'ja' }, digest);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).toContain('49.9');
  });

  it('routes the package hash through the same canonicalizer', async () => {
    const pkg = buildBrowserAuditPackage({
      documentHashSha256: 'a'.repeat(64),
      signedAtIso: '2026-08-28T09:05:00.000Z',
      confirmedGates: [],
      signatureStrokeData: [],
    });
    const seen: string[] = [];
    await computePackageHash(pkg, async (input) => {
      seen.push(input);
      return 'd';
    });
    expect(seen).toEqual([canonicalizeForHash(pkg)]);
  });

  it('is reproducible: the same package hashes to the same value twice', async () => {
    const pkg = buildBrowserAuditPackage({
      documentHashSha256: 'a'.repeat(64),
      signedAtIso: '2026-08-28T09:05:00.000Z',
      confirmedGates: [],
      signatureStrokeData: [],
    });
    expect(await computePackageHash(pkg)).toBe(await computePackageHash(pkg));
  });
});
