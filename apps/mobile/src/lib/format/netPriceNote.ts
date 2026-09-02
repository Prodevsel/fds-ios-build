import { t } from '../../i18n';

/**
 * The net-price note (H02/D-5).
 *
 * DISPLAY ONLY. Nothing here — and nothing downstream of here — computes VAT.
 * The note states that the prices shown are net; it never multiplies, adds to
 * or derives a gross amount from any figure. A grep gate in the plan's
 * verification and an assertion in netPriceNote.test.ts both hold this line,
 * because the failure mode is silent and expensive: a number quietly computed
 * at a front door is a number nobody reviewed.
 *
 * Whether net pricing may be ADVERTISED at all to a given customer type is an
 * open legal question for the Fachanwalt (specialized attorney) and explicitly
 * out of scope here. This module's only job is that the disclosure exists next
 * to every price, in one place.
 *
 * One helper, three call sites (discount hero, success screen, and the PDF's
 * own constant) — so when the note becomes tenant-configurable, it becomes
 * configurable HERE, not in three drifting copies. A tenant that already
 * authored its own wording on the terms row (`discount_terms.price_note`, 0090)
 * overrides this default at the call site; this is the platform fallback.
 */
export function netPriceNote(): string {
  return t('price.netNote');
}

/** `"99,00 €"` -> `"99,00 € zzgl. USt."` — string concatenation, never arithmetic. */
export function withNetNote(text: string): string {
  return `${text} ${netPriceNote()}`;
}
