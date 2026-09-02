import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// contractsRepo.ts pulls expo-crypto at module scope for its id derivation —
// the pure functions under test never reach it (reviewRows.test.ts precedent).
vi.mock('expo-crypto', () => ({
  digestStringAsync: vi.fn(),
  randomUUID: vi.fn(() => 'ab12cd34-ef56-7890-abcd-ef1234567890'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

import {
  deriveContractSyncPending,
  extractPendingContractIds,
} from '../flow-runner/db/contractsRepo';

const CONTRACT = 'c0000000-0000-4000-8000-000000000001';
const OTHER = 'c0000000-0000-4000-8000-000000000002';

/**
 * The defect this pins: the success screen's transfer card was fed a hardcoded
 * `true`, so after every deal it told a demonstrably-online rep the contract
 * was "waiting for a network". The card is only honest if the answer comes
 * from the local upload queue, per contract.
 */
describe('deriveContractSyncPending (the success screen stops assuming)', () => {
  it('is pending while this contract is still in the local CRUD upload queue', () => {
    expect(deriveContractSyncPending(CONTRACT, [{ table: 'contracts', id: CONTRACT }])).toBe(true);
  });

  it('is NOT pending once the queue no longer holds it — the case the hardcode got wrong', () => {
    expect(deriveContractSyncPending(CONTRACT, [])).toBe(false);
  });

  it('answers per contract, not per queue: another deal still queued says nothing about this one', () => {
    expect(deriveContractSyncPending(CONTRACT, [{ table: 'contracts', id: OTHER }])).toBe(false);
  });

  it('ignores queued rows from other tables — a pending house edit is not an untransferred contract', () => {
    expect(deriveContractSyncPending(CONTRACT, [{ table: 'houses', id: CONTRACT }])).toBe(false);
  });
});

describe('extractPendingContractIds still behaves as it did in ContractListScreen', () => {
  it('keeps only contracts-table ids', () => {
    expect(
      extractPendingContractIds([
        { table: 'contracts', id: CONTRACT },
        { table: 'houses', id: 'h1' },
        { table: 'contracts', id: OTHER },
      ]),
    ).toEqual(new Set([CONTRACT, OTHER]));
  });
});

describe('neither success-screen call site hardcodes syncPending any more', () => {
  const read = (relative: string) =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8');

  it('FlowRunnerScreen derives it from the queue', () => {
    const source = read('../flow-runner/FlowRunnerScreen.tsx');
    expect(source).not.toMatch(/syncPending:\s*true/);
    expect(source).toMatch(/useContractSyncPending\(/);
    expect(source).toMatch(/syncPending=\{syncPending\}/);
  });

  it('DirectSignFlowScreen passes a derived value, not a bare prop', () => {
    const source = read('../flow-runner/direct-sign/DirectSignFlowScreen.tsx');
    expect(source).toMatch(/syncPending=\{syncPending\}/);
    expect(source).toMatch(/useContractSyncPending\(/);
  });

  it('the hook reads the upload queue, not the connection state — a connected client with a queued contract must still warn', () => {
    const hook = read('./useContractSyncPending.ts');
    // Strip comments first: the header ARGUES about dataFlowStatus/connected
    // (explaining why they are the wrong signal), and asserting on prose would
    // make the doc unwritable.
    const code = hook.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).toMatch(/getCrudBatch/);
    expect(code).not.toMatch(/dataFlowStatus/);
    expect(code).not.toMatch(/status\.connected/);
  });
});

describe('the IBAN screen no longer lectures about sync mechanics', () => {
  it('hints.ibanEncrypted is gone from the block and from both locale bundles', async () => {
    const block = readFileSync(
      fileURLToPath(new URL('../flow-runner/blocks/IbanScanBlock.tsx', import.meta.url)),
      'utf-8',
    );
    expect(block).not.toMatch(/t\('hints\.ibanEncrypted'\)/);
    const de = (await import('../../i18n/de.json')).default as Record<string, string>;
    const en = (await import('../../i18n/en.json')).default as Record<string, string>;
    expect(de).not.toHaveProperty('hints.ibanEncrypted');
    expect(en).not.toHaveProperty('hints.ibanEncrypted');
  });
});
