import i18n from '@/i18n';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { PerRepTable } from './PerRepTable';
import type { DealsPerRep } from './useReporting';

/**
 * Verifies the per-rep table wires Provision + Ø Deal from
 * reporting_commission_per_rep (0053): real values render as EUR, a rep with no
 * commission row keeps the honest "—", the "Team gesamt" row sums Provision and
 * computes Ø Deal, and the two commission headers are sortable.
 */

// Cara has 2 signed deals (0048) but no commission row (0053) — e.g. both were
// later cancelled — so her deals must NOT inflate the team Ø Deal denominator.
const ROWS: DealsPerRep[] = [
  { repId: 'r1', repName: 'Alice', deals: 5, commissionSumEur: 500, commissionDeals: 5, avgDealEur: 100 },
  { repId: 'r2', repName: 'Bob', deals: 3, commissionSumEur: 900, commissionDeals: 3, avgDealEur: 300 },
  { repId: 'r3', repName: 'Cara', deals: 2, commissionSumEur: null, commissionDeals: null, avgDealEur: null },
];

function renderTable() {
  return render(
    <I18nextProvider i18n={i18n}>
      <PerRepTable data={ROWS} isLoading={false} />
    </I18nextProvider>,
  );
}

describe('PerRepTable commission wiring (0053)', () => {
  it('renders Provision + Ø Deal as EUR and keeps "—" for a repless commission row', () => {
    renderTable();
    expect(screen.getByText('500 €')).toBeTruthy();
    expect(screen.getByText('300 €')).toBeTruthy();
    // Cara has no commission row → honest em-dash (also used by Quote + company sub-label).
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('sums Provision and computes team Ø Deal in the "Team gesamt" footer', () => {
    renderTable();
    const table = screen.getByRole('table');
    const foot = table.querySelector('tfoot');
    expect(foot).not.toBeNull();
    // Σ commission = 1400; Ø Deal = 1400 / Σ closed-set count (5+3, Cara excluded) = 175.
    expect(within(foot as HTMLElement).getByText('1.400 €')).toBeTruthy();
    expect(within(foot as HTMLElement).getByText('175 €')).toBeTruthy();
  });

  it('exposes a sortable Provision header', () => {
    renderTable();
    const provision = screen.getByRole('button', { name: /Provision/i });
    fireEvent.click(provision);
    expect(provision.closest('th')?.getAttribute('aria-sort')).toBe('descending');
  });
});
