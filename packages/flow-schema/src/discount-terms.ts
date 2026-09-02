import { z } from 'zod';

/**
 * Discount terms entity (D-17/D-18) — its own versioned entity per
 * company/product, referenced by the discount block via `termsRef`, NEVER
 * embedded in the product definition JSON (D-17).
 *
 * Two variants (D-18):
 *  - `markdown`: markdown on an EXISTING online tariff — `comparisonPrice`
 *    (the struck-through online price) is REQUIRED.
 *  - `standalone`: a channel-only tariff variant with no online counterpart
 *    — `comparisonPrice` is optional (there may be nothing to compare to).
 */
const discountTermsBaseSchema = z.object({
  id: z.string(),
  productSlug: z.string(),
  version: z.number().int().positive(),
  doorPrice: z.number(),
  termsText: z.string(),

  // ── One-time / term / disclosure positions (H02, D-1) ────────────────────
  //
  // `doorPrice` and `comparisonPrice` are a MONTHLY pair. A one-time setup
  // fee, a minimum contract term and a net-price disclosure are none of those
  // things, and until now they only existed as prose inside `termsText` — a
  // string nothing can read, compare or print in its own line.
  //
  // They live on the TERMS entity and NOT on the `discount` block (D-1): the
  // block embeds nothing and references terms by id (`termsRef`, D-17), so
  // adding a field to the block would change the product-definition JSON shape
  // that published, immutable `product_definitions` rows are frozen against.
  // On the terms entity nothing already frozen moves — every existing row
  // stays valid and every existing product keeps pointing at exactly the row
  // it pointed at.
  //
  // Every one of them is OPTIONAL, never defaulted to a number: an absent
  // setup fee means "there is none", which is a different statement from
  // `setupFee: 0` ("we waive it"), and a default would silently rewrite the
  // meaning of every already-published row.
  //
  // `priceNote` is DISPLAY ONLY. No tax is computed from it anywhere in this
  // codebase (D-5) — it is a string a tenant may author to override the
  // platform's default net-price wording, nothing more.
  setupFee: z.number().nonnegative().optional(),
  setupFeeComparison: z.number().nonnegative().optional(),
  minimumTermMonths: z.number().int().positive().optional(),
  priceNote: z.string().optional(),
});

const markdownDiscountTermsSchema = discountTermsBaseSchema.extend({
  type: z.literal('markdown'),
  comparisonPrice: z.number(),
});

const standaloneDiscountTermsSchema = discountTermsBaseSchema.extend({
  type: z.literal('standalone'),
  comparisonPrice: z.number().optional(),
});

export const discountTermsSchema = z.discriminatedUnion('type', [
  markdownDiscountTermsSchema,
  standaloneDiscountTermsSchema,
]);
export type DiscountTerms = z.infer<typeof discountTermsSchema>;
