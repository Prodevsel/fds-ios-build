import type { CompletionSnapshot } from './db/flowDraftsRepo';

/**
 * The `offer_snapshot` jsonb frozen onto a lead when a consultation ends as an
 * OFFER instead of a signature (`EndAsLeadSheet` -> `useEndAsLead`).
 *
 * Pure and exported for the same reason `reviewRows.ts` is: this repo has no
 * `react-test-renderer`, so anything that only exists inside
 * `FlowRunnerScreen`'s JSX cannot be asserted at all — and what this object
 * contains is exactly the kind of thing that must not regress unnoticed,
 * because nothing fails loudly when it does.
 *
 * ── Why the product version is pinned here ──────────────────────────────────
 * `offer_portal_view` (0098, §5) resolves the product the customer is shown
 * and asked to sign against in two steps: use `productDefinitionId` +
 * `productVersion` off this snapshot if BOTH keys are present, otherwise fall
 * back to the highest PUBLISHED version of `productSlug` in the lead's company
 * and report `product_pinned = false`.
 *
 * The fallback is correct-looking and wrong on exactly one day: the day a new
 * product version is published between the rep quoting the offer at the door
 * and the customer opening the link. Then the customer signs a Widerrufs-
 * belehrung, a price and a terms text they were never shown — an offer for
 * product v3 redeemed against v4. Slug resolution cannot detect this; it has
 * no idea which version the conversation happened against.
 *
 * The flow already knows the answer: it resolved and froze the version for the
 * contract path long before the rep reaches the offer surface. Writing the two
 * values here costs nothing and turns `product_pinned` honest.
 *
 * Both keys are OMITTED rather than written as null when the resolution has
 * not landed yet. The view's guard is `? 'productDefinitionId'`, a key-presence
 * test — a null-valued key passes it and then casts to a null uuid, which
 * finds no row and silently drops through to the slug fallback anyway. Same
 * outcome, one more way to be wrong; so an unresolved version simply does not
 * write the keys.
 */
export interface FlowOfferSnapshotInput {
  /** The frozen D-19 price/terms attribution — the numbers the rep actually showed. */
  snapshot: Pick<
    CompletionSnapshot,
    'doorPrice' | 'comparisonPrice' | 'discountAmount' | 'termsText'
  >;
  /** Routes a later redemption back into the right flow, and feeds the slug fallback. */
  productSlug: string;
  /** Resolved product definition row id; null until the flow's load resolves it. */
  productDefinitionId: string | null;
  /** Resolved product version; null until the flow's load resolves it. */
  productVersion: number | null;
}

export function buildFlowOfferSnapshot(input: FlowOfferSnapshotInput): Record<string, unknown> {
  const { snapshot, productSlug, productDefinitionId, productVersion } = input;
  return {
    doorPrice: snapshot.doorPrice,
    comparisonPrice: snapshot.comparisonPrice,
    discountAmount: snapshot.discountAmount,
    termsText: snapshot.termsText,
    productSlug,
    // All-or-nothing: a half-pinned snapshot would pass the view's
    // key-presence guard with a value it cannot resolve.
    ...(productDefinitionId !== null && productVersion !== null
      ? { productDefinitionId, productVersion }
      : {}),
  };
}
