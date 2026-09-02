import { z } from 'zod';
import { showIfConditionSchema } from '../conditions.ts';

/**
 * ID document scan block — Phase 3 renders manual-entry only (no OCR/MRZ).
 * Phase 4 swaps the internals to a real camera scan without changing this
 * schema (D-06).
 */
export const idScanBlockSchema = z.object({
  type: z.literal('id-scan'),
  id: z.string(),
  label: z.string(),
  gate: z.boolean().default(false), // D-03
  showIf: z.array(showIfConditionSchema).optional(), // D-13, flat AND
  helpText: z.string().optional(),
});
export type IdScanBlock = z.infer<typeof idScanBlockSchema>;
