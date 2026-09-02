import type { WalletState } from './deriveWalletState';

/**
 * A single deal reduced to the fields the wallet KPIs need. `commissionEur` is
 * the already-resolved amount (see computeCommissionEur); `state` is the
 * derived lifecycle state (see deriveWalletState).
 *
 * Tester exclusion (D-06) is enforced UPSTREAM at the query/mapper layer
 * (Plan 03, `WHERE is_test = false`, mirroring reporting) — by the time deals
 * reach this pure aggregator they are already tester-filtered, which is why no
 * `is_test` field appears here.
 */
export interface WalletDealForAggregate {
  signedAtIso: string;
  commissionEur: number | null;
  state: WalletState;
}

export interface WalletTotals {
  /** Count of deals SIGNED in `now`'s local calendar month, any state (D-04). */
  dealsThisMonth: number;
  /** Sum of commissionEur over state==='secured' across ALL open deals (D-10). */
  securedEur: number;
  /** Sum of commissionEur over state==='in_review' across ALL open deals (D-10). */
  underReviewEur: number;
}

/**
 * Pure 3-KPI aggregation.
 *
 * - `dealsThisMonth` is calendar-month-scoped (D-04): a deal signed this month
 *   counts even if it is already reversed.
 * - `securedEur` / `underReviewEur` are NOT month-scoped (D-10): a deal still in
 *   its Widerrufsfrist from last month keeps counting; money does not reset at
 *   the month boundary.
 * - `reversed` deals contribute to NEITHER euro total (shown as a visible
 *   reversal line elsewhere, D-01). A null `commissionEur` contributes 0.
 */
export function aggregateWallet(deals: WalletDealForAggregate[], now: Date): WalletTotals {
  const year = now.getFullYear();
  const month = now.getMonth(); // D-04: local calendar month.

  let dealsThisMonth = 0;
  let securedEur = 0;
  let underReviewEur = 0;

  for (const deal of deals) {
    const signed = new Date(deal.signedAtIso);
    if (signed.getFullYear() === year && signed.getMonth() === month) {
      dealsThisMonth++;
    }

    const amount = deal.commissionEur ?? 0;
    if (deal.state === 'secured') {
      securedEur += amount;
    } else if (deal.state === 'in_review') {
      underReviewEur += amount;
    }
    // 'reversed' contributes to neither total.
  }

  return { dealsThisMonth, securedEur, underReviewEur };
}
