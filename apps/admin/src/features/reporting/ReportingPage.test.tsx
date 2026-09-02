import i18n from '@/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReportingPage } from './ReportingPage';
import type { DealsPerRep, DealsPerWeek, ReportingKpis } from './useReporting';

// Drive the data layer directly so each state (loading/empty/error/populated) and
// the dataviz-contract behaviours (KPI figures, table-view toggle) are asserted
// without Supabase/network.
type Q<T> = { data: T | undefined; isLoading: boolean; isError: boolean };
const mocks = vi.hoisted(() => ({
  kpis: { data: undefined, isLoading: false, isError: false } as Q<ReportingKpis>,
  week: { data: undefined, isLoading: false, isError: false } as Q<DealsPerWeek[]>,
  rep: { data: undefined, isLoading: false, isError: false } as Q<DealsPerRep[]>,
}));

vi.mock('./useReporting', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useReporting')>();
  return {
    ...actual,
    useReportingKpis: () => mocks.kpis,
    useDealsPerWeek: () => mocks.week,
    useDealsPerRep: () => mocks.rep,
  };
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <ReportingPage />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  mocks.kpis = { data: undefined, isLoading: false, isError: false };
  mocks.week = { data: undefined, isLoading: false, isError: false };
  mocks.rep = { data: undefined, isLoading: false, isError: false };
});

describe('ReportingPage (ADMN-03)', () => {
  it('renders KPI figures (tabular-nums) with no commission amount', () => {
    mocks.kpis = {
      data: { activeContracts: 12, activeReps: 4, avgContractsPerRep: 3 },
      isLoading: false,
      isError: false,
    };
    renderPage();
    expect(screen.getByText('Aktive Verträge')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('3,0')).toBeTruthy();
    // No euro/commission figure anywhere on the KPI band (Phase 6 scope).
    expect(screen.queryByText(/€|Provision|Commission/i)).toBeNull();
  });

  it('renders the empty state on the trend chart when no deals exist', () => {
    mocks.week = { data: [], isLoading: false, isError: false };
    mocks.rep = { data: [], isLoading: false, isError: false };
    renderPage();
    expect(screen.getAllByText('Noch keine Abschlüsse').length).toBeGreaterThan(0);
  });

  it('renders the error card when a reporting query fails', () => {
    mocks.kpis = { data: undefined, isLoading: false, isError: true };
    renderPage();
    expect(screen.getByText('Reporting konnte nicht geladen werden')).toBeTruthy();
  });

  it('toggles the team-comparison chart to a table view exposing the same series', () => {
    mocks.rep = {
      data: [
        { repId: 'r1', repName: 'Alice', deals: 5, commissionSumEur: 500, commissionDeals: 5, avgDealEur: 100 },
        { repId: 'r2', repName: 'Bob', deals: 2, commissionSumEur: null, commissionDeals: null, avgDealEur: null },
      ],
      isLoading: false,
      isError: false,
    };
    renderPage();
    // Two toggles exist (trend + team). Use the team chart's toggle.
    const toggles = screen.getAllByRole('button', { name: 'Als Tabelle anzeigen' });
    expect(toggles.length).toBeGreaterThan(0);
    fireEvent.click(toggles[toggles.length - 1]!);
    // A table now exposes Alice + Bob as rows.
    const tables = screen.getAllByRole('table');
    const teamTable = tables[tables.length - 1]!;
    expect(within(teamTable).getByText('Alice')).toBeTruthy();
    expect(within(teamTable).getByText('Bob')).toBeTruthy();
  });
});
