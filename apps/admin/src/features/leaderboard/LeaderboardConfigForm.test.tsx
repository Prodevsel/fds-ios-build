import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import i18n from '@/i18n';
import type { AdminRole } from '@/lib/auth/roles';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeaderboardConfigForm } from './LeaderboardConfigForm';
import type { LeaderboardConfig } from './useLeaderboardConfig';

/**
 * Verifies the GAMI-02 scope-config form: team scope is the default render,
 * choosing company-wide + saving calls the hook's save with default_scope
 * 'org' (never the reverse — company-wide is an explicit opt-in, D-01), and
 * the write path never issues a merge-style single write (banned ON-CON-FLICT
 * clause) against the force-RLS leaderboard_config table (T-09-07).
 */

const mocks = vi.hoisted(() => ({
  session: {
    session: { user: { id: 'u1', email: 'operator@fixture.test' } },
    role: 'operator' as AdminRole | null,
    loading: false,
  },
  ownSalesOrgId: { data: 'org-1' as string | null },
  config: { data: null as LeaderboardConfig | null, isLoading: false },
  save: { mutate: vi.fn(), isPending: false, isSuccess: false },
}));

vi.mock('@/lib/auth/useSession', () => ({ useSession: () => mocks.session }));

vi.mock('./useLeaderboardConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useLeaderboardConfig')>();
  return {
    ...actual,
    useOwnSalesOrgId: () => mocks.ownSalesOrgId,
    useLeaderboardConfig: () => mocks.config,
    useSaveLeaderboardConfig: () => mocks.save,
  };
});

function renderForm() {
  return render(
    <I18nextProvider i18n={i18n}>
      <LeaderboardConfigForm />
    </I18nextProvider>,
  );
}

afterEach(() => {
  mocks.session = {
    session: { user: { id: 'u1', email: 'operator@fixture.test' } },
    role: 'operator',
    loading: false,
  };
  mocks.ownSalesOrgId = { data: 'org-1' };
  mocks.config = { data: null, isLoading: false };
  mocks.save = { mutate: vi.fn(), isPending: false, isSuccess: false };
});

describe('LeaderboardConfigForm (GAMI-02/D-01)', () => {
  it('defaults to team scope when no config row exists yet', () => {
    mocks.config = { data: null, isLoading: false };
    renderForm();
    const teamRadio = screen.getByRole('radio', { name: 'Nur eigenes Team' }) as HTMLInputElement;
    const orgRadio = screen.getByRole('radio', { name: 'Unternehmensweit' }) as HTMLInputElement;
    expect(teamRadio.checked).toBe(true);
    expect(orgRadio.checked).toBe(false);
  });

  it('choosing company-wide and saving calls save with default_scope=org', () => {
    mocks.config = {
      data: {
        id: 'cfg-1',
        sales_org_id: 'org-1',
        company_id: null,
        default_scope: 'team',
        show_commission_amounts: false,
      },
      isLoading: false,
    };
    renderForm();
    fireEvent.click(screen.getByRole('radio', { name: 'Unternehmensweit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(mocks.save.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        salesOrgId: 'org-1',
        existingId: 'cfg-1',
        defaultScope: 'org',
      }),
    );
  });

  it('never issues a merge-style single write (no ON-CON-FLICT / upsert) against leaderboard_config', () => {
    // Resolved via process.cwd() (not import.meta.url) — jsdom's polyfilled
    // global URL class fails node:fs's file-scheme check on a Vite-transformed
    // module URL, even when the underlying path is a real local file.
    const hookSource = readFileSync(
      resolve(process.cwd(), 'src/features/leaderboard/useLeaderboardConfig.ts'),
      'utf-8',
    );
    expect(hookSource).not.toMatch(/upsert|onConflict/i);
    expect(hookSource).toMatch(/\.update\(|\.insert\(/);
  });

  it('renders a convenience gate (no config controls) for a non-operator role', () => {
    mocks.session = { ...mocks.session, role: 'team_lead' };
    renderForm();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(
      screen.getByText('Nur Organisations-Admins können die Bestenliste konfigurieren.'),
    ).toBeTruthy();
  });
});
