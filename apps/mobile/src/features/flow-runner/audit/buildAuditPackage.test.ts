import { describe, expect, it } from 'vitest';
import {
  buildAuditPackage,
  buildDirectSignAuditPackage,
  computePackageHash,
  type BuildAuditPackageInputs,
  type BuildDirectSignAuditPackageInputs,
} from './buildAuditPackage';
import { canonicalize } from './canonicalize';

/**
 * SIGN-03: buildAuditPackage is a PURE offline assembler — every field
 * comes from injected inputs, no expo-crypto/location/device import inside
 * the module (Pitfall 1/4). Stroke shape frozen by 04-STROKE-SPIKE.md
 * (getData()/onGetData JSON, no pressure field).
 */

function makeInputs(overrides: Partial<BuildAuditPackageInputs> = {}): BuildAuditPackageInputs {
  return {
    documentHashSha256: 'abc123hash',
    signedAtIso: '2026-07-23T10:00:00.000Z',
    serverTimeAnchor: { iat: 1784809800, source: 'supabase-jwt' },
    deviceId: 'device-uuid-1234',
    deviceIdSource: 'idfv',
    gps: { lat: 52.52, lng: 13.405, accuracyM: 5 },
    confirmedGates: [
      { blockId: 'widerrufsbelehrung', confirmedAtIso: '2026-07-23T09:59:00.000Z', noticeTextSha256: 'notice-hash-1' },
    ],
    signatureStrokeData: [
      {
        color: 'black',
        dotSize: 1.5,
        minWidth: 0.5,
        maxWidth: 2.5,
        compositeOperation: 'source-over',
        points: [
          { time: 1784809875835, x: 123.4, y: 56.7 },
          { time: 1784809875851, x: 124.1, y: 57.2 },
        ],
      },
    ],
    productVersion: 3,
    dealReference: 'deal-ref-abc',
    ...overrides,
  };
}

describe('buildAuditPackage', () => {
  it('returns the exact AuditPackage shape populated from inputs', () => {
    const inputs = makeInputs();
    const pkg = buildAuditPackage(inputs);
    expect(pkg).toEqual({
      documentHashSha256: inputs.documentHashSha256,
      signedAtIso: inputs.signedAtIso,
      serverTimeAnchor: inputs.serverTimeAnchor,
      deviceId: inputs.deviceId,
      deviceIdSource: inputs.deviceIdSource,
      gps: inputs.gps,
      confirmedGates: inputs.confirmedGates,
      signatureStrokeData: inputs.signatureStrokeData,
      productVersion: inputs.productVersion,
      dealReference: inputs.dealReference,
    });
  });

  it('passes gps:null through unchanged without throwing', () => {
    const inputs = makeInputs({ gps: null });
    expect(() => buildAuditPackage(inputs)).not.toThrow();
    const pkg = buildAuditPackage(inputs);
    expect(pkg.gps).toBeNull();
  });

  it('serverTimeAnchor carries only iat + source, never a raw JWT-looking string', () => {
    const inputs = makeInputs({
      serverTimeAnchor: { iat: 1784809800, source: 'supabase-jwt' },
    });
    const pkg = buildAuditPackage(inputs);
    const serialized = JSON.stringify(pkg);
    // A raw JWT is three base64url segments joined by dots, each segment
    // long enough to carry header/payload/signature — assert none present.
    expect(serialized).not.toMatch(/[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
    expect(Object.keys(pkg.serverTimeAnchor ?? {}).sort()).toEqual(['iat', 'source']);
  });

  it('serverTimeAnchor can be null (no server time available)', () => {
    const inputs = makeInputs({ serverTimeAnchor: null });
    const pkg = buildAuditPackage(inputs);
    expect(pkg.serverTimeAnchor).toBeNull();
  });

  it('confirmedGates entries carry blockId + confirmedAtIso + noticeTextSha256 (D-17)', () => {
    const inputs = makeInputs({
      confirmedGates: [
        { blockId: 'block-a', confirmedAtIso: '2026-07-23T09:00:00.000Z', noticeTextSha256: 'hash-a' },
        { blockId: 'block-b', confirmedAtIso: '2026-07-23T09:01:00.000Z', noticeTextSha256: 'hash-b' },
      ],
    });
    const pkg = buildAuditPackage(inputs);
    expect(pkg.confirmedGates).toHaveLength(2);
    for (const gate of pkg.confirmedGates) {
      expect(Object.keys(gate).sort()).toEqual(['blockId', 'confirmedAtIso', 'noticeTextSha256']);
    }
  });

  it('signatureStrokeData is stored verbatim (per 04-STROKE-SPIKE.md shape, no pressure field)', () => {
    const inputs = makeInputs();
    const pkg = buildAuditPackage(inputs);
    expect(pkg.signatureStrokeData).toEqual(inputs.signatureStrokeData);
    const serialized = JSON.stringify(pkg.signatureStrokeData);
    expect(serialized).not.toMatch(/pressure/);
  });

  it('canonicalizing the built package twice is byte-identical (reproducible hash input)', () => {
    const pkg = buildAuditPackage(makeInputs());
    expect(canonicalize(pkg)).toBe(canonicalize(pkg));
  });
});

describe('computePackageHash', () => {
  it('hashes canonicalize(pkg) via the injected digestFn', async () => {
    const pkg = buildAuditPackage(makeInputs());
    const seen: string[] = [];
    const digestFn = async (input: string) => {
      seen.push(input);
      return `sha256:${input.length}`;
    };
    const hash = await computePackageHash(pkg, digestFn);
    expect(seen).toEqual([canonicalize(pkg)]);
    expect(hash).toBe(`sha256:${canonicalize(pkg).length}`);
  });

  it('is reproducible across repeated calls for the same package', async () => {
    const pkg = buildAuditPackage(makeInputs());
    const digestFn = async (input: string) => `d:${input}`;
    const first = await computePackageHash(pkg, digestFn);
    const second = await computePackageHash(pkg, digestFn);
    expect(first).toBe(second);
  });
});

/**
 * DSGN-01/D-04 two-hash model: documentHashSha256 (inherited, the original
 * cached PDF's bytes), signatureArtifactHashSha256 (the separate signature
 * PNG) and originalTemplateSha256 (the template row's own sha256) must be
 * three INDEPENDENTLY-set fields — never derived from each other, never one
 * post-render hash standing in for the others (T-10-13).
 */
function makeDirectSignInputs(
  overrides: Partial<BuildDirectSignAuditPackageInputs> = {},
): BuildDirectSignAuditPackageInputs {
  return {
    documentHashSha256: 'original-cached-pdf-hash',
    signedAtIso: '2026-08-04T10:00:00.000Z',
    serverTimeAnchor: { iat: 1784900000, source: 'supabase-jwt' },
    deviceId: 'device-uuid-9999',
    deviceIdSource: 'idfv',
    gps: null,
    confirmedGates: [
      { blockId: 'belehrung', confirmedAtIso: '2026-08-04T09:59:00.000Z', noticeTextSha256: 'notice-hash-2' },
    ],
    signatureStrokeData: [{ points: [{ time: 1, x: 1, y: 1 }] }],
    productVersion: 1,
    dealReference: 'deal-ref-direct-sign',
    signatureArtifactHashSha256: 'signature-artifact-hash',
    originalTemplateSha256: 'template-row-hash',
    ...overrides,
  };
}

describe('buildDirectSignAuditPackage', () => {
  it('returns every AuditPackage field PLUS the two direct-sign hash fields', () => {
    const inputs = makeDirectSignInputs();
    const pkg = buildDirectSignAuditPackage(inputs);
    expect(pkg).toEqual({
      documentHashSha256: inputs.documentHashSha256,
      signedAtIso: inputs.signedAtIso,
      serverTimeAnchor: inputs.serverTimeAnchor,
      deviceId: inputs.deviceId,
      deviceIdSource: inputs.deviceIdSource,
      gps: inputs.gps,
      confirmedGates: inputs.confirmedGates,
      signatureStrokeData: inputs.signatureStrokeData,
      productVersion: inputs.productVersion,
      dealReference: inputs.dealReference,
      signatureArtifactHashSha256: inputs.signatureArtifactHashSha256,
      originalTemplateSha256: inputs.originalTemplateSha256,
    });
  });

  it('keeps documentHashSha256, signatureArtifactHashSha256 and originalTemplateSha256 as three independently-set fields, never derived from one another', () => {
    const inputs = makeDirectSignInputs({
      documentHashSha256: 'hash-A-original-cached-bytes',
      signatureArtifactHashSha256: 'hash-B-signature-png',
      originalTemplateSha256: 'hash-C-template-row',
    });
    const pkg = buildDirectSignAuditPackage(inputs);

    // All three distinct, all three preserved verbatim — none re-derived
    // from another (e.g. no hash-of-a-hash, no shared prefix logic).
    expect(pkg.documentHashSha256).toBe('hash-A-original-cached-bytes');
    expect(pkg.signatureArtifactHashSha256).toBe('hash-B-signature-png');
    expect(pkg.originalTemplateSha256).toBe('hash-C-template-row');
    const values = [pkg.documentHashSha256, pkg.signatureArtifactHashSha256, pkg.originalTemplateSha256];
    expect(new Set(values).size).toBe(3);
  });

  it('is a pure mapping (no I/O) — same inputs canonicalize byte-identically every call', () => {
    const inputs = makeDirectSignInputs();
    const first = buildDirectSignAuditPackage(inputs);
    const second = buildDirectSignAuditPackage(inputs);
    expect(canonicalize(first)).toBe(canonicalize(second));
  });
});
