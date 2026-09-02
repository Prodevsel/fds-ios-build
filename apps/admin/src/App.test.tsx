import i18n from '@/i18n';
import type { AdminRole } from '@/lib/auth/roles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { LeaderboardConfig } from './features/leaderboard/useLeaderboardConfig';

/**
 * Route-presence smoke test for SC4 (13-07): asserts the leaderboard route is
 * actually registered and mounts LeaderboardConfigForm — the form's own
 * behaviour is covered by LeaderboardConfigForm.test.tsx, this only proves
 * reachability. Would fail before this plan added the <Route> entry (the
 * router would fall through with no matching child route rendered).
 *
 * Also covers 14-11 (T-14-11-06): both new reset routes must render their
 * page WITHOUT a session — a route mis-nested inside the RoleGuard-protected
 * shell would redirect a signed-out operator to /login and make the whole
 * reset flow unreachable (the class of defect Phase 10 shipped once).
 */

const mocks = vi.hoisted(() => ({
  session: {
    session: { user: { id: 'u1', email: 'operator@fixture.test' } } as { user: { id: string; email: string } } | null,
    role: 'operator' as AdminRole | null,
    loading: false,
  },
  ownSalesOrgId: { data: 'org-1' as string | null },
  config: { data: null as LeaderboardConfig | null, isLoading: false },
  save: { mutate: vi.fn(), isPending: false, isSuccess: false },
  getSession: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock('@/lib/auth/useSession', () => ({ useSession: () => mocks.session }));

// The two reset routes call getSupabase().auth on mount (getSession) or on
// submit (resetPasswordForEmail/updateUser) — stubbed so the route-presence
// assertions below don't need real network/env config.
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      resetPasswordForEmail: mocks.resetPasswordForEmail,
      updateUser: mocks.updateUser,
      signInWithPassword: vi.fn(),
    },
  }),
}));

// App.tsx eagerly imports every route, including DirectSignTemplatesPage ->
// PlacementStep, which pulls in pdfjs-dist. pdfjs-dist requires
// browser-only globals (DOMMatrix) unavailable in jsdom at module-import
// time — stubbed here purely so this route-presence smoke test can import
// App.tsx at all (mirrors DirectSignTemplatesPage.test.tsx's own stub).
vi.mock('./features/direct-sign-templates/PlacementStep', () => ({
  PlacementStep: () => <div data-testid="placement-step-stub" />,
}));

vi.mock('./features/leaderboard/useLeaderboardConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./features/leaderboard/useLeaderboardConfig')>();
  return {
    ...actual,
    useOwnSalesOrgId: () => mocks.ownSalesOrgId,
    useLeaderboardConfig: () => mocks.config,
    useSaveLeaderboardConfig: () => mocks.save,
  };
});

afterEach(() => {
  mocks.session = {
    session: { user: { id: 'u1', email: 'operator@fixture.test' } },
    role: 'operator',
    loading: false,
  };
  mocks.ownSalesOrgId = { data: 'org-1' };
  mocks.config = { data: null, isLoading: false };
  mocks.save = { mutate: vi.fn(), isPending: false, isSuccess: false };
  mocks.getSession.mockReset();
  mocks.resetPasswordForEmail.mockReset();
  mocks.updateUser.mockReset();
});

function renderAppAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe('App routing (SC4/13-07)', () => {
  it('mounts LeaderboardConfigForm at /leaderboard-konfiguration', () => {
    renderAppAt('/leaderboard-konfiguration');
    // Only LeaderboardConfigForm renders this heading/radio copy.
    expect(screen.getByText('Bestenliste')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Nur eigenes Team' })).toBeTruthy();
  });
});

describe('App routing (14-11, T-14-11-06 — unauthenticated reset routes)', () => {
  it('mounts ResetPasswordRequestPage at /reset-password-request WITHOUT a session', () => {
    mocks.session = { session: null, role: null, loading: false };
    renderAppAt('/reset-password-request');
    expect(screen.getByRole('button', { name: 'Link senden' })).toBeTruthy();
  });

  it('mounts ResetPasswordPage at /reset-password WITHOUT a session', async () => {
    mocks.session = { session: null, role: null, loading: false };
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    renderAppAt('/reset-password');
    await waitFor(() =>
      expect(
        screen.getByText('Dieser Link ist abgelaufen oder wurde bereits verwendet. Fordere einen neuen Link an.'),
      ).toBeTruthy(),
    );
  });
});
