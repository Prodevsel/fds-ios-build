import i18n from '@/i18n';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverviewPage } from './OverviewPage';
import type { OverviewData } from './useOverview';

// Drive the data + session layers directly so the page's state rendering
// (loading / empty / populated) is asserted in isolation — no Supabase/network.
const mocks = vi.hoisted(() => ({
  overview: {
    data: undefined as OverviewData | undefined,
    isLoading: false,
    isError: false,
  },
  session: {
    session: { user: { email: 'operator@fixture.test' } },
    role: 'operator' as const,
    loading: false,
  },
}));

vi.mock('./useOverview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useOverview')>();
  return { ...actual, useOverview: () => mocks.overview };
});

vi.mock('@/lib/auth/useSession', () => ({ useSession: () => mocks.session }));

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

const NOW = Date.now();

const POPULATED: OverviewData = {
  companies: [
    {
      id: 'c1',
      name: 'Nordlicht Vertrieb',
      onboarding_status: 'active',
      created_at: new Date(NOW - 3600_000).toISOString(),
    },
    {
      id: 'c2',
      name: 'Rheinland Direkt',
      onboarding_status: 'onboarding',
      created_at: new Date(NOW - 7200_000).toISOString(),
    },
    {
      id: 'c3',
      name: 'Südwest Glasfaser',
      onboarding_status: 'draft',
      created_at: new Date(NOW - 10800_000).toISOString(),
    },
  ],
  events: [
    {
      id: 'ev1',
      company_id: 'c1',
      event_type: 'signed',
      occurred_at: new Date(NOW - 300_000).toISOString(),
    },
    {
      id: 'ev2',
      company_id: 'c2',
      event_type: 'cancelled',
      occurred_at: new Date(NOW - 1200_000).toISOString(),
    },
  ],
  previousSignedCount: 1,
  contractCompanyIds: ['c1', 'c1', 'c2'],
  commissionConfirmedEur: 2480,
  commissionPendingEur: 320,
  webhookDeliveryRate: 0.972,
};

afterEach(() => {
  mocks.overview = { data: undefined, isLoading: false, isError: false };
});

describe('OverviewPage (Übersicht 1:1)', () => {
  it('renders a loading skeleton (no dashboard) while loading', () => {
    mocks.overview = { data: undefined, isLoading: true, isError: false };
    renderPage();
    expect(screen.queryByText('Unterschriebene Verträge')).toBeNull();
    expect(screen.queryByText('Noch keine Unternehmen')).toBeNull();
  });

  it('renders the empty-companies state with a primary CTA to /unternehmen', () => {
    mocks.overview = {
      data: {
        companies: [],
        events: [],
        previousSignedCount: 0,
        contractCompanyIds: [],
        commissionConfirmedEur: 0,
        commissionPendingEur: 0,
        webhookDeliveryRate: null,
      },
      isLoading: false,
      isError: false,
    };
    renderPage();
    expect(screen.getByText('Noch keine Unternehmen')).toBeTruthy();
    const cta = screen.getByRole('link', { name: 'Unternehmen anlegen' });
    expect(cta.getAttribute('href')).toBe('/unternehmen');
  });

  it('renders an error state when the query fails', () => {
    mocks.overview = { data: undefined, isLoading: false, isError: true };
    renderPage();
    expect(screen.getByText('Daten konnten nicht geladen werden')).toBeTruthy();
  });

  it('renders KPI tiles, trend, funnel, team bars and activity from live data', () => {
    mocks.overview = { data: POPULATED, isLoading: false, isError: false };
    renderPage();
    // KPI labels.
    expect(screen.getByText('Unterschr. Verträge')).toBeTruthy();
    expect(screen.getByText('Aktive Unternehmen')).toBeTruthy();
    expect(screen.getByText('Provision (MTD)')).toBeTruthy();
    expect(screen.getByText('Webhook-Zustellrate')).toBeTruthy();
    // Trend + team + activity regions.
    expect(screen.getByText('Unterschriebene Verträge')).toBeTruthy();
    expect(screen.getByText('Verträge nach Unternehmen')).toBeTruthy();
    expect(screen.getByText('Nordlicht Vertrieb')).toBeTruthy();
    // Activity feed reflects the signed + cancelled events.
    expect(screen.getByText('Vertrag von Nordlicht Vertrieb unterschrieben')).toBeTruthy();
    expect(screen.getByText('Vertrag von Rheinland Direkt storniert')).toBeTruthy();
  });

  it('wires Provision (MTD) + Webhook-Zustellrate from the commission/webhook views', () => {
    mocks.overview = { data: POPULATED, isLoading: false, isError: false };
    renderPage();
    // confirmed commission headline + pending secondary note (0053).
    expect(screen.getByText('2.480 €')).toBeTruthy();
    expect(screen.getByText('davon 320 € in Widerrufsfrist')).toBeTruthy();
    // webhook delivery rate (0056).
    expect(screen.getByText('97,2 %')).toBeTruthy();
  });

  it('keeps an honest "—" for the webhook rate when there are no webhook events', () => {
    mocks.overview = {
      data: { ...POPULATED, webhookDeliveryRate: null },
      isLoading: false,
      isError: false,
    };
    renderPage();
    expect(screen.getByText('Webhook-Zustellrate')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });
});
