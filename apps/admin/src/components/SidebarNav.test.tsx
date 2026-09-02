import i18n from '@/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SidebarNav } from './SidebarNav';

/**
 * SEC-10/D-15: `SidebarNav` now also renders the tenant-name chrome via
 * `useTenantName` (a react-query hook), so every render needs a
 * `QueryClientProvider` plus a fake `useSession`/`getSupabase` — mirroring
 * `SettingsPage.test.tsx`'s mocking shape.
 */

const mocks = vi.hoisted(() => ({
  session: { session: { user: { id: 'user-1', email: 'operator@fixture.test' } }, role: 'operator', loading: false },
}));

vi.mock('@/lib/auth/useSession', () => ({ useSession: () => mocks.session }));
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    rpc: (_fn: string) =>
      Promise.resolve({
        data: [{ tenant_kind: 'sales_org', tenant_id: 'org-1', tenant_name: 'Fixture Org GmbH' }],
        error: null,
      }),
  }),
}));

function renderNav(role: 'operator' | 'team_lead') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <SidebarNav role={role} />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe('SidebarNav role gating (D-01)', () => {
  it('shows a team_lead ONLY their sections + the shared ones', () => {
    renderNav('team_lead');

    // Shared + team_lead sections are visible.
    expect(screen.getByText('Übersicht')).toBeTruthy();
    expect(screen.getByText('Widerruf erfassen')).toBeTruthy();
    expect(screen.getByText('Mitarbeiter')).toBeTruthy();
    expect(screen.getByText('Reporting')).toBeTruthy();
    expect(screen.getByText('Gebiete')).toBeTruthy();

    // Operator-only sections must NOT render (not disabled-but-visible).
    expect(screen.queryByText('Unternehmen')).toBeNull();
    expect(screen.queryByText('API-Schlüssel')).toBeNull();
    expect(screen.queryByText('Webhooks')).toBeNull();
    expect(screen.queryByText('Standard-Branding')).toBeNull();
  });

  it('shows an operator their management sections but not team_lead ones', () => {
    renderNav('operator');

    expect(screen.getByText('Übersicht')).toBeTruthy();
    expect(screen.getByText('Unternehmen')).toBeTruthy();
    expect(screen.getByText('API-Schlüssel')).toBeTruthy();

    // QUICK-GTI: 'Mitarbeiter' is now roles: BOTH. /mitarbeiter is where an
    // operator appoints a team lead (0091), and it was ALWAYS reachable for
    // them — routes are not role-bound and SettingsPage links there via
    // `team.manageLink`. Hiding the nav item was a missing signpost, never a
    // lock, and it hid the one control that grants dashboard access.
    expect(screen.getByText('Mitarbeiter')).toBeTruthy();
    expect(screen.queryByText('Reporting')).toBeNull();
    expect(screen.queryByText('Gebiete')).toBeNull();
  });

  it('shows an operator the Leaderboard-Konfiguration entry (13-07/SC4)', () => {
    renderNav('operator');
    expect(screen.getByText('Leaderboard-Konfiguration')).toBeTruthy();
  });

  it('does NOT show a team_lead the Leaderboard-Konfiguration entry (13-07/D-14)', () => {
    renderNav('team_lead');
    expect(screen.queryByText('Leaderboard-Konfiguration')).toBeNull();
  });
});

describe('SidebarNav tenant chrome (SEC-10/D-15)', () => {
  it('shows the real queried tenant name near the account section, once loaded', async () => {
    renderNav('operator');
    await waitFor(() => {
      expect(screen.getByText('Fixture Org GmbH')).toBeTruthy();
    });
  });
});
