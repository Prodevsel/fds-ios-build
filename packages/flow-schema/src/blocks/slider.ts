import { z } from 'zod';
import { showIfConditionSchema } from '../conditions.ts';

export const sliderBlockSchema = z.object({
  type: z.literal('slider'),
  id: z.string(),
  label: z.string(),
  /**
   * Short label for lists that are not the question itself — the pre-signature
   * check and the "what gets stamped" summary. A review row headed "Wie lautet
   * der Firmenname?" is a question nobody is being asked any more; the row
   * wants a NOUN. Optional: falls back to `label`, so nothing authored before
   * this changes.
   */
  shortLabel: z.string().optional(),
  gate: z.boolean().default(false), // D-03
  showIf: z.array(showIfConditionSchema).optional(), // D-13, flat AND
  min: z.number(),
  max: z.number(),
  step: z.number(),
  unit: z.string().optional(),
});
export type SliderBlock = z.infer<typeof sliderBlockSchema>;
