import i18n from '@/i18n';
import type { Company } from '@/features/companies/useCompanies';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DirectSignTemplatesPage } from './DirectSignTemplatesPage';
import type { DirectSignTemplate } from './useDirectSignTemplates';

const mocks = vi.hoisted(() => ({
  companies: { data: undefined as Company[] | undefined },
  templates: {
    data: undefined as DirectSignTemplate[] | undefined,
    isLoading: false,
    isError: false,
  },
}));

vi.mock('@/features/companies/useCompanies', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/companies/useCompanies')>();
  return {
    ...actual,
    useCompanies: () => mocks.companies,
  };
});

vi.mock('./useDirectSignTemplates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useDirectSignTemplates')>();
  return {
    ...actual,
    useDirectSignTemplates: () => mocks.templates,
  };
});

// PlacementStep pulls in pdfjs-dist, which requires browser-only globals
// (DOMMatrix) unavailable in jsdom at module-import time — stubbed here so
// this page-level test can assert list/selection/publish-form wiring without
// pulling pdfjs-dist into the module graph (the canvas render itself is
// exercised on the manual admin pass, Plan 10-10; PlacementStep's own pure
// coordinate math is unit-tested in PlacementStep.test.tsx/pageFraction.ts).
vi.mock('./PlacementStep', () => ({
  PlacementStep: () => <div data-testid="placement-step-stub" />,
}));

function mkCompany(id: string, name: string): Company {
  return {
    id,
    name,
    onboarding_status: 'active',
    wizard_step: null,
    legal_form: null,
    commercial_register_no: null,
    contact_name: null,
    contact_email: null,
    signed_contract_count: 0,
    commission_sum_eur: 0,
  };
}

function mkTemplate(overrides: Partial<DirectSignTemplate> & Pick<DirectSignTemplate, 'id'>): DirectSignTemplate {
  return {
    companyId: '10000000-0000-0000-0000-000000000001',
    storagePath: '10000000-0000-0000-0000-000000000001/abc.pdf',
    sha256: 'deadbeef',
    signaturePage: null,
    signatureXFrac: null,
    signatureYFrac: null,
    noticeText: null,
    fieldPlacements: [],
    status: 'draft',
    createdAt: '2026-08-04T00:00:00Z',
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <DirectSignTemplatesPage />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  mocks.companies = { data: undefined };
  mocks.templates = { data: undefined, isLoading: false, isError: false };
});

describe('DirectSignTemplatesPage (DSGN-01/02)', () => {
  it('prompts for a company before showing any template list', () => {
    mocks.companies = { data: [mkCompany('c1', 'Firma X')] };
    renderPage();
    expect(screen.getByText('Kein Unternehmen ausgewählt')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('renders the empty state once a company with no templates is selected', () => {
    mocks.companies = { data: [mkCompany('c1', 'Firma X')] };
    mocks.templates = { data: [], isLoading: false, isError: false };
    renderPage();
    fireEvent.change(screen.getByLabelText('Unternehmen'), { target: { value: 'c1' } });
    expect(screen.getByText('Noch keine Vorlagen')).toBeTruthy();
  });

  it('renders each template with a status badge (draft vs published)', () => {
    mocks.companies = { data: [mkCompany('c1', 'Firma X')] };
    mocks.templates = {
      data: [
        mkTemplate({ id: 't1', status: 'draft' }),
        mkTemplate({ id: 't2', status: 'published', storagePath: 'c1/xyz.pdf' }),
      ],
      isLoading: false,
      isError: false,
    };
    renderPage();
    fireEvent.change(screen.getByLabelText('Unternehmen'), { target: { value: 'c1' } });
    expect(screen.getByText('Entwurf')).toBeTruthy();
    expect(screen.getByText('Veröffentlicht')).toBeTruthy();
  });

  it('disables the upload CTA until a company is selected', () => {
    mocks.companies = { data: [mkCompany('c1', 'Firma X')] };
    renderPage();
    const button = screen.getByRole('button', { name: /PDF hochladen/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('selecting a draft row reveals the placement step and the publish form, gated on a placement', () => {
    mocks.companies = { data: [mkCompany('c1', 'Firma X')] };
    mocks.templates = {
      data: [mkTemplate({ id: 't1', status: 'draft' })],
      isLoading: false,
      isError: false,
    };
    renderPage();
    fireEvent.change(screen.getByLabelText('Unternehmen'), { target: { value: 'c1' } });
    fireEvent.click(screen.getByText('abc.pdf'));

    expect(screen.getByTestId('placement-step-stub')).toBeTruthy();
    // No signature anchor yet on this draft row -> publish is gated.
    const publishButton = screen.getByRole('button', { name: 'Veröffentlichen' }) as HTMLButtonElement;
    expect(publishButton.disabled).toBe(true);
  });

  it('enables publish once the selected draft row already carries a signature anchor + a slug is entered', () => {
    mocks.companies = { data: [mkCompany('c1', 'Firma X')] };
    mocks.templates = {
      data: [
        mkTemplate({ id: 't1', status: 'draft', signaturePage: 1, signatureXFrac: 0.5, signatureYFrac: 0.5 }),
      ],
      isLoading: false,
      isError: false,
    };
    renderPage();
    fireEvent.change(screen.getByLabelText('Unternehmen'), { target: { value: 'c1' } });
    fireEvent.click(screen.getByText('abc.pdf'));

    const publishButton = screen.getByRole('button', { name: 'Veröffentlichen' }) as HTMLButtonElement;
    expect(publishButton.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Produkt-Slug'), { target: { value: 'glasfaser-basic' } });
    expect(publishButton.disabled).toBe(false);
  });
});
