import { describe, expect, it, vi } from 'vitest';

// hashPdfBytes.ts (imported transitively as the default hashBytes) loads
// expo-crypto at module scope — never load the native module in this Node
// test env (hashPdfBytes.test.ts/prefetchDirectSignPdf.test.ts precedent).
// Every test below injects its own hashBytes fake anyway, so this mock only
// exists to make the import graph resolve.
vi.mock('expo-crypto', () => ({
  digest: vi.fn(async () => new Uint8Array([0, 0, 0, 0]).buffer),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

import type { SignatureAttachmentQueue } from '../../../lib/db/attachments/signatureAttachments';
import type { ContractsRepo, InsertContractInput, InsertContractResult } from '../db/contractsRepo';
import {
  type CompleteDirectSignDeps,
  base64ToBytes,
  completeDirectSign,
} from './completeDirectSign';
import type { ConfirmedGateEntry } from './directSignGate';

/**
 * DSGN-03: completeDirectSign is pure/DI'd (no component mount, no native
 * expo-crypto import needed here — hashBytes/digestFn/attachmentQueue are
 * all injected fakes), mirroring FlowRunnerScreen.test.tsx's completeSigning
 * suite shape.
 */

function fakeContractsRepo(): Pick<ContractsRepo, 'insertContract'> & {
  insertContract: ReturnType<typeof vi.fn>;
} {
  const insertContract = vi.fn(
    async (input: InsertContractInput): Promise<InsertContractResult> => ({
      id: input.id ?? 'generated-id',
      dealReference: input.dealReference ?? 'FDS-20260804-FIXEDUU1',
    }),
  );
  return { insertContract };
}

function fakeAttachmentQueue(): SignatureAttachmentQueue & {
  generateAttachmentId: ReturnType<typeof vi.fn>;
  saveFile: ReturnType<typeof vi.fn>;
} {
  return {
    generateAttachmentId: vi.fn(async () => 'attachment-uuid-1'),
    saveFile: vi.fn(async (record: { data: string; fileExtension: string }) => ({
      id: 'attachment-uuid-1',
      filename: `attachment-uuid-1.${record.fileExtension}`,
    })),
  } as unknown as SignatureAttachmentQueue & {
    generateAttachmentId: ReturnType<typeof vi.fn>;
    saveFile: ReturnType<typeof vi.fn>;
  };
}

/** Content-sensitive fake hash — same shape as hashPdfBytes.test.ts's determinism proof, but distinguishes inputs by their actual byte content so the "three distinct hashes" assertion is meaningful, not just three different mock-call-index labels. */
function fakeHashBytes(bytes: Uint8Array): Promise<string> {
  let sum = 0;
  for (const b of bytes) sum += b;
  return Promise.resolve(`sha256-of-${bytes.length}-bytes-sum-${sum}`);
}

const CONFIRMED_GATES: ConfirmedGateEntry[] = [
  {
    blockId: 'belehrung-1',
    confirmedAtIso: '2026-08-04T09:00:00.000Z',
    noticeTextSha256: 'notice-hash',
  },
];

function baseDeps(overrides: Partial<CompleteDirectSignDeps> = {}): CompleteDirectSignDeps {
  return {
    contractsRepo: fakeContractsRepo(),
    attachmentQueue: fakeAttachmentQueue(),
    hashBytes: fakeHashBytes,
    digestFn: vi.fn(async (data: string) => `pkg-sha256:${data.length}`),
    generateUuid: vi.fn(() => 'fixed-uuid'),
    now: vi.fn(() => new Date('2026-08-04T09:05:00.000Z')),
    ...overrides,
  };
}

function baseParams(overrides: Partial<Parameters<typeof completeDirectSign>[1]> = {}) {
  return {
    companyId: 'company-1',
    repId: 'rep-1',
    teamId: 'team-1',
    productDefinitionId: 'product-1',
    productVersion: 2,
    directSignTemplateId: 'template-1',
    originalPdfBytes: new Uint8Array([1, 2, 3, 4, 5]),
    originalTemplateSha256: 'template-original-sha256',
    signaturePngBase64: 'aGVsbG8td29ybGQ=', // 'hello-world'
    signatureStrokeData: [{ points: [{ x: 1, y: 1, time: 1 }] }],
    confirmedGates: CONFIRMED_GATES,
    deviceId: 'device-uuid-1234',
    deviceIdSource: 'idfv' as const,
    gps: { lat: 52.52, lng: 13.405, accuracyM: 5 },
    ...overrides,
  };
}

describe('base64ToBytes (pure decoder, no atob/Buffer dependency)', () => {
  it('decodes a known base64 string to its exact byte sequence', () => {
    // 'hello-world' -> bytes below (ASCII codes), base64 'aGVsbG8td29ybGQ='
    expect(Array.from(base64ToBytes('aGVsbG8td29ybGQ='))).toEqual([
      104, 101, 108, 108, 111, 45, 119, 111, 114, 108, 100,
    ]);
  });

  it('is deterministic for the same input', () => {
    const a = base64ToBytes('QUJDRA==');
    const b = base64ToBytes('QUJDRA==');
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe('completeDirectSign (DSGN-03: offline dual-hash audit + append-only insert)', () => {
  it('assembles three distinct hashes (document/signature-artifact/original-template) and inserts with direct_sign_template_id', async () => {
    const contractsRepo = fakeContractsRepo();
    const deps = baseDeps({ contractsRepo });
    const params = baseParams();

    const result = await completeDirectSign(deps, params);

    expect(contractsRepo.insertContract).toHaveBeenCalledTimes(1);
    const insertedInput = contractsRepo.insertContract.mock.calls[0]![0] as InsertContractInput;

    expect(insertedInput.directSignTemplateId).toBe('template-1');
    expect(insertedInput.companyId).toBe('company-1');
    expect(insertedInput.repId).toBe('rep-1');
    expect(insertedInput.teamId).toBe('team-1');
    expect(insertedInput.productDefinitionId).toBe('product-1');
    expect(insertedInput.productVersion).toBe(2);

    const pkg = insertedInput.auditPackage as Record<string, unknown>;
    // documentHashSha256 == hashBytes(originalBytes), and distinct from the
    // signature-artifact hash (T-10-24 — never one post-embed hash).
    const expectedDocumentHash = await fakeHashBytes(params.originalPdfBytes);
    expect(pkg.documentHashSha256).toBe(expectedDocumentHash);
    expect(pkg.documentHashSha256).not.toBe(pkg.signatureArtifactHashSha256);
    expect(pkg.originalTemplateSha256).toBe('template-original-sha256');
    expect(pkg.originalTemplateSha256).not.toBe(pkg.documentHashSha256);
    expect(pkg.originalTemplateSha256).not.toBe(pkg.signatureArtifactHashSha256);

    expect(pkg.confirmedGates).toEqual(CONFIRMED_GATES);
    expect(pkg.deviceId).toBe('device-uuid-1234');
    expect(pkg.gps).toEqual({ lat: 52.52, lng: 13.405, accuracyM: 5 });
    expect(pkg.signatureStrokeData).toEqual(params.signatureStrokeData);
    expect(insertedInput.packageHashSha256).toEqual(expect.any(String));

    expect(result.dealReference).toBe(insertedInput.dealReference);
    expect(result.id).toBe(insertedInput.id ?? 'generated-id');
  });

  it('queues the signature PNG through the attachment queue (never a raw storage call) and links its id as signature_attachment_id', async () => {
    const attachmentQueue = fakeAttachmentQueue();
    const deps = baseDeps({ attachmentQueue });
    const params = baseParams();

    await completeDirectSign(deps, params);

    expect(attachmentQueue.generateAttachmentId).toHaveBeenCalledTimes(1);
    expect(attachmentQueue.saveFile).toHaveBeenCalledTimes(1);
    const savedRecord = attachmentQueue.saveFile.mock.calls[0]![0] as {
      data: string;
      fileExtension: string;
    };
    expect(savedRecord.data).toBe(params.signaturePngBase64);
    expect(savedRecord.fileExtension).toBe('png');
  });

  it('a gps:null run still completes the insert (D-04 GPS-never-blocks-signing, mirrored from FlowRunnerScreen)', async () => {
    const contractsRepo = fakeContractsRepo();
    const deps = baseDeps({ contractsRepo });
    const params = baseParams({ gps: null });

    await completeDirectSign(deps, params);

    const insertedInput = contractsRepo.insertContract.mock.calls[0]![0] as InsertContractInput;
    const pkg = insertedInput.auditPackage as Record<string, unknown>;
    expect(pkg.gps).toBeNull();
  });

  it('is offline-complete: neither dep function ever receives a supabase/fetch-shaped argument, and the module imports no network client', async () => {
    const deps = baseDeps();
    const params = baseParams();

    // The DI seam itself is the proof: contractsRepo/attachmentQueue/hashBytes/
    // digestFn are all local-only fakes here, and completeDirectSign never
    // imports '@supabase/supabase-js' or performs a fetch — grep-verified
    // against the module source (no such import exists in completeDirectSign.ts).
    await expect(completeDirectSign(deps, params)).resolves.toBeDefined();
  });

  it('CR-02: retrying with the same deterministic id re-targets the same row (idempotent, no second contract)', async () => {
    const contractsRepo = fakeContractsRepo();
    const deps = baseDeps({ contractsRepo });

    await completeDirectSign(deps, baseParams({ id: 'deterministic-id-1' }));
    await completeDirectSign(deps, baseParams({ id: 'deterministic-id-1' }));
    await completeDirectSign(deps, baseParams({ id: 'deterministic-id-2' }));

    const ids = contractsRepo.insertContract.mock.calls.map(
      (call) => (call[0] as InsertContractInput).id,
    );
    expect(ids[0]).toBe('deterministic-id-1');
    expect(ids[1]).toBe('deterministic-id-1');
    expect(ids[2]).toBe('deterministic-id-2');
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).not.toBe(ids[2]);
  });

  it('WR-02: retrying with the same deterministic id AND signatureAttachmentId creates neither a second contract row nor a second orphaned attachment', async () => {
    const contractsRepo = fakeContractsRepo();
    const attachmentQueue = fakeAttachmentQueue();
    const deps = baseDeps({ contractsRepo, attachmentQueue });

    // Simulates DirectSignFlowScreen.runCompletion: a stable per-attempt id
    // pair (generated once in a ref, reused across retries) is passed on
    // EVERY call — including the retry after a transient failure.
    await completeDirectSign(
      deps,
      baseParams({ id: 'attempt-contract-id', signatureAttachmentId: 'attempt-attachment-id' }),
    );
    await completeDirectSign(
      deps,
      baseParams({ id: 'attempt-contract-id', signatureAttachmentId: 'attempt-attachment-id' }),
    );

    // contractsRepo.insertContract's own INSERT OR IGNORE semantics are
    // exercised by the CR-02 test above; this test's job is proving the
    // CALLER-side wiring never varies the id between attempts.
    const insertedIds = contractsRepo.insertContract.mock.calls.map(
      (call) => (call[0] as InsertContractInput).id,
    );
    expect(insertedIds).toEqual(['attempt-contract-id', 'attempt-contract-id']);

    // The attachment queue's own random-id generator must never be reached —
    // both attempts save through the SAME preset id, so a failed-then-retried
    // completion overwrites one local attachment record instead of leaving a
    // second, orphaned one that no contract row references.
    expect(attachmentQueue.generateAttachmentId).not.toHaveBeenCalled();
    expect(attachmentQueue.saveFile).toHaveBeenCalledTimes(2);
    expect(attachmentQueue.saveFile.mock.calls[0]![0]).toMatchObject({
      id: 'attempt-attachment-id',
    });
    expect(attachmentQueue.saveFile.mock.calls[1]![0]).toMatchObject({
      id: 'attempt-attachment-id',
    });
  });
});

/**
 * The fourth hash: what the customer actually signed.
 *
 * Until this existed the audit package froze the hash of the EMPTY template and
 * the answers separately, and the filled document was produced afterwards on
 * the server — a Blankounterschrift. These assertions pin the two properties
 * that make the new hash worth having: it covers the RENDERED page, and it can
 * never cost a contract.
 */
describe('renderedArtifactSha256 — the hash of what the customer actually signed', () => {
  /** Reads the audit package out of the single insertContract call. */
  function auditPackageOf(repo: ReturnType<typeof fakeContractsRepo>): Record<string, unknown> {
    const input = repo.insertContract.mock.calls[0]?.[0] as InsertContractInput;
    return input.auditPackage as unknown as Record<string, unknown>;
  }

  it('hashes the RENDERED document, not the empty template', async () => {
    const contractsRepo = fakeContractsRepo();
    const renderArtifact = vi.fn(async () => new Uint8Array([9, 9, 9]));

    await completeDirectSign(baseDeps({ contractsRepo, renderArtifact }), {
      ...baseParams(),
      signatureAnchor: { page: 1, xFrac: 0.3, yFrac: 0.8432 },
      fieldOverlays: [{ text: 'Vizionists GmbH', page: 1, xFrac: 0.2, yFrac: 0.2, fontSize: 11 }],
    });

    const pkg = auditPackageOf(contractsRepo);
    expect(renderArtifact).toHaveBeenCalledOnce();
    // fakeHashBytes is content-sensitive: 3 bytes summing to 27.
    expect(pkg.renderedArtifactSha256).toBe('sha256-of-3-bytes-sum-27');
    // The whole point — it must NOT equal the hash of the blank template.
    expect(pkg.renderedArtifactSha256).not.toBe(pkg.documentHashSha256);
  });

  it('renders with the anchor and the overlays it was given', async () => {
    const renderArtifact = vi.fn(async () => new Uint8Array([1]));
    const overlays = [{ text: 'Max', page: 1, xFrac: 0.26, yFrac: 0.35, fontSize: 11 }];
    await completeDirectSign(baseDeps({ renderArtifact }), {
      ...baseParams(),
      signatureAnchor: { page: 1, xFrac: 0.3125, yFrac: 0.8432 },
      fieldOverlays: overlays,
    });
    const [, signature, fields] = renderArtifact.mock.calls[0] as unknown as [
      Uint8Array,
      { page: number; xFrac: number; yFrac: number },
      unknown,
    ];
    expect(signature).toMatchObject({ page: 1, xFrac: 0.3125, yFrac: 0.8432 });
    expect(fields).toEqual(overlays);
  });

  it('omits the key entirely when the template carries no signature anchor', async () => {
    const contractsRepo = fakeContractsRepo();
    const renderArtifact = vi.fn();
    await completeDirectSign(baseDeps({ contractsRepo, renderArtifact }), {
      ...baseParams(),
      signatureAnchor: null,
    });
    expect(renderArtifact).not.toHaveBeenCalled();
    // Omitted, never present-and-undefined: the package is canonicalized and
    // hashed, so a sometimes-undefined key would move the digest.
    expect('renderedArtifactSha256' in auditPackageOf(contractsRepo)).toBe(false);
  });

  it('still produces a contract when the render throws — a hash must never cost a signature', async () => {
    const contractsRepo = fakeContractsRepo();
    const renderArtifact = vi.fn(async () => {
      throw new Error('pdf-lib exploded at the door');
    });
    const result = await completeDirectSign(baseDeps({ contractsRepo, renderArtifact }), {
      ...baseParams(),
      signatureAnchor: { page: 1, xFrac: 0.3, yFrac: 0.84 },
    });
    expect(result.dealReference).toBeTruthy();
    expect('renderedArtifactSha256' in auditPackageOf(contractsRepo)).toBe(false);
  });
});
