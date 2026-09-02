import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import i18n from '@/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DealsPage } from './DealsPage';
import type { DealPdfStatus, DealRow, DeliveryState } from './useDeals';

function mkDeal(overrides: Partial<DealRow> & Pick<DealRow, 'id'>): DealRow {
  return {
    company_id: 'c1',
    deal_reference: 'DEAL-42',
    company_name: 'Nordlicht Vertrieb',
    product_name: 'glasfaser-1000',
    rep_name: 'Alex Rep',
    customer_name: 'Erika Mustermann',
    commission_amount_eur: 85,
    signed_at: '2026-07-01T09:00:00Z',
    latest_status: 'signed',
    ...overrides,
  };
}

const mocks = vi.hoisted(() => ({
  deals: { data: undefined as DealRow[] | undefined, isLoading: false, isError: false },
  deliveryStates: {
    data: undefined as Map<string, DeliveryState> | undefined,
    isLoading: false,
    isError: false,
  },
  openDealPdf: vi.fn(async (_contractId: string): Promise<DealPdfStatus> => 'ready'),
}));

vi.mock('./useDeals', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useDeals')>();
  return {
    ...actual,
    useRecentDeals: () => mocks.deals,
    useDeliveryStates: () => mocks.deliveryStates,
    // Delegated, not captured: afterEach swaps `mocks.openDealPdf` for a fresh
    // spy, and a direct reference would keep pointing at the first one.
    openDealPdf: (contractId: string) => mocks.openDealPdf(contractId),
  };
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <DealsPage />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  mocks.deals = { data: undefined, isLoading: false, isError: false };
  mocks.deliveryStates = { data: undefined, isLoading: false, isError: false };
  mocks.openDealPdf = vi.fn(async (_contractId: string): Promise<DealPdfStatus> => 'ready');
});

describe('DealsPage (/abschluesse)', () => {
  it('renders one row per individual closed deal', () => {
    mocks.deals = {
      data: [
        mkDeal({ id: 'k1' }),
        mkDeal({ id: 'k2', deal_reference: 'DEAL-43', customer_name: 'Bruno Berger' }),
      ],
      isLoading: false,
      isError: false,
    };
    renderPage();
    expect(screen.getByText('DEAL-42')).toBeTruthy();
    expect(screen.getByText('Erika Mustermann')).toBeTruthy();
    expect(screen.getAllByText('Alex Rep').length).toBe(2);
    expect(screen.getAllByText('01.07.2026').length).toBe(2);
    expect(screen.getAllByText('Signiert').length).toBe(2);
    expect(screen.getByText('Bruno Berger')).toBeTruthy();
  });

  it('renders an empty state — never a blank table — when the query returns zero rows', () => {
    mocks.deals = { data: [], isLoading: false, isError: false };
    renderPage();
    expect(screen.getByText('Noch keine Abschlüsse')).toBeTruthy();
  });

  it('the per-row document action calls the opener with THAT row contract id', async () => {
    mocks.deals = {
      data: [mkDeal({ id: 'k1' }), mkDeal({ id: 'k2', deal_reference: 'DEAL-43' })],
      isLoading: false,
      isError: false,
    };
    renderPage();
    const buttons = screen.getAllByRole('button', { name: 'Dokument öffnen' });
    fireEvent.click(buttons[1] as HTMLElement);
    await waitFor(() => expect(mocks.openDealPdf).toHaveBeenCalledWith('k2'));
  });

  it('shows the "noch nicht fertig" copy and NOT an error when the opener resolves pending', async () => {
    mocks.deals = { data: [mkDeal({ id: 'k1' })], isLoading: false, isError: false };
    mocks.openDealPdf = vi.fn(async (): Promise<DealPdfStatus> => 'pending');
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Dokument öffnen' }));
    await waitFor(() => expect(screen.getByText('Noch nicht fertig')).toBeTruthy());
    expect(screen.queryByText('Fehlgeschlagen')).toBeNull();
  });

  it('shows the error copy when the opener resolves failed — distinguishable from pending', async () => {
    mocks.deals = { data: [mkDeal({ id: 'k1' })], isLoading: false, isError: false };
    mocks.openDealPdf = vi.fn(async (): Promise<DealPdfStatus> => 'failed');
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Dokument öffnen' }));
    await waitFor(() => expect(screen.getByText('Fehlgeschlagen')).toBeTruthy());
    expect(screen.queryByText('Noch nicht fertig')).toBeNull();
  });

  it('contains no role check of its own — scoping is RLS job (D-3)', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/features/deals/DealsPage.tsx'), 'utf8');
    expect(source).not.toMatch(/role\s*===/);
    expect(source).not.toMatch(/'operator'|"operator"/);
    expect(source).not.toMatch(/'team_lead'|"team_lead"/);
  });
});

/**
 * QUICK-GTI Befund 4 — the Zustellung column.
 *
 * `render_jobs` carries status/attempts/last_error and is deliberately
 * unreachable from any client (0038:79-89), so nothing ever showed the
 * operator whether the document job was still working or dead. An endless
 * "In Arbeit" and a dead_letter looked identical: like nothing.
 */
describe('DealsPage delivery column (QUICK-GTI, Befund 4)', () => {
  function withDelivery(entries: [string, DeliveryState][]) {
    mocks.deliveryStates = { data: new Map(entries), isLoading: false, isError: false };
  }

  it('renders the failure pill with an ICON AND A LABEL, never colour alone', () => {
    mocks.deals = { data: [mkDeal({ id: 'd1' })], isLoading: false, isError: false };
    withDelivery([
      [
        'd1',
        {
          contractId: 'd1',
          status: 'dead_letter',
          attempts: 7,
          lastError: 'no customer email on the contract',
          emailSentAt: null,
        },
      ],
    ]);
    renderPage();

    const pill = screen.getByText('Fehlgeschlagen');
    expect(pill).toBeTruthy();
    // Colour alone is not a state (colourblind-safe): the pill carries an icon.
    expect(pill.closest('span')?.querySelector('svg')).toBeTruthy();
    // The reason is reachable without a second screen.
    expect(pill.closest('span')?.getAttribute('title')).toContain('no customer email');
  });

  it('renders the waiting pill with visibly different copy from the failure', () => {
    mocks.deals = { data: [mkDeal({ id: 'd1' })], isLoading: false, isError: false };
    withDelivery([
      [
        'd1',
        { contractId: 'd1', status: 'pending', attempts: 1, lastError: null, emailSentAt: null },
      ],
    ]);
    renderPage();

    expect(screen.getByText('In Arbeit')).toBeTruthy();
    expect(screen.queryByText('Fehlgeschlagen')).toBeNull();
  });

  it('renders the dash placeholder for a contract with no delivery state, never a guess', () => {
    mocks.deals = { data: [mkDeal({ id: 'd1' })], isLoading: false, isError: false };
    withDelivery([]);
    renderPage();

    expect(screen.queryByText('In Arbeit')).toBeNull();
    expect(screen.queryByText('Fehlgeschlagen')).toBeNull();
    expect(screen.queryByText('Zugestellt')).toBeNull();
  });

  it('does NOT blank the deals table when the delivery query fails', () => {
    // A transport error on a secondary column must not take the screen down.
    mocks.deals = { data: [mkDeal({ id: 'd1' })], isLoading: false, isError: false };
    mocks.deliveryStates = { data: undefined, isLoading: false, isError: true };
    renderPage();

    expect(screen.getByText('Erika Mustermann')).toBeTruthy();
  });

  it('keeps the header and the row on the SAME grid template (7 tracks)', () => {
    mocks.deals = { data: [mkDeal({ id: 'd1' })], isLoading: false, isError: false };
    withDelivery([]);
    const { container } = renderPage();

    const grids = Array.from(container.querySelectorAll('[class*="grid-cols-["]'));
    expect(grids.length).toBeGreaterThanOrEqual(2);
    const templates = new Set(
      grids.map((el) => /grid-cols-\[([^\]]*)\]/.exec(el.className)?.[1] ?? ''),
    );
    // One template, shared: a header and a row on different templates silently
    // misalign every column to the right of the new one.
    expect(templates.size).toBe(1);
    expect([...templates][0]?.split('_')).toHaveLength(7);
  });
});
