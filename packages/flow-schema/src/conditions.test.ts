import { describe, expect, it } from 'vitest';
import { evaluateShowIf, visibleBlocks, pruneInvalidatedAnswers } from './conditions';
import type { Block } from './product-definition';

function block(id: string, showIf?: unknown): Block {
  return {
    type: 'text',
    id,
    label: id,
    gate: false,
    showIf: showIf as Block['showIf'],
  } as Block;
}

describe('evaluateShowIf', () => {
  it('returns true when conditions is undefined (no condition = always visible)', () => {
    expect(evaluateShowIf(undefined, {})).toBe(true);
  });

  it('returns true when conditions is an empty array', () => {
    expect(evaluateShowIf([], {})).toBe(true);
  });

  it('AND-combines multiple conditions — all must pass', () => {
    const conditions = [
      { field: 'tier', operator: 'equals' as const, value: 'premium' },
      { field: 'devices', operator: 'gte' as const, value: 2 },
    ];
    expect(evaluateShowIf(conditions, { tier: 'premium', devices: 3 })).toBe(true);
    expect(evaluateShowIf(conditions, { tier: 'premium', devices: 1 })).toBe(false);
  });

  it('equals operator', () => {
    const c = [{ field: 'tier', operator: 'equals' as const, value: 'premium' }];
    expect(evaluateShowIf(c, { tier: 'premium' })).toBe(true);
    expect(evaluateShowIf(c, { tier: 'basic' })).toBe(false);
  });

  it('not_equals operator', () => {
    const c = [{ field: 'tier', operator: 'not_equals' as const, value: 'premium' }];
    expect(evaluateShowIf(c, { tier: 'basic' })).toBe(true);
    expect(evaluateShowIf(c, { tier: 'premium' })).toBe(false);
  });

  it('gte operator', () => {
    const c = [{ field: 'devices', operator: 'gte' as const, value: 3 }];
    expect(evaluateShowIf(c, { devices: 3 })).toBe(true);
    expect(evaluateShowIf(c, { devices: 2 })).toBe(false);
  });

  it('lte operator', () => {
    const c = [{ field: 'devices', operator: 'lte' as const, value: 3 }];
    expect(evaluateShowIf(c, { devices: 3 })).toBe(true);
    expect(evaluateShowIf(c, { devices: 4 })).toBe(false);
  });

  it('in operator', () => {
    const c = [{ field: 'tier', operator: 'in' as const, value: ['premium', 'pro'] }];
    expect(evaluateShowIf(c, { tier: 'pro' })).toBe(true);
    expect(evaluateShowIf(c, { tier: 'basic' })).toBe(false);
  });
});

describe('visibleBlocks', () => {
  it('returns only blocks whose showIf passes', () => {
    const blocks = [
      block('a'),
      block('b', [{ field: 'tier', operator: 'equals', value: 'premium' }]),
    ];
    const result = visibleBlocks(blocks, { tier: 'basic' });
    expect(result.map((b) => b.id)).toEqual(['a']);
  });
});

describe('pruneInvalidatedAnswers', () => {
  it('drops answer keys for hidden blocks (D-15)', () => {
    const blocks = [
      block('a'),
      block('b', [{ field: 'a', operator: 'equals', value: 'yes' }]),
    ];
    const answers = { a: 'no', b: 'some answer for a hidden block' };
    const result = pruneInvalidatedAnswers(blocks, answers);
    expect(result).toEqual({ a: 'no' });
  });

  it('keeps answers of blocks that remain visible', () => {
    const blocks = [block('a'), block('b')];
    const answers = { a: 'x', b: 'y' };
    const result = pruneInvalidatedAnswers(blocks, answers);
    expect(result).toEqual({ a: 'x', b: 'y' });
  });
});
