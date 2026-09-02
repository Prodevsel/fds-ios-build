import i18n from '@/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebhooksPage } from './WebhooksPage';
import type {
  OperatorWebhookEndpoint,
  OperatorWebhookEvent,
  WebhookEvent,
} from './useWebhooks';

const mocks = vi.hoisted(() => ({
  config: { data: null as { id: string; target_url: string; active: boolean } | null },
  events: { data: undefined as WebhookEvent[] | undefined, isLoading: false, isError: false },
  operatorEndpoints: {
    data: undefined as OperatorWebhookEndpoint[] | undefined,
    isLoading: false,
    isError: false,
  },
  operatorEvents: {
    data: undefined as OperatorWebhookEvent[] | undefined,
    isLoading: false,
    isError: false,
  },
  companies: {
    data: [{ id: 'c1', name: 'Acme GmbH', onboarding_status: 'active', wizard_step: null }],
  },
}));

vi.mock('./useWebhooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useWebhooks')>();
  return {
    ...actual,
    useWebhookConfig: () => mocks.config,
    useWebhookEvents: () => mocks.events,
    useOperatorWebhookEndpoints: () => mocks.operatorEndpoints,
    useOperatorWebhookEvents: () => mocks.operatorEvents,
    useSaveWebhookConfig: () => ({ mutate: vi.fn(), isPending: false }),
    useTestPing: () => ({ mutate: vi.fn(), isPending: false }),
    useRedeliver: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

vi.mock('@/features/companies/useCompanies', () => ({
  useCompanies: () => mocks.companies,
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <WebhooksPage />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

function selectCompany() {
  fireEvent.change(screen.getByLabelText('Unternehmen'), { target: { value: 'c1' } });
}

function selectAllCompanies() {
  fireEvent.change(screen.getByLabelText('Unternehmen'), { target: { value: '__all__' } });
}

afterEach(() => {
  mocks.config = { data: null };
  mocks.events = { data: undefined, isLoading: false, isError: false };
  mocks.operatorEndpoints = { data: undefined, isLoading: false, isError: false };
  mocks.operatorEvents = { data: undefined, isLoading: false, isError: false };
});

describe('WebhooksPage (API-02)', () => {
  it('prompts to pick a company before showing tabs', () => {
    renderPage();
    expect(screen.getByText('Unternehmen auswählen')).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('shows the Konfiguration + Event-Log tabs once a company is selected', () => {
    renderPage();
    selectCompany();
    expect(screen.getByRole('tab', { name: 'Konfiguration' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Event-Log' })).toBeTruthy();
    // Config tab is the default panel: the target-URL field is visible.
    expect(screen.getByLabelText('Ziel-URL')).toBeTruthy();
  });

  it('renders the event log with a dead_letter row exposing the retry ladder + redelivery on expand', () => {
    mocks.events = {
      data: [
        {
          id: 'e1',
          event_id: '11111111-1111-1111-1111-111111111111',
          event_type: 'contract.signed',
          resource_id: null,
          payload: { hello: 'world' },
          status: 'dead_letter',
          attempts: 3,
          last_error: 'HTTP 500',
          created_at: '2026-07-01T00:00:00Z',
          delivered_at: null,
        },
      ],
      isLoading: false,
      isError: false,
    };
    renderPage();
    selectCompany();
    fireEvent.click(screen.getByRole('tab', { name: 'Event-Log' }));
    // dead_letter status badge label present (icon+label, never color alone).
    expect(screen.getByText('Fehlgeschlagen')).toBeTruthy();
    // Expand the row → drawer shows the event id chip + redelivery action.
    fireEvent.click(screen.getByRole('button', { name: 'Details anzeigen' }));
    expect(screen.getByText('11111111-1111-1111-1111-111111111111')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Erneut zustellen' })).toBeTruthy();
    // Retry ladder rungs are rendered.
    expect(screen.getByText('30 Min')).toBeTruthy();
  });

  it('operator mode exposes the Endpoints table + global Event-Log with Unternehmen', () => {
    mocks.operatorEndpoints = {
      data: [
        {
          company_id: 'c1',
          company_name: 'Acme GmbH',
          target_url: 'https://api.acme.de/hook',
          active: true,
          delivered_count: 10,
          pending_count: 1,
          dead_letter_count: 2,
          total_count: 13,
        },
      ],
      isLoading: false,
      isError: false,
    };
    mocks.operatorEvents = {
      data: [
        {
          id: 'e1',
          company_id: 'c1',
          company_name: 'Acme GmbH',
          event_type: 'contract.signed',
          status: 'dead_letter',
          attempts: 3,
          last_error: 'HTTP 500',
          delivered_at: null,
          created_at: '2026-07-01T00:00:00Z',
        },
      ],
      isLoading: false,
      isError: false,
    };
    renderPage();
    selectAllCompanies();
    // Operator tabs replace the per-company Konfiguration tab.
    expect(screen.getByRole('tab', { name: 'Endpoints' })).toBeTruthy();
    // Endpoints table shows the company (also a select option) + target URL.
    expect(screen.getAllByText('Acme GmbH').length).toBeGreaterThan(1);
    expect(screen.getByText('https://api.acme.de/hook')).toBeTruthy();
    // Global Event-Log tab: cross-company events + a dead_letter redelivery action.
    fireEvent.click(screen.getByRole('tab', { name: 'Event-Log' }));
    expect(screen.getByText('contract.signed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Erneut zustellen' })).toBeTruthy();
  });
});
