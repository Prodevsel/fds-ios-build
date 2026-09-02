import { z } from 'zod';
import { showIfConditionSchema } from '../conditions.ts';

/**
 * Discount block — references channel-exclusive terms by ID only (D-17).
 * Terms are NEVER embedded in the product definition JSON, so companies can
 * change terms without publishing a new product version.
 *
 * `showComparisonPrice` / `emphasize` are presentation flags for the
 * struck-through-price staging (D-16) — the automatic door-exclusive
 * advantage is always shown prominently, no rep discretion.
 */
export const discountBlockSchema = z.object({
  type: z.literal('discount'),
  id: z.string(),
  label: z.string(),
  gate: z.boolean().default(false), // D-03
  showIf: z.array(showIfConditionSchema).optional(), // D-13, flat AND
  termsRef: z.string(), // references discount_terms by id (D-17) — NOT embedded
  showComparisonPrice: z.boolean().default(true), // D-16/D-18 struck-through price staging
  emphasize: z.boolean().default(true), // D-16 — no rep discretion on prominence
});
export type DiscountBlock = z.infer<typeof discountBlockSchema>;
