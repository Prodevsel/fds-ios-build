import { z } from 'zod';
import { showIfConditionSchema } from '../conditions.ts';

/**
 * IBAN scan block — Phase 3 renders manual-entry only (checksum via
 * `ibantools` at the renderer layer). Phase 4 swaps the internals to a real
 * camera scan without changing this schema (D-06).
 */
export const ibanScanBlockSchema = z.object({
  type: z.literal('iban-scan'),
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
  helpText: z.string().optional(),
  /**
   * When true the step can be left without an IBAN. For a direct-debit product
   * the mandate IS the point and this stays false; for a product that invoices,
   * or a business customer who wants the bank details handled by their
   * accounts department, forcing an IBAN at the door loses the signature.
   *
   * Skipping writes NO answer at all rather than an empty string — '' would
   * look like a captured IBAN to everything downstream.
   */
  optional: z.boolean().default(false),
});
export type IbanScanBlock = z.infer<typeof ibanScanBlockSchema>;
