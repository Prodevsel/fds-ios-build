import { describe, expect, it } from 'vitest';
import type { Block } from '@frontdoorsales/flow-schema';
import { deriveShowIfState } from './useShowIf';

function textBlock(id: string, showIf?: Block['showIf']): Block {
  return { type: 'text', id, label: id, gate: false, showIf };
}

describe('deriveShowIfState (D-13 operators + D-15 answer invalidation, Pitfall 3 single derived list)', () => {
  it('with no showIf, a block is always visible', () => {
    const blocks = [textBlock('a')];
    const { visible } = deriveShowIfState(blocks, {});
    expect(visible.map((b) => b.id)).toEqual(['a']);
  });

  it('equals operator gates visibility', () => {
    const blocks = [textBlock('a'), textBlock('b', [{ field: 'a', operator: 'equals', value: 'yes' }])];
    expect(deriveShowIfState(blocks, { a: 'yes' }).visible.map((b) => b.id)).toEqual(['a', 'b']);
    expect(deriveShowIfState(blocks, { a: 'no' }).visible.map((b) => b.id)).toEqual(['a']);
  });

  it('not_equals operator gates visibility', () => {
    const blocks = [textBlock('a'), textBlock('b', [{ field: 'a', operator: 'not_equals', value: 'no' }])];
    expect(deriveShowIfState(blocks, { a: 'yes' }).visible.map((b) => b.id)).toEqual(['a', 'b']);
    expect(deriveShowIfState(blocks, { a: 'no' }).visible.map((b) => b.id)).toEqual(['a']);
  });

  it('gte operator gates visibility', () => {
    const blocks = [textBlock('a'), textBlock('b', [{ field: 'speed', operator: 'gte', value: 250 }])];
    expect(deriveShowIfState(blocks, { speed: 500 }).visible.map((b) => b.id)).toEqual(['a', 'b']);
    expect(deriveShowIfState(blocks, { speed: 100 }).visible.map((b) => b.id)).toEqual(['a']);
  });

  it('lte operator gates visibility', () => {
    const blocks = [textBlock('a'), textBlock('b', [{ field: 'speed', operator: 'lte', value: 250 }])];
    expect(deriveShowIfState(blocks, { speed: 100 }).visible.map((b) => b.id)).toEqual(['a', 'b']);
    expect(deriveShowIfState(blocks, { speed: 500 }).visible.map((b) => b.id)).toEqual(['a']);
  });

  it('in operator gates visibility', () => {
    const blocks = [textBlock('a'), textBlock('b', [{ field: 'a', operator: 'in', value: ['x', 'y'] }])];
    expect(deriveShowIfState(blocks, { a: 'x' }).visible.map((b) => b.id)).toEqual(['a', 'b']);
    expect(deriveShowIfState(blocks, { a: 'z' }).visible.map((b) => b.id)).toEqual(['a']);
  });

  it('D-15: hiding a previously-answered block discards its answer from the pruned dataset', () => {
    const blocks = [textBlock('a'), textBlock('b', [{ field: 'a', operator: 'equals', value: 'yes' }])];
    // b was visible and answered while a === 'yes'...
    const answersWhileVisible = { a: 'yes', b: 'answered' };
    expect(deriveShowIfState(blocks, answersWhileVisible).prunedAnswers).toEqual({ a: 'yes', b: 'answered' });

    // ...then a flips to 'no', hiding b — its stale answer must be dropped.
    const answersAfterHiding = { a: 'no', b: 'answered' };
    expect(deriveShowIfState(blocks, answersAfterHiding).prunedAnswers).toEqual({ a: 'no' });
  });

  it('visible and prunedAnswers are derived from the SAME single pass (Pitfall 3) — never disagree', () => {
    const blocks = [
      textBlock('a'),
      textBlock('b', [{ field: 'a', operator: 'equals', value: 'yes' }]),
      textBlock('c'),
    ];
    const { visible, prunedAnswers } = deriveShowIfState(blocks, { a: 'no', b: 'stale', c: 'kept' });
    const visibleIds = new Set(visible.map((b) => b.id));
    for (const fieldId of Object.keys(prunedAnswers)) {
      expect(visibleIds.has(fieldId)).toBe(true);
    }
  });
});
