import { describe, expect, it } from 'vitest';

import { type WalletDealForAggregate, aggregateWallet } from './aggregateWallet';

// now = local mid-July 2026. Deal timestamps sit at mid-day / mid-month so a
// reasonable local timezone offset never shifts them across a month boundary.
const NOW = new Date(2026, 6, 15, 12, 0, 0); // local 2026-07-15
const thisMonth = (state: WalletDealForAggregate['state'], commissionEur: number | null) => ({
  signedAtIso: '2026-07-10T12:00:00.000Z',
  state,
  commissionEur,
});
const lastMonth = (state: WalletDealForAggregate['state'], commissionEur: number | null) => ({
  signedAtIso: '2026-06-10T12:00:00.000Z',
  state,
  commissionEur,
});

describe('aggregateWallet (D-04 month count vs D-10 all-open totals)', () => {
  it('returns all-zero totals for an empty deal list', () => {
    expect(aggregateWallet([], NOW)).toEqual({
      dealsThisMonth: 0,
      securedEur: 0,
      underReviewEur: 0,
    });
  });

  it('counts every deal signed in the current calendar month regardless of state (D-04)', () => {
    const deals: WalletDealForAggregate[] = [
      thisMonth('secured', 100),
      thisMonth('in_review', 50),
      thisMonth('reversed', 200), // reversed STILL counts as closed this month
      lastMonth('secured', 999), // last month — excluded from the count
    ];
    expect(aggregateWallet(deals, NOW).dealsThisMonth).toBe(3);
  });

  it('sums secured and under-review across ALL open deals, not month-scoped (D-10)', () => {
    const deals: WalletDealForAggregate[] = [
      thisMonth('secured', 100),
      lastMonth('secured', 40), // still counts toward securedEur (money does not reset)
      thisMonth('in_review', 50),
    ];
    const totals = aggregateWallet(deals, NOW);
    expect(totals.securedEur).toBe(140);
    expect(totals.underReviewEur).toBe(50);
  });

  it('proves the D-04 vs D-10 boundary: a last-month in_review deal is excluded from the count yet included in underReviewEur', () => {
    const deals: WalletDealForAggregate[] = [lastMonth('in_review', 30)];
    const totals = aggregateWallet(deals, NOW);
    expect(totals.dealsThisMonth).toBe(0);
    expect(totals.underReviewEur).toBe(30);
  });

  it('excludes reversed deals from BOTH euro totals (D-01 visible reversal, not counted as earnings)', () => {
    const deals: WalletDealForAggregate[] = [
      thisMonth('reversed', 500),
      lastMonth('reversed', 300),
    ];
    const totals = aggregateWallet(deals, NOW);
    expect(totals.securedEur).toBe(0);
    expect(totals.underReviewEur).toBe(0);
  });

  it('treats a null commissionEur as 0 in the totals (never NaN)', () => {
    const deals: WalletDealForAggregate[] = [
      thisMonth('secured', null),
      thisMonth('in_review', null),
    ];
    const totals = aggregateWallet(deals, NOW);
    expect(totals.securedEur).toBe(0);
    expect(totals.underReviewEur).toBe(0);
    expect(Number.isNaN(totals.securedEur)).toBe(false);
  });
});
