import { describe, expect, it } from 'vitest';
import { evaluateRecommendation, recommendationRuleListSchema } from './recommendation';

describe('recommendationRuleListSchema', () => {
  it('validates an ordered rule list with a mandatory fallback (no conditions)', () => {
    const result = recommendationRuleListSchema.safeParse([
      {
        conditions: [{ field: 'devices', operator: 'gte', value: 3 }],
        result: 'tarif-l',
      },
      { conditions: [], result: 'tarif-s' }, // fallback
    ]);
    expect(result.success).toBe(true);
  });
});

describe('evaluateRecommendation', () => {
  const rules = [
    {
      conditions: [
        { field: 'devices', operator: 'gte' as const, value: 3 },
        { field: 'uhd', operator: 'equals' as const, value: 'yes' },
      ],
      result: 'tarif-l',
    },
    {
      conditions: [{ field: 'devices', operator: 'gte' as const, value: 2 }],
      result: 'tarif-m',
    },
    { conditions: [], result: 'tarif-s' }, // mandatory fallback
  ];

  it('returns the first matching rule (order matters)', () => {
    expect(evaluateRecommendation(rules, { devices: 3, uhd: 'yes' })).toBe('tarif-l');
  });

  it('falls through to a later rule when an earlier one does not match', () => {
    expect(evaluateRecommendation(rules, { devices: 2, uhd: 'no' })).toBe('tarif-m');
  });

  it('resolves the mandatory fallback when no specific rule matches', () => {
    expect(evaluateRecommendation(rules, { devices: 0, uhd: 'no' })).toBe('tarif-s');
  });
});
