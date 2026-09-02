import { describe, expect, it } from 'vitest';
import type { RecommendationRule } from '@frontdoorsales/flow-schema';
import { deriveRecommendation } from './useRecommendation';

const rules: RecommendationRule[] = [
  {
    conditions: [
      { field: 'device-count', operator: 'equals', value: 'many' },
      { field: 'speed-tier', operator: 'gte', value: 500 },
    ],
    result: 'tarif-l',
  },
  { conditions: [{ field: 'device-count', operator: 'equals', value: 'several' }], result: 'tarif-m' },
  { conditions: [], result: 'tarif-s' }, // mandatory fallback (D-14)
];

describe('deriveRecommendation (D-12/D-14 — first-match wins, mandatory fallback)', () => {
  it('returns the first matching rule (order matters)', () => {
    expect(deriveRecommendation(rules, { 'device-count': 'many', 'speed-tier': 500 })).toBe('tarif-l');
  });

  it('falls through to a later rule when an earlier one does not match', () => {
    expect(deriveRecommendation(rules, { 'device-count': 'several', 'speed-tier': 100 })).toBe('tarif-m');
  });

  it('resolves the mandatory fallback when no specific rule matches', () => {
    expect(deriveRecommendation(rules, { 'device-count': 'few', 'speed-tier': 100 })).toBe('tarif-s');
  });
});
