import { z } from 'zod';
import { showIfConditionSchema } from '../conditions.ts';

export const textBlockSchema = z.object({
  type: z.literal('text'),
  id: z.string(),
  label: z.string(),
  gate: z.boolean().default(false), // D-03 — enforced client-side later
  showIf: z.array(showIfConditionSchema).optional(), // D-13 flat AND
  multiline: z.boolean().optional(),
});
export type TextBlock = z.infer<typeof textBlockSchema>;
