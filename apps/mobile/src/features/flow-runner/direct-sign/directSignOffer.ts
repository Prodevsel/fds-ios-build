import {
  type Block,
  type ChoiceBlock,
  type ConsentBlock,
  DEFAULT_OFFER_CONSENT_BLOCK,
  formatPlacementValue,
} from '@frontdoorsales/flow-schema';

/**
 * The offer exit for the `direct_pdf` path.
 *
 * Until now the offer outcome existed ONLY in the guided wizard
 * (`FlowRunnerScreen.tsx`). A `direct_pdf` customer who did not want to sign on
 * the spot had no exit but Abbrechen, and the whole consultation was lost.
 * These three pure functions are everything that decision needs; the sheet
 * itself is the SAME `EndAsLeadSheet` the wizard uses, so there is exactly one
 * consent-gated lead write path (`useEndAsLead` + the server's
 * `leads_insert_by_rep` WITH CHECK), not a second one.
 *
 * Pure and React-free on purpose: the mobile test harness has no
 * `react-test-renderer`, so anything that only lives inside a component cannot
 * be asserted.
 *
 * Two findings this module encodes:
 *
 *   * D-4 — `publishDirectSignProduct.ts` writes `blocks: [...questions,
 *     belehrungBlock]`. A `direct_pdf` product therefore carries NO consent
 *     block at all, and the offer exit would be unreachable without a
 *     fallback. `resolveOfferConsentBlock` applies the same two-step rule the
 *     wizard already applies: the product's own consent block if it has one,
 *     otherwise the platform default from flow-schema (the single SSOT — the
 *     fallback deliberately does not live in app code). The consent block is
 *     never added to what the flow ASKS; `directSignQuestionBlocks` stays the
 *     SSOT filter for that and already excludes `consent`.
 *
 *   * D-6 — `StatusSheet` routes a redemption on `snapshot.productSlug`, read
 *     out of the FROZEN snapshot. Without it, an offer created in the PDF path
 *     would be redeemed into the wizard — a different flow than the one the
 *     customer was shown. The snapshot carries no price fields: a `direct_pdf`
 *     product captures no discount block, and writing zeros would put a
 *     fabricated number on a customer-facing PDF.
 */

/** Mirrors `EndAsLeadContact` without importing the hook module (which pulls
 * in expo-crypto and would make this module native-dependent). */
export interface OfferContact {
  name?: string;
  phone?: string;
  email?: string;
}

/**
 * The consent block the offer sheet presents — the product's own if it
 * declares one, otherwise the platform default (D-4). Never `undefined`: a
 * missing consent block would silently disable the only exit this path has.
 */
export function resolveOfferConsentBlock(blocks: readonly Block[]): ConsentBlock {
  const authored = blocks.find((block): block is ConsentBlock => block.type === 'consent');
  return authored ?? DEFAULT_OFFER_CONSENT_BLOCK;
}

/**
 * The contact details the customer ALREADY answered in the PDF path, keyed by
 * the `contact` blocks' `field` (D-5). Used as a prefill for the offer sheet so
 * the e-mail is not asked a second time — the fields stay editable, this is a
 * starting value and never a lock.
 *
 * A blank, whitespace-only or non-string answer produces NO key rather than an
 * empty string: `''` would look like a captured value to everything downstream
 * (`hasEmail`, the leads row, the mailer) while being nothing at all.
 */
export function deriveOfferContactFromAnswers(
  blocks: readonly Block[],
  answers: Record<string, unknown>,
): OfferContact {
  const contact: OfferContact = {};
  for (const block of blocks) {
    if (block.type !== 'contact') continue;
    const answer = answers[block.id];
    // 'company' is a party, not a way to reach anyone. It has no slot on
    // OfferContact and must not be prefilled into one — an offer mail addressed
    // to a company NAME goes nowhere.
    if (block.field === 'company') continue;
    if (typeof answer !== 'string') continue;
    const trimmed = answer.trim();
    if (trimmed.length === 0) continue;
    contact[block.field] = trimmed;
  }
  return contact;
}

/**
 * The chosen package and what it costs, as the TEXT the customer was shown.
 *
 * A `direct_pdf` product carries no discount block (D-04), so there are no
 * doorPrice/comparisonPrice/discountAmount fields to freeze and the customer
 * page had nothing to put under "Ihre Konditionen" but a date. The price is not
 * an answer of its own either: it hangs on the chosen choice OPTION
 * (`choice.options[].price`, the same string `part: 'price'` stamps onto the
 * contract), so it has to be resolved through the blocks.
 *
 * The package is the FIRST choice block whose selected option carries a price
 * -- which is what a package block IS (`package-product.ts` requires every
 * option of a package to be priced). A choice without prices is an ordinary
 * question and is skipped rather than guessed at.
 *
 * Formatting goes through `formatPlacementValue`, the same function the
 * renderer stamps with, so the page and the PDF cannot disagree about what the
 * customer chose. Frozen, never looked up later: a relabelled or repriced
 * option must not retroactively change an offer that was already made.
 */
export function derivePackageTerms(
  blocks: readonly Block[],
  answers: Record<string, unknown>,
): { packageLabel?: string; packagePrice?: string } {
  for (const block of blocks) {
    if (block.type !== 'choice') continue;
    const answer = answers[block.id];
    if (answer === null || answer === undefined) continue;
    const price = formatPlacementValue(block as ChoiceBlock, answer, 'price');
    if (price.length === 0) continue;
    const label = formatPlacementValue(block as ChoiceBlock, answer, 'label');
    // Both or neither: a price with no package name reads like a fee out of
    // nowhere, and the page would rather show a date than half a condition.
    if (label.length === 0) continue;
    return { packageLabel: label, packagePrice: price };
  }
  return {};
}

/**
 * The offer snapshot frozen onto the lead (D-6). `productSlug` is what routes a
 * later redemption back into the PDF path; `answers` are the values actually
 * shown to the customer during this consultation;
 * `productDefinitionId` + `productVersion` pin the exact product VERSION the
 * conversation happened against, for the same reason `buildFlowOfferSnapshot`
 * pins it: without them `offer_portal_view` falls back to the highest published
 * version of the slug, and a customer opening the link after a new version was
 * published signs a Widerrufsbelehrung and terms text they were never shown.
 *
 * The answers are COPIED, so nothing the screen does to its state afterwards
 * can retroactively edit what was frozen onto the offer.
 */
export function buildDirectSignOfferSnapshot(input: {
  productSlug: string;
  answers: Record<string, unknown>;
  /** Resolved product definition row id; omit/null until the flow resolved it. */
  productDefinitionId?: string | null;
  /** Resolved product version; omit/null until the flow resolved it. */
  productVersion?: number | null;
  /** The product's blocks, so the chosen package and its price can be frozen. */
  blocks?: readonly Block[];
  /** 0101: the door this consultation ran on, so the redeemed contract can name it. */
  houseId?: string | null;
}): Record<string, unknown> {
  const { productDefinitionId = null, productVersion = null, houseId = null } = input;
  const terms = derivePackageTerms(input.blocks ?? [], input.answers);
  return {
    productSlug: input.productSlug,
    answers: { ...input.answers },
    ...terms,
    // The door, frozen alongside everything else. `offer_portal_sign` writes it
    // to contracts.house_id, which is the ONLY place the renderer reads the
    // customer's address from (`source: 'house.address'`) -- without it the
    // address line on the customer-signed contract stays empty. `leads` carries
    // territory_id and nothing finer, so the snapshot is the only carrier.
    ...(houseId !== null ? { houseId } : {}),
    // Same all-or-nothing pin as `buildFlowOfferSnapshot`: `offer_portal_view`
    // (0098 §5) guards on KEY PRESENCE, so a null-valued key passes the guard,
    // casts to a null uuid, finds no row and drops through to the slug
    // fallback anyway — one more way to be wrong for the same outcome.
    ...(productDefinitionId !== null && productVersion !== null
      ? { productDefinitionId, productVersion }
      : {}),
  };
}
