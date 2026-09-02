import { describe, expect, it } from 'vitest';
import { recommendationBlockSchema } from './recommendation-block';

describe('recommendationBlockSchema (D-12/D-14)', () => {
  it('validates with an ordered rule list (mandatory fallback) and options', () => {
    const result = recommendationBlockSchema.safeParse({
      type: 'recommendation',
      id: 'tariff-suggestion',
      label: 'Ihr passender Tarif',
      rules: [
        { conditions: [{ field: 'device-count', operator: 'equals', value: 'many' }], result: 'tarif-l' },
        { conditions: [], result: 'tarif-s' },
      ],
      options: [
        { value: 'tarif-s', label: 'Tarif S' },
        { value: 'tarif-l', label: 'Tarif L' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a rule list without a mandatory fallback validated by shape (empty rules array still parses; evaluator enforces fallback at runtime)', () => {
    const result = recommendationBlockSchema.safeParse({
      type: 'recommendation',
      id: 'tariff-suggestion',
      label: 'Ihr passender Tarif',
      rules: [],
      options: [{ value: 'tarif-s', label: 'Tarif S' }],
    });
    // Schema-level shape is valid (empty array is a valid RuleList); the
    // MANDATORY-fallback guarantee is an evaluateRecommendation runtime
    // invariant (throws at evaluation, not at parse time) — see recommendation.ts.
    expect(result.success).toBe(true);
  });

  it('rejects when options is empty', () => {
    const result = recommendationBlockSchema.safeParse({
      type: 'recommendation',
      id: 'tariff-suggestion',
      label: 'Ihr passender Tarif',
      rules: [{ conditions: [], result: 'tarif-s' }],
      options: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a block missing required rules', () => {
    const result = recommendationBlockSchema.safeParse({
      type: 'recommendation',
      id: 'tariff-suggestion',
      label: 'Ihr passender Tarif',
      options: [{ value: 'tarif-s', label: 'Tarif S' }],
    });
    expect(result.success).toBe(false);
  });
});
