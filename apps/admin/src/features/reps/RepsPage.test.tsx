import i18n from '@/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepsPage } from './RepsPage';
import type { AdministrableTeam, Rep } from './useReps';

// Control the data layer directly so the page's state rendering is asserted in
// isolation (no Supabase/network). The invite dialog only touches Supabase on
// submit, so rendering it closed needs no mock.
const mocks = vi.hoisted(() => ({
  reps: { data: undefined as Rep[] | undefined, isLoading: false, isError: false },
  leadTeamId: { data: '30000000-0000-0000-0000-000000000003' as string | null },
  administrableTeams: {
    data: [] as AdministrableTeam[] | undefined,
    isLoading: false,
  },
  teamCandidates: { data: [] as { id: string; name: string }[] | undefined, isLoading: false },
}));

vi.mock('./useReps', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useReps')>();
  return {
    ...actual,
    useReps: () => mocks.reps,
    useLeadTeamId: () => mocks.leadTeamId,
    useAdministrableTeams: () => mocks.administrableTeams,
    useTeamCandidates: () => mocks.teamCandidates,
  };
});

// The invite dialog is the only Supabase consumer reachable from these tests.
// Spying on `functions.invoke` is what makes "fires NO request" assertable
// rather than merely plausible.
const invokeSpy = vi.fn(() => Promise.resolve({ data: null, error: null }));
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    functions: { invoke: invokeSpy },
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    from: () => {
      const builder: Record<string, unknown> = {
        then: (onFulfilled: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(onFulfilled),
      };
      for (const m of ['select', 'eq', 'order', 'limit', 'not', 'in']) {
        builder[m] = () => builder;
      }
      return builder;
    },
  }),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <RepsPage />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  mocks.reps = { data: undefined, isLoading: false, isError: false };
  mocks.leadTeamId = { data: '30000000-0000-0000-0000-000000000003' };
  mocks.administrableTeams = { data: [], isLoading: false };
  mocks.teamCandidates = { data: [], isLoading: false };
  invokeSpy.mockClear();
});

describe('RepsPage (ADMN-01)', () => {
  it('renders the empty state when the roster has no members', () => {
    mocks.reps = { data: [], isLoading: false, isError: false };
    renderPage();
    expect(screen.getByText('Noch keine Mitarbeiter')).toBeTruthy();
  });

  it('renders a loading skeleton (no table) while loading', () => {
    mocks.reps = { data: undefined, isLoading: true, isError: false };
    renderPage();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('Noch keine Mitarbeiter')).toBeNull();
  });

  it('renders each member with a status badge showing an icon + label (never color alone)', () => {
    mocks.reps = {
      data: [
        { id: 'm1', userId: 'u1', name: 'Alice Rep', role: 'rep', status: 'synced' },
        { id: 'm2', userId: 'u2', name: 'Bob Rep', role: 'rep', status: 'activated' },
        {
          id: 'invited:new@example.com',
          userId: null,
          name: 'new@example.com',
          role: 'rep',
          status: 'invited',
          email: 'new@example.com',
        },
      ],
      isLoading: false,
      isError: false,
    };
    renderPage();
    expect(screen.getByText('Alice Rep')).toBeTruthy();
    // Status labels accompany the color (colorblind-safe) — all three ONBD-02 states.
    expect(screen.getByText('Synchronisiert')).toBeTruthy();
    expect(screen.getByText('Aktiviert')).toBeTruthy();
    expect(screen.getByText('Eingeladen')).toBeTruthy();
    // Role rendered via the reps namespace label, not the raw id.
    expect(screen.getAllByText('Vertriebsmitarbeiter').length).toBeGreaterThan(0);
  });

  it('opens the invite dialog from the primary CTA', () => {
    mocks.reps = { data: [], isLoading: false, isError: false };
    renderPage();
    // CTA present (Mitarbeiter einladen).
    const cta = screen.getByRole('button', { name: 'Mitarbeiter einladen' });
    fireEvent.click(cta);
    // Dialog is now open — its email field label is visible.
    expect(screen.getByLabelText('E-Mail-Adresse')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

/**
 * QUICK-GTI regressions on top of the ADMN-01 harness.
 *
 * These three assertions guard the two halves of Befund 1:
 *  - the team selector and the "Teamleitung festlegen" card exist at all
 *    (`teams.lead_id` is the ONLY source of the dashboard team_lead role —
 *    an invite's role='team_lead' writes a `memberships` row nothing reads);
 *  - an invite with no team resolved must say something TRUE instead of
 *    firing a request that is guaranteed to 400 and then advising a retry.
 */
describe('RepsPage — appointing a lead (QUICK-GTI, Befund 1)', () => {
  it('renders the team selector when more than one sales-org team is administrable', () => {
    mocks.reps = { data: [], isLoading: false, isError: false };
    mocks.administrableTeams = {
      data: [
        { id: 'team-a', name: 'Team Org A', leadId: null },
        { id: 'team-b', name: 'Team Org B', leadId: null },
      ],
      isLoading: false,
    };
    renderPage();
    expect(screen.getByLabelText('Team für Einladungen')).toBeTruthy();
  });

  it('does NOT render the team selector when there is exactly one administrable team', () => {
    mocks.reps = { data: [], isLoading: false, isError: false };
    mocks.administrableTeams = {
      data: [{ id: 'team-a', name: 'Team Org A', leadId: null }],
      isLoading: false,
    };
    renderPage();
    expect(screen.queryByLabelText('Team für Einladungen')).toBeNull();
  });

  it('renders the TeamLeadCard when at least one team is administrable, and hides it when none is', () => {
    mocks.reps = { data: [], isLoading: false, isError: false };
    mocks.administrableTeams = {
      data: [{ id: 'team-a', name: 'Team Org A', leadId: null }],
      isLoading: false,
    };
    const { unmount } = renderPage();
    expect(screen.getByText('Teamleitung festlegen')).toBeTruthy();
    unmount();

    mocks.administrableTeams = { data: [], isLoading: false };
    renderPage();
    expect(screen.queryByText('Teamleitung festlegen')).toBeNull();
  });

  it('submitting the invite with no team resolved sets the noTeam error and fires NO request', () => {
    mocks.reps = { data: [], isLoading: false, isError: false };
    mocks.leadTeamId = { data: null };
    mocks.administrableTeams = { data: [], isLoading: false };
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Mitarbeiter einladen' }));
    fireEvent.change(screen.getByLabelText('E-Mail-Adresse'), {
      target: { value: 'neu@example.de' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Einladung senden' }));

    expect(screen.getByRole('alert').textContent).toContain('Vertriebsteam');
    // The whole point: no request that is guaranteed to 400 is ever sent.
    expect(invokeSpy).not.toHaveBeenCalled();
  });
});
