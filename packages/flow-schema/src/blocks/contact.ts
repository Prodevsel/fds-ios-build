import { z } from 'zod';
import { showIfConditionSchema } from '../conditions.ts';

/**
 * A short free-text field for the customer's own contact details.
 *
 * The schema had no free-text block at ALL — choice, slider, the two scanners,
 * the legal/display blocks and signature, nothing that captures a typed value.
 * That is why no product could record an email address, and why
 * `webhook-dispatcher`'s `extractRecipient()` (which looks for `answers.email`)
 * found nothing and refused to send the signed contract to anyone: the whole
 * white-label delivery path was built and had no recipient to aim at.
 *
 * `field` decides both the keyboard and the validation. It is deliberately a
 * closed set rather than a free regex: an operator authoring a product should
 * not be able to invent a validation rule for a legally relevant contact
 * detail.
 */
export const contactBlockSchema = z.object({
  type: z.literal('contact'),
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
  gate: z.boolean().default(false),
  showIf: z.array(showIfConditionSchema).optional(),
  /**
   * 'company' exists because a customer is not always a person. A business
   * cannot be asked for an identity document, so the id-scan can never be the
   * only way a contract learns who signed it — which is what produced
   * "Unbekannter Kunde" on every direct_pdf close.
   */
  field: z.enum(['email', 'phone', 'name', 'company']),
  placeholder: z.string().optional(),
  helpText: z.string().optional(),
  /** A blank value blocks the step when true (D-03 gate semantics still apply). */
  required: z.boolean().default(true),
});
export type ContactBlock = z.infer<typeof contactBlockSchema>;

/** Shared by the renderer and the publish-time validator so they cannot disagree. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Pure: is this value acceptable for `field`? Returns a reason rather than a
 * boolean so the renderer can show why, not just that.
 */
export function validateContactValue(
  field: ContactBlock['field'],
  value: string,
  required: boolean,
): 'ok' | 'empty' | 'invalid' {
  const trimmed = value.trim();
  if (trimmed.length === 0) return required ? 'empty' : 'ok';
  if (field === 'email') return EMAIL_RE.test(trimmed) ? 'ok' : 'invalid';
  if (field === 'phone') return /^[+0-9 ()/-]{6,}$/.test(trimmed) ? 'ok' : 'invalid';
  // 'name' and 'company' share the same rule: any non-empty text up to the
  // column width. Deliberately no "must contain a space" or legal-form check —
  // a one-word trade name is a real company, and a rejected valid answer at a
  // front door costs more than a sloppy one.
  return trimmed.length <= 200 ? 'ok' : 'invalid';
}
