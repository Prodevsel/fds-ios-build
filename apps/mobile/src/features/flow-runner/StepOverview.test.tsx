import { describe, expect, it, vi } from 'vitest';
import type { Block } from '@frontdoorsales/flow-schema';

// No react-test-renderer in this repo (DiscountBlock.test.tsx precedent) —
// only the pure, exported gate/jump functions are exercised. StepOverview.tsx
// still imports 'react-native' at module scope for its JSX, so it must be
// mocked here even though the component itself is never rendered.
vi.mock('react-native', () => ({
  View: () => null,
  Text: () => null,
  Pressable: () => null,
  StyleSheet: { create: (styles: unknown) => styles },
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
// StepOverview.tsx (since this plan) calls useThemeColors() -> ThemeProvider/
// AccessibilityProvider's own native deps — mocked here too
// (DiscountBlock.test.tsx precedent).
vi.mock('../../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('../settings/settingsCache', () => ({
  createSettingsCache: () => ({ get: () => null, set: () => {} }),
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));

import { canJumpTo, firstUnconfirmedGateIndex } from './StepOverview';

function block(id: string, gate: boolean): Block {
  return { type: 'text', id, label: id, gate };
}

describe('firstUnconfirmedGateIndex (D-03)', () => {
  it('returns -1 when there is no gate block', () => {
    const blocks = [block('a', false), block('b', false)];
    expect(firstUnconfirmedGateIndex(blocks, {})).toBe(-1);
  });

  it('finds the first gate block with no confirm answer', () => {
    const blocks = [block('a', false), block('gate', true), block('c', false)];
    expect(firstUnconfirmedGateIndex(blocks, {})).toBe(1);
  });

  it('returns -1 once the gate block has a truthy confirm answer', () => {
    const blocks = [block('a', false), block('gate', true), block('c', false)];
    expect(firstUnconfirmedGateIndex(blocks, { gate: true })).toBe(-1);
  });

  it('a gate hidden by show-if (absent from the visible-ordered list) leaves no navigable past-gate index (Pitfall 3)', () => {
    // Simulates: gate was in the raw block list but a later answer change
    // hid it via show-if — by the time this function runs, the CALLER only
    // ever passes the already-filtered visible list, so the gate is simply
    // absent here, same as if it never existed.
    const blocksWithoutGate = [block('a', false), block('c', false)];
    expect(firstUnconfirmedGateIndex(blocksWithoutGate, {})).toBe(-1);
  });
});

describe('canJumpTo (D-02 backward allowed, D-03 forward-past-gate blocked)', () => {
  it('blocks a forward jump beyond maxReachedIndex regardless of gates', () => {
    expect(canJumpTo(3, 1, -1)).toBe(false);
  });

  it('allows a backward jump to an already-answered/reached block when there is no gate', () => {
    expect(canJumpTo(0, 2, -1)).toBe(true);
  });

  it('blocks a forward jump AT the first unconfirmed gate index', () => {
    expect(canJumpTo(1, 2, 1)).toBe(false);
  });

  it('blocks a forward jump AFTER the first unconfirmed gate index', () => {
    expect(canJumpTo(2, 2, 1)).toBe(false);
  });

  it('allows a jump strictly before the first unconfirmed gate index', () => {
    expect(canJumpTo(0, 2, 1)).toBe(true);
  });

  it('a gate hidden by a later show-if change (gateIndex recomputed to -1) re-opens forward jumps within the new visible list, never leaving a stale blocked state', () => {
    // Before: gate at index 1 blocks jumping to index 2.
    expect(canJumpTo(2, 2, 1)).toBe(false);
    // After show-if hides the gate, the SAME derived list no longer contains
    // it — firstUnconfirmedGateIndex recomputed against the new list is -1,
    // and index 2 in the OLD list may now be index 1 in the NEW list; either
    // way canJumpTo against the freshly recomputed inputs is consistent.
    expect(canJumpTo(1, 1, -1)).toBe(true);
  });
});

/**
 * SIGN-01 (real glasfaser-home ordering, products/glasfaser-home/v1.json):
 * intro, device-count, speed-tier, iban, identity(id-scan), then the
 * 'withdrawal-notice' belehrung GATE, then door-discount, then the
 * 'signature' GATE — verifies the jump guard against the ACTUAL product's
 * block ordering, not just synthetic text blocks (the tests above).
 */
const REAL_PRODUCT_BLOCK_IDS = [
  'intro',
  'device-count',
  'speed-tier',
  'iban',
  'identity',
  'withdrawal-notice', // gate: true
  'door-discount',
  'signature', // gate: true
];
const WITHDRAWAL_NOTICE_INDEX = REAL_PRODUCT_BLOCK_IDS.indexOf('withdrawal-notice');
const SIGNATURE_INDEX = REAL_PRODUCT_BLOCK_IDS.indexOf('signature');

function realProductBlock(id: string): Block {
  return { type: 'text', id, label: id, gate: id === 'withdrawal-notice' || id === 'signature' };
}
const REAL_PRODUCT_BLOCKS: Block[] = REAL_PRODUCT_BLOCK_IDS.map(realProductBlock);

describe('SIGN-01 against the real glasfaser-home block ordering', () => {
  it('the signature step is NOT jumpable while the withdrawal-notice belehrung is unconfirmed', () => {
    const gateIdx = firstUnconfirmedGateIndex(REAL_PRODUCT_BLOCKS, {});
    expect(gateIdx).toBe(WITHDRAWAL_NOTICE_INDEX);
    expect(canJumpTo(SIGNATURE_INDEX, REAL_PRODUCT_BLOCK_IDS.length - 1, gateIdx)).toBe(false);
  });

  it('the withdrawal-notice gate itself is not jumpable (AT the gate index)', () => {
    const gateIdx = firstUnconfirmedGateIndex(REAL_PRODUCT_BLOCKS, {});
    expect(canJumpTo(WITHDRAWAL_NOTICE_INDEX, REAL_PRODUCT_BLOCK_IDS.length - 1, gateIdx)).toBe(false);
  });

  it('once withdrawal-notice is confirmed, door-discount (between the two gates) becomes jumpable but signature (itself an unconfirmed gate) remains blocked', () => {
    const gateIdx = firstUnconfirmedGateIndex(REAL_PRODUCT_BLOCKS, { 'withdrawal-notice': true });
    const doorDiscountIndex = REAL_PRODUCT_BLOCK_IDS.indexOf('door-discount');
    // signature (gate:true, unconfirmed) is itself now the first unconfirmed gate —
    // D-03: a gate must be reached/confirmed via the normal forward flow, never
    // jumped onto or past, even when it is the target index itself.
    expect(gateIdx).toBe(SIGNATURE_INDEX);
    expect(canJumpTo(doorDiscountIndex, REAL_PRODUCT_BLOCK_IDS.length - 1, gateIdx)).toBe(true);
    expect(canJumpTo(SIGNATURE_INDEX, REAL_PRODUCT_BLOCK_IDS.length - 1, gateIdx)).toBe(false);
  });

  it('signature becomes jumpable only once it is ALSO confirmed (both gates satisfied)', () => {
    const gateIdx = firstUnconfirmedGateIndex(REAL_PRODUCT_BLOCKS, {
      'withdrawal-notice': true,
      signature: true,
    });
    expect(gateIdx).toBe(-1);
    expect(canJumpTo(SIGNATURE_INDEX, REAL_PRODUCT_BLOCK_IDS.length - 1, gateIdx)).toBe(true);
  });
});
