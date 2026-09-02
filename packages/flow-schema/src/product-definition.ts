import { z } from 'zod';
import { textBlockSchema } from './blocks/text.ts';
import { choiceBlockSchema } from './blocks/choice.ts';
import { contactBlockSchema } from './blocks/contact.ts';
import { sliderBlockSchema } from './blocks/slider.ts';
import { ibanScanBlockSchema } from './blocks/iban-scan.ts';
import { idScanBlockSchema } from './blocks/id-scan.ts';
import { belehrungBlockSchema } from './blocks/belehrung.ts';
import { discountBlockSchema } from './blocks/discount.ts';
import { signatureBlockSchema } from './blocks/signature.ts';
import { recommendationBlockSchema } from './blocks/recommendation-block.ts';
import { consentBlockSchema } from './blocks/consent.ts';

// The 8 curated block types (D-06) plus the 03-07 recommendation block
// (D-12/D-14, hardening-phase addition) and the 05-13 consent block (D-17,
// the net-new lead-capture outcome block) — exhaustive, discriminated by `type`.
export const blockSchema = z.discriminatedUnion('type', [
  textBlockSchema,
  choiceBlockSchema,
  contactBlockSchema,
  sliderBlockSchema,
  ibanScanBlockSchema,
  idScanBlockSchema,
  belehrungBlockSchema,
  discountBlockSchema,
  signatureBlockSchema,
  recommendationBlockSchema,
  consentBlockSchema,
]);
export type Block = z.infer<typeof blockSchema>;

export const productDefinitionSchema = z.object({
  slug: z.string(),
  version: z.number().int().positive(),
  status: z.enum(['draft', 'published']),
  blocks: z.array(blockSchema),
  // D-01/D-04 (Phase 10): a product is either the default form-engine flow
  // ('flow_form') or a direct-sign uploaded PDF ('direct_pdf'). Additive,
  // backward-compatible default preserves every existing product.
  contract_mode: z.enum(['flow_form', 'direct_pdf']).default('flow_form'),
  directSignTemplateId: z.string().uuid().optional(),
  // H02 — the missing half of `flow_form` (D-4). A fixed-price uploaded PDF
  // cannot represent three differently-priced packages; the answer the trade
  // already settled on is an order form GENERATED from the answers plus the
  // partner's STATIC documents carried along unchanged. `flow_form` has always
  // generated the first half. `attachments` is the second: static partner PDFs
  // whose pages the dispatcher appends byte-unchanged after the generated order
  // form, so the customer signs ONE document.
  //
  // This is explicitly NOT a third contract_mode. Nothing about how the
  // contract originates changes — only how many pages the artifact ends up
  // with. Additive with a backward-compatible default: every existing product
  // file, none of which has this key, keeps validating and keeps producing
  // byte-identical output.
  attachments: z.array(z.object({ storagePath: z.string(), label: z.string() })).default([]),
});
export type ProductDefinition = z.infer<typeof productDefinitionSchema>;
/** One static partner document appended to the generated order form (H02). */
export type ProductAttachment = ProductDefinition['attachments'][number];
