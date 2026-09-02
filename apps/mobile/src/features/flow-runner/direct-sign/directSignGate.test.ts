import type { Block } from '@frontdoorsales/flow-schema';
import { describe, expect, it, vi } from 'vitest';
import {
  type ConfirmedGateEntry,
  buildConfirmedGateEntry,
  isSignatureReachable,
  resolveBelehrungGateBlock,
} from './directSignGate';

const BELEHRUNG_BLOCK: Extract<Block, { type: 'belehrung' }> = {
  type: 'belehrung',
  id: 'direct-sign-belehrung',
  label: 'Widerrufsbelehrung',
  gate: true,
  noticeText: 'Sie haben das Recht, binnen vierzehn Tagen zu widerrufen.',
};

describe('isSignatureReachable', () => {
  it('is false when confirmedGates is empty', () => {
    expect(isSignatureReachable([], 'direct-sign-belehrung')).toBe(false);
  });

  it('is false when confirmedGates has entries for OTHER block ids only', () => {
    const confirmedGates: ConfirmedGateEntry[] = [
      {
        blockId: 'some-other-gate',
        confirmedAtIso: '2026-08-04T10:00:00.000Z',
        noticeTextSha256: 'abc',
      },
    ];
    expect(isSignatureReachable(confirmedGates, 'direct-sign-belehrung')).toBe(false);
  });

  it('is true when confirmedGates contains an entry for the required belehrung block id', () => {
    const confirmedGates: ConfirmedGateEntry[] = [
      {
        blockId: 'direct-sign-belehrung',
        confirmedAtIso: '2026-08-04T10:00:00.000Z',
        noticeTextSha256: 'abc',
      },
    ];
    expect(isSignatureReachable(confirmedGates, 'direct-sign-belehrung')).toBe(true);
  });

  it('is false when the required belehrung block id is null (no gate block resolved at all)', () => {
    const confirmedGates: ConfirmedGateEntry[] = [
      {
        blockId: 'direct-sign-belehrung',
        confirmedAtIso: '2026-08-04T10:00:00.000Z',
        noticeTextSha256: 'abc',
      },
    ];
    expect(isSignatureReachable(confirmedGates, null)).toBe(false);
  });
});

describe('buildConfirmedGateEntry', () => {
  it('returns {blockId, confirmedAtIso, noticeTextSha256} hashing the block noticeText via the injected digestFn', async () => {
    const digestFn = vi.fn(async (data: string) => `sha256(${data})`);
    const entry = await buildConfirmedGateEntry(
      BELEHRUNG_BLOCK,
      '2026-08-04T12:00:00.000Z',
      digestFn,
    );

    expect(entry).toEqual({
      blockId: 'direct-sign-belehrung',
      confirmedAtIso: '2026-08-04T12:00:00.000Z',
      noticeTextSha256: `sha256(${BELEHRUNG_BLOCK.noticeText})`,
    });
    expect(digestFn).toHaveBeenCalledWith(BELEHRUNG_BLOCK.noticeText);
    expect(digestFn).toHaveBeenCalledTimes(1);
  });

  it('never hashes anything other than the block noticeText — proves the notice source is the block, not the PDF', async () => {
    const digestFn = vi.fn(async () => 'irrelevant');
    await buildConfirmedGateEntry(BELEHRUNG_BLOCK, '2026-08-04T12:00:00.000Z', digestFn);
    expect(digestFn).toHaveBeenCalledExactlyOnceWith(BELEHRUNG_BLOCK.noticeText);
  });
});

describe('resolveBelehrungGateBlock', () => {
  it('resolves the belehrung block with gate=true — mirrors the server trigger/publish validator resolution', () => {
    const blocks: Block[] = [
      { type: 'text', id: 'intro', label: 'Intro', text: 'hi' } as unknown as Block,
      BELEHRUNG_BLOCK,
    ];
    expect(resolveBelehrungGateBlock(blocks)).toEqual(BELEHRUNG_BLOCK);
  });

  it('returns null when no belehrung block is present', () => {
    const blocks: Block[] = [
      { type: 'text', id: 'intro', label: 'Intro', text: 'hi' } as unknown as Block,
    ];
    expect(resolveBelehrungGateBlock(blocks)).toBeNull();
  });

  it('returns null when a belehrung block exists but gate is not true', () => {
    const blocks: Block[] = [{ ...BELEHRUNG_BLOCK, gate: false }];
    expect(resolveBelehrungGateBlock(blocks)).toBeNull();
  });

  it('ignores an unrelated block whose id happens to collide with the gate id', () => {
    const blocks: Block[] = [
      {
        type: 'text',
        id: 'direct-sign-belehrung',
        label: 'Not the gate',
        text: 'x',
      } as unknown as Block,
    ];
    expect(resolveBelehrungGateBlock(blocks)).toBeNull();
  });
});
