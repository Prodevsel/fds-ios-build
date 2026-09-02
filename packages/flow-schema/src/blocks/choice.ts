import { z } from 'zod';
import { showIfConditionSchema } from '../conditions.ts';

export const choiceBlockSchema = z.object({
  type: z.literal('choice'),
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
  /**
   * An option is a CARD, not a line of prose.
   *
   * `label` alone forced everything into one run-on string — "Basic — 12
   * Inhalte im Monat, ein Kanal — 99,00 EUR statt 198,00 EUR monatlich" —
   * which wraps to three lines on a phone and reads like a database dump next
   * to a customer. The three optional fields below are what a package actually
   * has: a name, what it contains, and what it costs. All optional, so every
   * product authored before this renders byte-identically.
   */
  options: z
    .array(
      z.object({
        value: z.string(),
        /** The NAME. Short — "Basic", "Plus", not a sentence. */
        label: z.string(),
        /** What it contains, one line, muted under the name. */
        description: z.string().optional(),
        /** What it costs, set apart from the prose. Pre-formatted — nothing
         * here computes or rounds a price. */
        price: z.string().optional(),
        /** Struck through next to `price`. The regular rate, when there is one. */
        priceComparison: z.string().optional(),
        /** MaterialCommunityIcons glyph, so the three tiers are told apart at a
         * glance and not only by reading. */
        icon: z.string().optional(),
      }),
    )
    .min(1),
});
export type ChoiceBlock = z.infer<typeof choiceBlockSchema>;
