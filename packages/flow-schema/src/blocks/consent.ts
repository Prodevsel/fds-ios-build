import { z } from 'zod';
import { showIfConditionSchema } from '../conditions.ts';

/**
 * Consent block (D-17) — the net-new curated block that turns "interested, no
 * signature" into a lead. A lead is an EXPLICIT flow outcome: the rep may end a
 * consultation as a lead ONLY after the customer confirms this consent block
 * (no consent → no lead; abandonment ≠ consent). Mirrors belehrung.ts (display
 * + confirm) but additionally declares which contact fields the lead outcome
 * captures and an optional reference to the earlier answer that holds the
 * product interest — the SSOT the mobile end-as-lead sheet renders and the
 * Edge Function/partner API validates against (CONVENTIONS: flow-schema is the
 * single form-engine definition).
 */
export const consentBlockSchema = z.object({
  type: z.literal('consent'),
  id: z.string(),
  label: z.string(),
  gate: z.boolean().default(false), // D-03 — enforced client-side in the flow-runner
  showIf: z.array(showIfConditionSchema).optional(), // D-13, flat AND
  // The statutory/marketing consent copy shown to the customer before the lead
  // is created. Required — a consent block with no text cannot consent to
  // anything, so the leads INSERT WITH CHECK (05-03) would have nothing to gate.
  consentText: z.string(),
  // Explicit boolean confirmation requirement: the outcome may only write a
  // lead once this block has been affirmatively confirmed. Kept schema-declared
  // (like belehrung's `gate`) so the SSOT — not ad-hoc client code — states
  // that consent is mandatory. Enforcement of the runtime confirmation lives
  // client-side in useEndAsLead + server-side in the WITH CHECK (T-05-43).
  requiresConfirmation: z.boolean(),
  // Which contact fields the end-as-lead sheet captures for the leads row
  // (maps to leads.contact_name/contact_phone/contact_email, 0033). Defaulted
  // to the full set — GDPR data-minimization is applied per field at capture.
  contactFields: z.array(z.enum(['name', 'phone', 'email'])).default(['name', 'phone', 'email']),
  // Optional reference to an earlier block's answer id whose value describes the
  // product the customer is interested in (maps to leads.product_interest).
  productInterestFieldId: z.string().optional(),
});
export type ConsentBlock = z.infer<typeof consentBlockSchema>;

/**
 * §5.2 fallback consent block for the offer outcome.
 *
 * ponytail: no published product declares a `consent` block yet, so the offer
 * path would be unreachable without one. It lives here rather than in app code
 * so admin, app and Edge Function still read ONE definition (CONVENTIONS: the
 * form engine has a single SSOT). Delete this constant the moment products
 * author their own consent block — the sheet already prefers the product's.
 */
export const DEFAULT_OFFER_CONSENT_BLOCK: ConsentBlock = {
  type: 'consent',
  id: 'offer-consent',
  label: 'Einwilligung zur Angebotszusendung',
  gate: false,
  consentText:
    'Ich bin damit einverstanden, dass mir das besprochene Angebot per E-Mail zugesendet wird und meine Kontaktdaten zu diesem Zweck gespeichert werden. Die Einwilligung kann jederzeit widerrufen werden.',
  requiresConfirmation: true,
  contactFields: ['name', 'phone', 'email'],
};
