import { z } from 'zod';
import { showIfConditionSchema } from '../conditions.ts';
import { recommendationRuleListSchema } from '../recommendation.ts';

/**
 * Recommendation block (D-12/D-14): derives a tariff/option suggestion from
 * earlier answers via the SSOT `recommendationRuleListSchema`/`evaluateRecommendation`
 * (ordered rule list, first-match wins, mandatory fallback — see
 * ../recommendation.ts). `options` gives each possible `result` value a
 * human-readable label for both the suggestion display and the rep-override
 * selector (D-14 — the rep can override, customer decides).
 */
export const recommendationBlockSchema = z.object({
  type: z.literal('recommendation'),
  id: z.string(),
  label: z.string(),
  gate: z.boolean().default(false), // D-03
  showIf: z.array(showIfConditionSchema).optional(), // D-13, flat AND
  rules: recommendationRuleListSchema,
  options: z.array(z.object({ value: z.string(), label: z.string() })).min(1),
});
export type RecommendationBlock = z.infer<typeof recommendationBlockSchema>;
