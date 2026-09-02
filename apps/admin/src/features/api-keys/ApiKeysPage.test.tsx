import i18n from '@/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiKeysPage } from './ApiKeysPage';
import type { ApiKey, OperatorApiKey, OperatorApiKeyStats } from './useApiKeys';

// Drive the data layer directly so the page's state rendering is asserted in
// isolation (no Supabase/network). The reveal + deactivate paths only touch
// Supabase on submit, so rendering needs no mock beyond the queries.
const mocks = vi.hoisted(() => ({
  keys: { data: undefined as ApiKey[] | undefined, isLoading: false, isError: false },
  operatorKeys: {
    data: undefined as OperatorApiKey[] | undefined,
    isLoading: false,
    isError: false,
  },
  operatorStats: { data: undefined as OperatorApiKeyStats | undefined },
  companies: {
    data: [{ id: 'c1', name: 'Acme GmbH', onboarding_status: 'active', wizard_step: null }],
  },
}));

vi.mock('./useApiKeys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useApiKeys')>();
  return {
    ...actual,
    useApiKeys: () => mocks.keys,
    useOperatorApiKeys: () => mocks.operatorKeys,
    useOperatorApiKeyStats: () => mocks.operatorStats,
    useDeactivateApiKey: () => ({ mutate: vi.fn(), isPending: false }),
    useIssueApiKey: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false }),
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
          <ApiKeysPage />
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
  mocks.keys = { data: undefined, isLoading: false, isError: false };
  mocks.operatorKeys = { data: undefined, isLoading: false, isError: false };
  mocks.operatorStats = { data: undefined };
});

describe('ApiKeysPage (API-01)', () => {
  it('prompts to pick a company before any key is shown', () => {
    renderPage();
    expect(screen.getByText('Unternehmen auswählen')).toBeTruthy();
  });

  it('renders each key as a masked sk_••••1a2f chip with an icon+label status badge', () => {
    mocks.keys = {
      data: [
        {
          id: 'k1',
          key_prefix: '1a2f',
          label: 'Produktion',
          status: 'active',
          created_at: '2026-07-01T00:00:00Z',
          revoked_at: null,
        },
      ],
      isLoading: false,
      isError: false,
    };
    renderPage();
    selectCompany();
    // Masked prefix only — never a plaintext key.
    expect(screen.getByText('sk_••••1a2f')).toBeTruthy();
    expect(screen.getByText('Aktiv')).toBeTruthy();
    expect(screen.getByText('Produktion')).toBeTruthy();
  });

  it('disables "API-Schlüssel erstellen" once 2 keys are active (max-2 cap)', () => {
    mocks.keys = {
      data: [
        { id: 'k1', key_prefix: 'aaaa', label: null, status: 'active', created_at: '2026-07-01T00:00:00Z', revoked_at: null },
        { id: 'k2', key_prefix: 'bbbb', label: null, status: 'active', created_at: '2026-07-02T00:00:00Z', revoked_at: null },
      ],
      isLoading: false,
      isError: false,
    };
    renderPage();
    selectCompany();
    const cta = screen.getByRole('button', { name: 'API-Schlüssel erstellen' });
    expect((cta as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the empty state when a company has no keys', () => {
    mocks.keys = { data: [], isLoading: false, isError: false };
    renderPage();
    selectCompany();
    expect(screen.getByText('Noch keine Schlüssel')).toBeTruthy();
  });

  it('operator mode shows the cross-company list, Unternehmen column + stat cards', () => {
    mocks.operatorKeys = {
      data: [
        {
          id: 'k1',
          company_id: 'c1',
          company_name: 'Acme GmbH',
          key_prefix: '1a2f',
          label: 'Prod',
          status: 'active',
          created_at: '2026-07-01T00:00:00Z',
          revoked_at: null,
        },
      ],
      isLoading: false,
      isError: false,
    };
    mocks.operatorStats = {
      data: { activeCount: 3, companiesCovered: 2, revokedCount: 1 },
    };
    renderPage();
    selectAllCompanies();
    // Stat cards.
    expect(screen.getByText('Abgedeckt')).toBeTruthy();
    // Unternehmen column value (also a select option) + masked prefix (never plaintext).
    expect(screen.getAllByText('Acme GmbH').length).toBeGreaterThan(1);
    expect(screen.getByText('sk_••••1a2f')).toBeTruthy();
    // Creation is per-company only → disabled in operator mode.
    const cta = screen.getByRole('button', { name: 'API-Schlüssel erstellen' });
    expect((cta as HTMLButtonElement).disabled).toBe(true);
  });
});
