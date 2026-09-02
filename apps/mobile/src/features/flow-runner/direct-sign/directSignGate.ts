import type { BelehrungBlock, Block } from '@frontdoorsales/flow-schema';

/**
 * DSGN-02/T-10-20/T-10-21: the pure, load-bearing core of the app-native
 * Widerrufsbelehrung (statutory withdrawal notice) gate — makes the
 * signature step TECHNICALLY unreachable until the customer confirms a
 * notice sourced from the product's `belehrung` gate block, never from the
 * PDF's own content (§ 312b BGB, Pattern 4 anti-pattern avoided).
 *
 * No I/O, no React, no PDF/file access here — DirectSignFlowScreen (Task 3)
 * is the only consumer, kept pure/DI'd so this is unit-tested without
 * mounting anything (StatusSheet.tsx pattern, matches the rest of
 * flow-runner's orchestration modules).
 */

/** Mirrors AuditPackage['confirmedGates'] element shape (buildAuditPackage.ts) — the server trigger (0030) validates this exact shape. */
export interface ConfirmedGateEntry {
  blockId: string;
  confirmedAtIso: string;
  noticeTextSha256: string;
}

/**
 * True only when `confirmedGates` already contains an entry for
 * `requiredBelehrungBlockId`. A null id (no belehrung gate block resolved
 * on the product at all) can never be satisfied — the signature step stays
 * unreachable rather than silently reachable-by-default.
 */
export function isSignatureReachable(
  confirmedGates: ConfirmedGateEntry[],
  requiredBelehrungBlockId: string | null,
): boolean {
  if (requiredBelehrungBlockId === null) return false;
  return confirmedGates.some((entry) => entry.blockId === requiredBelehrungBlockId);
}

/**
 * Builds the confirmedGates entry the server notice-gate trigger (0030)
 * validates. Hashes ONLY `block.noticeText` — the block is the SSOT for
 * what was actually shown/confirmed (T-10-21); this function never touches
 * PDF bytes or any PDF-derived text. Reuses the caller's injected digestFn
 * (the SAME expo-crypto path the rest of the audit pipeline uses, D-26) —
 * no new hashing dependency introduced here.
 */
export async function buildConfirmedGateEntry(
  block: BelehrungBlock,
  nowIso: string,
  digestFn: (data: string) => Promise<string>,
): Promise<ConfirmedGateEntry> {
  const noticeTextSha256 = await digestFn(block.noticeText);
  return { blockId: block.id, confirmedAtIso: nowIso, noticeTextSha256 };
}

/**
 * Resolves the product's belehrung gate block by (type==='belehrung' &&
 * gate===true) — the SAME resolution shape assertDirectSignPublishable
 * (packages/flow-schema/src/direct-sign.ts) and the 0030 trigger use, so
 * client, publish-time validator, and server trigger all agree on the same
 * block. Returns null when no such block exists (should never happen for a
 * publishable direct_pdf product, but the caller must not assume it does —
 * isSignatureReachable above already treats null as "never reachable").
 */
export function resolveBelehrungGateBlock(blocks: Block[]): BelehrungBlock | null {
  const block = blocks.find(
    (candidate): candidate is BelehrungBlock =>
      candidate.type === 'belehrung' && candidate.gate === true,
  );
  return block ?? null;
}
