import { z } from 'zod';
import { showIfConditionSchema } from './conditions.ts';

/**
 * Ordered recommendation rule list (D-14): reuses the flat-AND condition
 * syntax (D-13). First matching rule wins; a mandatory fallback rule (empty
 * `conditions`) always resolves a result. The rep-override is a UI concern
 * (03-07), not modeled here beyond returning a result the UI can replace.
 */
export const recommendationRuleSchema = z.object({
  conditions: z.array(showIfConditionSchema),
  result: z.string(),
});
export type RecommendationRule = z.infer<typeof recommendationRuleSchema>;

export const recommendationRuleListSchema = z.array(recommendationRuleSchema);
export type RecommendationRuleList = z.infer<typeof recommendationRuleListSchema>;

/**
 * Evaluates an ordered rule list against the current answers: first matching
 * rule wins. A rule with an empty `conditions` array always matches — used
 * as the mandatory fallback and MUST be the last entry in the list.
 */
export function evaluateRecommendation(
  rules: RecommendationRule[],
  answers: Record<string, unknown>,
): string {
  for (const rule of rules) {
    const matches = rule.conditions.every((c) => {
      switch (c.operator) {
        case 'equals':
          return answers[c.field] === c.value;
        case 'not_equals':
          return answers[c.field] !== c.value;
        case 'gte':
          return typeof answers[c.field] === 'number' && typeof c.value === 'number' && (answers[c.field] as number) >= c.value;
        case 'lte':
          return typeof answers[c.field] === 'number' && typeof c.value === 'number' && (answers[c.field] as number) <= c.value;
        case 'in':
          return Array.isArray(c.value) && typeof answers[c.field] === 'string' && c.value.includes(answers[c.field] as string);
        default:
          return false;
      }
    });
    if (matches) return rule.result;
  }
  throw new Error('evaluateRecommendation: no rule matched — a mandatory fallback rule (empty conditions) is required');
}
