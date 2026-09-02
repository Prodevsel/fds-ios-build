import { z } from 'zod';
import { showIfConditionSchema } from '../conditions.ts';

/**
 * Signature block — Phase 3 renders a placeholder screen only. Phase 4 swaps
 * the internals to a real eIDAS-SES signature capture without changing this
 * schema (D-06).
 */
export const signatureBlockSchema = z.object({
  type: z.literal('signature'),
  id: z.string(),
  label: z.string(),
  gate: z.boolean().default(false), // D-03
  showIf: z.array(showIfConditionSchema).optional(), // D-13, flat AND
});
export type SignatureBlock = z.infer<typeof signatureBlockSchema>;
