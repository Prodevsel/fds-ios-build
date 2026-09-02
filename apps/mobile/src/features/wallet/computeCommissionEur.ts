/**
 * Frozen per-deal commission model (D-07). Supports BOTH:
 * - `flat_eur` — a fixed € amount per closed deal (`rate`).
 * - `percent`  — a share of the contract value (`base * rate / 100`).
 *
 * The rate/type/base arrive as SQLite text from the Plan-03 mapper. This pure
 * resolver MUST NEVER throw and MUST NEVER return NaN on malformed input
 * (T-06-06): any null/NaN numeric input yields `null`, which the UI renders as
 * "—" rather than a garbage number.
 */
export function computeCommissionEur(
  rateType: 'flat_eur' | 'percent' | null,
  rate: number | null,
  baseEur: number | null,
): number | null {
  if (rateType === null) return null;
  if (rate === null || Number.isNaN(rate)) return null;

  if (rateType === 'flat_eur') {
    return rate;
  }

  // percent: needs a valid per-deal contract-value base.
  if (baseEur === null || Number.isNaN(baseEur)) return null;
  return (baseEur * rate) / 100;
}
