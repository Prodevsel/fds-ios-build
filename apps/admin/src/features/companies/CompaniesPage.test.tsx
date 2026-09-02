import i18n from '@/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompaniesPage } from './CompaniesPage';
import type { Company } from './useCompanies';

/** Company fixture factory — fills the master-data + count fields (0052/0054). */
function mkCompany(overrides: Partial<Company> & Pick<Company, 'id' | 'name'>): Company {
  return {
    onboarding_status: 'draft',
    wizard_step: 0,
    legal_form: null,
    commercial_register_no: null,
    contact_name: null,
    contact_email: null,
    signed_contract_count: 0,
    commission_sum_eur: 0,
    ...overrides,
  };
}

// Drive the data layer directly so the page's state rendering + wizard-resume
// wiring are asserted in isolation (no Supabase/network).
const mocks = vi.hoisted(() => ({
  companies: { data: undefined as Company[] | undefined, isLoading: false, isError: false },
  create: { mutate: vi.fn(), isPending: false },
}));

vi.mock('./useCompanies', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useCompanies')>();
  return {
    ...actual,
    useCompanies: () => mocks.companies,
    useCreateCompany: () => mocks.create,
    useCompanyProducts: () => ({ data: [] }),
    useSaveOnboarding: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useSaveWebhook: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useSaveCommission: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

vi.mock('./useBranding', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useBranding')>();
  return {
    ...actual,
    useBrandingDefault: () => ({ data: undefined }),
    useCompanyBranding: () => ({ data: undefined }),
    useSaveBranding: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false }),
  };
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <CompaniesPage />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  mocks.companies = { data: undefined, isLoading: false, isError: false };
  mocks.create = { mutate: vi.fn(), isPending: false };
});

describe('CompaniesPage (ADMN-02)', () => {
  it('renders the empty state when there are no companies', () => {
    mocks.companies = { data: [], isLoading: false, isError: false };
    renderPage();
    expect(screen.getByText('Noch keine Unternehmen')).toBeTruthy();
  });

  it('renders a loading skeleton (no table) while loading', () => {
    mocks.companies = { data: undefined, isLoading: true, isError: false };
    renderPage();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('Noch keine Unternehmen')).toBeNull();
  });

  it('renders each onboarding_status as a color+icon+label badge (never color alone)', () => {
    mocks.companies = {
      data: [
        mkCompany({ id: 'c1', name: 'Draft Co', onboarding_status: 'draft', wizard_step: 1 }),
        mkCompany({
          id: 'c2',
          name: 'Mid Co',
          onboarding_status: 'onboarding',
          wizard_step: 2,
          signed_contract_count: 7,
        }),
        mkCompany({ id: 'c3', name: 'Live Co', onboarding_status: 'active', wizard_step: null }),
      ],
      isLoading: false,
      isError: false,
    };
    renderPage();
    expect(screen.getByText('Draft Co')).toBeTruthy();
    // German status labels accompany the color (colorblind-safe).
    expect(screen.getByText('Entwurf')).toBeTruthy();
    // 'Onboarding' appears both as the column header and the status pill.
    expect(screen.getAllByText('Onboarding').length).toBeGreaterThan(0);
    expect(screen.getByText('Live')).toBeTruthy();
    // "Verträge" column shows the closed-set signed-contract count (0054), not "—".
    expect(screen.getByText('7')).toBeTruthy();
  });

  it('opens the wizard at the saved step when clicking an Entwurf company row', () => {
    mocks.companies = {
      data: [mkCompany({ id: 'c1', name: 'Draft Co', onboarding_status: 'draft', wizard_step: 2 })],
      isLoading: false,
      isError: false,
    };
    renderPage();
    fireEvent.click(screen.getByText('Draft Co'));
    // Wizard takes over as a full view (not a modal), resumed at step 3 of 5
    // (wizard_step 2, 0-based).
    expect(screen.getByRole('heading', { name: 'Unternehmen anlegen' })).toBeTruthy();
    expect(screen.getByText(/Schritt 3 von 5/)).toBeTruthy();
  });

  it('creates a draft company from the primary CTA', () => {
    mocks.companies = { data: [], isLoading: false, isError: false };
    renderPage();
    // Empty state + header both expose the CTA; the header CTA is first.
    const [primaryCta] = screen.getAllByRole('button', { name: 'Unternehmen anlegen' });
    if (!primaryCta) {
      throw new Error('CTA not rendered');
    }
    fireEvent.click(primaryCta);
    expect(mocks.create.mutate).toHaveBeenCalled();
  });
});
