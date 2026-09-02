import { z } from 'zod';
import { showIfConditionSchema } from '../conditions.ts';

/**
 * Widerrufsbelehrung (statutory withdrawal notice) block — display + confirm.
 * Enforced as a gate block in Phase 4 (SIGN-01); the `gate` attribute is
 * schema-declared here, enforcement lives client-side in the flow-runner.
 */
export const belehrungBlockSchema = z.object({
  type: z.literal('belehrung'),
  id: z.string(),
  label: z.string(),
  gate: z.boolean().default(false), // D-03
  showIf: z.array(showIfConditionSchema).optional(), // D-13, flat AND
  noticeText: z.string(),
});
export type BelehrungBlock = z.infer<typeof belehrungBlockSchema>;
