/**
 * Hermes-safe de-DE EUR formatter. "1234.5" -> "1.234,50 €".
 *
 * Deliberately avoids `Intl.NumberFormat`: the codebase does not ship ICU
 * locale data on Hermes (see `ContractListScreen.formatSignedAt`). This
 * supersedes the `formatPrice` helper duplicated in DiscountBlock.tsx and
 * SignatureBlock.tsx (`value.toFixed(2).replace('.', ',')` — no thousands
 * separator, wrong for a monthly commission sum). Consolidating those two
 * copies into this function is optional and out of scope for Plan 06-02.
 *
 * Always emits exactly two fractional digits, '.' as the thousands group, ','
 * as the decimal separator, and a trailing " €". Negative values (reversal
 * lines) keep a leading '-'.
 */
export function formatEur(value: number): string {
  const [int = '0', frac = '00'] = Math.abs(value).toFixed(2).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sign = value < 0 ? '-' : '';
  return `${sign}${grouped},${frac} €`;
}
