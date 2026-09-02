import i18n from '@/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CancellationPage } from './CancellationPage';
import type { ContractRow, ContractStatusEvent } from './useCancellation';

/** ContractRow fixture factory — fills the cancellation_contract_detail fields (0055). */
function mkRow(overrides: Partial<ContractRow> & Pick<ContractRow, 'id'>): ContractRow {
  return {
    company_id: 'c1',
    deal_reference: 'DEAL-42',
    company_name: 'Nordlicht Vertrieb',
    product_name: 'glasfaser-1000',
    rep_name: 'Alex Rep',
    customer_name: 'Erika Mustermann',
    commission_amount_eur: 85,
    snapshot_door_price: 499,
    signed_at: '2026-07-01T00:00:00Z',
    withdrawal_deadline: '2026-07-15T00:00:00Z',
    latest_status: 'signed',
    ...overrides,
  };
}

const mocks = vi.hoisted(() => ({
  results: { data: undefined as ContractRow[] | undefined, isLoading: false, isError: false },
  events: { data: [] as ContractStatusEvent[] },
}));

vi.mock('./useCancellation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useCancellation')>();
  return {
    ...actual,
    useContractSearch: () => mocks.results,
    useContractEvents: () => mocks.events,
    useRecordCancellation: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <CancellationPage />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  mocks.results = { data: undefined, isLoading: false, isError: false };
  mocks.events = { data: [] };
});

describe('CancellationPage (D-18)', () => {
  it('prompts to search before any contract is shown', () => {
    renderPage();
    expect(
      screen.getByText('Gib oben eine Deal-Referenz ein, um einen Vertrag zu finden.'),
    ).toBeTruthy();
  });

  it('selecting a contract shows the timeline + a destructive "Widerruf erfassen" action', () => {
    mocks.results = {
      data: [mkRow({ id: 'ct1' })],
      isLoading: false,
      isError: false,
    };
    mocks.events = {
      data: [
        { id: 'ev1', event_type: 'signed', occurred_at: '2026-07-01T00:00:00Z', reason: null },
      ],
    };
    renderPage();
    fireEvent.change(screen.getByLabelText('Vertrag suchen'), { target: { value: 'DEAL' } });
    fireEvent.click(screen.getByRole('button', { name: 'Auswählen' }));
    // Timeline event + record CTA present. Opening the confirm shows the append-only warning.
    expect(screen.getByText('Vertrag signiert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Widerruf erfassen' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Widerruf bestätigen' })).toBeTruthy();
  });

  it('fills Kunde / Unternehmen / Provision / Produkt / Rep / Widerrufsfrist from the detail view', () => {
    mocks.results = { data: [mkRow({ id: 'ct1' })], isLoading: false, isError: false };
    mocks.events = {
      data: [
        { id: 'ev1', event_type: 'signed', occurred_at: '2026-07-01T00:00:00Z', reason: null },
      ],
    };
    renderPage();
    fireEvent.change(screen.getByLabelText('Vertrag suchen'), { target: { value: 'DEAL' } });
    fireEvent.click(screen.getByRole('button', { name: 'Auswählen' }));
    // Detail card meta grid + amount, all from cancellation_contract_detail (0055).
    expect(screen.getAllByText('Erika Mustermann').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Nordlicht Vertrieb').length).toBeGreaterThan(0);
    expect(screen.getByText('glasfaser-1000')).toBeTruthy();
    expect(screen.getByText('Alex Rep')).toBeTruthy();
    expect(screen.getByText('85 €')).toBeTruthy();
    expect(screen.getByText('15.7.2026')).toBeTruthy();
  });

  it('an already-cancelled contract offers NO record action (append-only, no undo)', () => {
    mocks.results = {
      data: [mkRow({ id: 'ct1', latest_status: 'cancelled' })],
      isLoading: false,
      isError: false,
    };
    mocks.events = {
      data: [
        { id: 'ev1', event_type: 'signed', occurred_at: '2026-07-01T00:00:00Z', reason: null },
        {
          id: 'ev2',
          event_type: 'cancelled',
          occurred_at: '2026-07-05T00:00:00Z',
          reason: 'Widerruf',
        },
      ],
    };
    renderPage();
    fireEvent.change(screen.getByLabelText('Vertrag suchen'), { target: { value: 'DEAL' } });
    fireEvent.click(screen.getByRole('button', { name: 'Auswählen' }));
    // Derived status is cancelled; no record button is rendered.
    expect(screen.getByText('Widerrufen')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Widerruf erfassen' })).toBeNull();
  });
});
