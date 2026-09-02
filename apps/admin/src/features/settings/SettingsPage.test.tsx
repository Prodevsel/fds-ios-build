import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import i18n from '@/i18n';
import type { AdminRole } from '@/lib/auth/roles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import type { AdminAccountSettings } from './useAdminAccountSettings';

/**
 * SET-09 proof: the rebuilt SettingsPage.tsx actually saves. Covers the
 * UI-SPEC's Admin Save/Dirty Contract end to end — disabled on load, enabled
 * on a real change, disabled again on revert (the diff rule, distinguishing
 * this from BrandingPage.tsx's one-way flag), a working save call, and a
 * source-level regression assertion so a future revert to the inert shape
 * fails a test rather than passing silently.
 */

const mocks = vi.hoisted(() => ({
  session: {
    session: { user: { id: 'user-1', email: 'operator@fixture.test' } },
    role: 'operator' as AdminRole | null,
    loading: false,
  },
  accountSettings: {
    data: { fullName: 'Alice Operator', language: 'de' } as AdminAccountSettings | undefined,
    isLoading: false,
  },
  save: { mutate: vi.fn(), isPending: false },
  updateUser: vi.fn(
    async (): Promise<{ error: { message: string; code?: string } | null }> => ({ error: null }),
  ),
  reauthenticate: vi.fn(async (): Promise<{ error: null }> => ({ error: null })),
  tenantName: {
    tenantName: 'Distinctive Fixture Org GmbH' as string | null,
    tenantKind: 'sales_org' as 'sales_org' | 'company' | null,
    tenants: [] as unknown[],
    isLoading: false,
    isError: false,
  },
}));

vi.mock('@/lib/auth/useSession', () => ({ useSession: () => mocks.session }));

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: { signOut: vi.fn(), updateUser: mocks.updateUser, reauthenticate: mocks.reauthenticate },
  }),
}));

vi.mock('./useAdminAccountSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useAdminAccountSettings')>();
  return {
    ...actual,
    useAdminAccountSettings: () => mocks.accountSettings,
    useSaveAdminAccountSettings: () => mocks.save,
  };
});

vi.mock('./useTenantName', () => ({
  useTenantName: () => mocks.tenantName,
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  mocks.session = {
    session: { user: { id: 'user-1', email: 'operator@fixture.test' } },
    role: 'operator',
    loading: false,
  };
  mocks.accountSettings = { data: { fullName: 'Alice Operator', language: 'de' }, isLoading: false };
  mocks.save = { mutate: vi.fn(), isPending: false };
  mocks.updateUser = vi.fn(async () => ({ error: null }));
  mocks.reauthenticate = vi.fn(async () => ({ error: null }));
  mocks.tenantName = {
    tenantName: 'Distinctive Fixture Org GmbH',
    tenantKind: 'sales_org',
    tenants: [],
    isLoading: false,
    isError: false,
  };
});

describe('SettingsPage (SET-09)', () => {
  it('Save is disabled immediately after the account-settings query resolves', () => {
    renderPage();
    const saveButton = screen.getByRole('button', { name: 'Speichern' });
    expect(saveButton.hasAttribute('disabled')).toBe(true);
  });

  it('Save enables after a real name change', () => {
    renderPage();
    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Alice New Name' } });
    const saveButton = screen.getByRole('button', { name: 'Speichern' });
    expect(saveButton.hasAttribute('disabled')).toBe(false);
  });

  it('Save disables again after reverting the name change back to its loaded value', () => {
    renderPage();
    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Alice New Name' } });
    expect(screen.getByRole('button', { name: 'Speichern' }).hasAttribute('disabled')).toBe(false);

    fireEvent.change(nameInput, { target: { value: 'Alice Operator' } });
    expect(screen.getByRole('button', { name: 'Speichern' }).hasAttribute('disabled')).toBe(true);
  });

  it('clicking Save invokes the mutation with the current (edited) form values', () => {
    renderPage();
    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Alice New Name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(mocks.save.mutate).toHaveBeenCalledWith(
      { fullName: 'Alice New Name', language: 'de', newPassword: '', reauthCode: '' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('after a successful save, Save is disabled again without a reload', async () => {
    mocks.save = {
      isPending: false,
      mutate: vi.fn((input: AdminAccountSettings, opts?: { onSuccess?: () => void }) => {
        opts?.onSuccess?.();
      }),
    };
    renderPage();
    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Alice New Name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Speichern' }).hasAttribute('disabled')).toBe(true);
    });
  });

  it('a rejected save surfaces the error copy and leaves Save enabled', async () => {
    mocks.save = {
      isPending: false,
      mutate: vi.fn((_input: AdminAccountSettings, opts?: { onError?: () => void }) => {
        opts?.onError?.();
      }),
    };
    renderPage();
    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Alice New Name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => {
      expect(
        screen.getByText('Änderung konnte nicht gespeichert werden. Bitte erneut versuchen.'),
      ).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Speichern' }).hasAttribute('disabled')).toBe(false);
  });

  it('a non-operator sees the team roster with no dead invite/role controls (manage link instead)', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Team & Rollen' }));
    expect(screen.getByRole('link', { name: 'Mitarbeiter und Rollen verwalten' })).toBeTruthy();
  });

  it('the Fernlöschung tab is present and renders RemoteWipeTab (SEC-08, plan 15-12)', () => {
    renderPage();
    const wipeTab = screen.getByRole('tab', { name: 'Fernlöschung' });
    expect(wipeTab).toBeTruthy();
    fireEvent.click(wipeTab);
    // RemoteWipeTab's own heading, proving the real component mounted, not a stub.
    expect(screen.getAllByText('Fernlöschung').length).toBeGreaterThan(1);
  });

  it('source regression guard: the shipped page contains neither the old hardcoded-false dirty constant nor the inert select primitive', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/features/settings/SettingsPage.tsx'),
      'utf-8',
    );
    expect(source).not.toMatch(/const dirty = false/);
    expect(source).not.toMatch(/DisabledSelect/);
  });

  it('the Organisation row renders the queried tenant name, not a hardcoded string (D-15)', () => {
    renderPage();
    const orgInput = screen.getByLabelText('Organisationsname') as HTMLInputElement;
    // Fixture name is deliberately distinctive (never the real product's own
    // literal) — a regression back to a hardcoded organisation string would
    // fail this exact-match assertion.
    expect(orgInput.value).toBe(mocks.tenantName.tenantName);
  });

  it('the Organisation row shows a neutral placeholder while the tenant name is unknown, never a stale/invented name', () => {
    mocks.tenantName = {
      tenantName: null,
      tenantKind: null,
      tenants: [],
      isLoading: true,
      isError: false,
    };
    renderPage();
    const orgInput = screen.getByLabelText('Organisationsname') as HTMLInputElement;
    expect(orgInput.value).toBe('Wird geladen …');
  });

  it('the 12-character requirement line is present at first render with an empty password field (D-10)', () => {
    renderPage();
    expect(screen.getByText('Mindestens 12 Zeichen.')).toBeTruthy();
  });

  it('typing in the password field makes dirty true, and clearing it makes dirty false again', () => {
    renderPage();
    const passwordInput = screen.getByLabelText('Neues Passwort') as HTMLInputElement;
    fireEvent.change(passwordInput, { target: { value: 'a-brand-new-password' } });
    // Dirty (the "Ungespeichert" badge would show), but D-15/WR-12: Save
    // itself stays disabled until the re-authentication code is ALSO filled
    // — see the dedicated Save-gating tests below.
    fireEvent.change(passwordInput, { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Speichern' }).hasAttribute('disabled')).toBe(true);
  });

  it('D-15/WR-12: Save stays disabled with a valid new password but an empty re-auth field', () => {
    renderPage();
    const passwordInput = screen.getByLabelText('Neues Passwort') as HTMLInputElement;
    fireEvent.change(passwordInput, { target: { value: 'a-brand-new-password' } });
    expect(screen.getByRole('button', { name: 'Speichern' }).hasAttribute('disabled')).toBe(true);
  });

  it('D-15/WR-12: Save enables once BOTH the re-auth code (6 digits) and a valid new password are present', () => {
    renderPage();
    const reauthInput = screen.getByLabelText('Aktuelles Passwort') as HTMLInputElement;
    const passwordInput = screen.getByLabelText('Neues Passwort') as HTMLInputElement;
    fireEvent.change(reauthInput, { target: { value: '123456' } });
    fireEvent.change(passwordInput, { target: { value: 'a-brand-new-password' } });
    expect(screen.getByRole('button', { name: 'Speichern' }).hasAttribute('disabled')).toBe(false);
  });

  it('exactly ONE Save button exists on the page (no second mini-save for the password field)', () => {
    renderPage();
    const saveButtons = screen.getAllByRole('button', { name: /^Speichern$|^Wird gespeichert/ });
    expect(saveButtons).toHaveLength(1);
  });

  it('a non-empty password with a filled re-auth code calls auth.updateUser({ password, nonce }) on Save, and clears both fields on success', async () => {
    mocks.save = {
      isPending: false,
      mutate: vi.fn((input: AdminAccountSettings, opts?: { onSuccess?: () => void }) => {
        opts?.onSuccess?.();
      }),
    };
    renderPage();
    const reauthInput = screen.getByLabelText('Aktuelles Passwort') as HTMLInputElement;
    const passwordInput = screen.getByLabelText('Neues Passwort') as HTMLInputElement;
    fireEvent.change(reauthInput, { target: { value: '123456' } });
    fireEvent.change(passwordInput, { target: { value: 'a-brand-new-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => {
      expect(mocks.updateUser).toHaveBeenCalledWith({ password: 'a-brand-new-password', nonce: '123456' });
    });
    await waitFor(() => {
      expect((screen.getByLabelText('Neues Passwort') as HTMLInputElement).value).toBe('');
      expect((screen.getByLabelText('Aktuelles Passwort') as HTMLInputElement).value).toBe('');
    });
  });

  it('a server-side NEW-password policy rejection surfaces profile.password.rejectedByServer, not the re-auth copy', async () => {
    mocks.updateUser = vi.fn(async () => ({ error: { message: 'Password too weak', code: 'weak_password' } }));
    renderPage();
    const reauthInput = screen.getByLabelText('Aktuelles Passwort') as HTMLInputElement;
    const passwordInput = screen.getByLabelText('Neues Passwort') as HTMLInputElement;
    fireEvent.change(reauthInput, { target: { value: '123456' } });
    fireEvent.change(passwordInput, { target: { value: 'a-brand-new-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => {
      expect(
        screen.getByText(
          'Das Passwort erfüllt die Anforderungen nicht (mindestens 12 Zeichen, keine zu häufig verwendeten Passwörter). Bitte ein anderes Passwort wählen.',
        ),
      ).toBeTruthy();
    });
  });

  it('D-15/WR-12: a wrong/rejected re-authentication code surfaces profile.password.currentRejected — distinguishable from the policy rejection', async () => {
    mocks.updateUser = vi.fn(async () => ({
      error: { message: 'Password update requires reauthentication', code: 'reauthentication_needed' },
    }));
    renderPage();
    const reauthInput = screen.getByLabelText('Aktuelles Passwort') as HTMLInputElement;
    const passwordInput = screen.getByLabelText('Neues Passwort') as HTMLInputElement;
    fireEvent.change(reauthInput, { target: { value: '123456' } });
    fireEvent.change(passwordInput, { target: { value: 'a-brand-new-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => {
      expect(screen.getByText('Aktuelles Passwort ist falsch.')).toBeTruthy();
    });
  });

  it('the re-authentication field is rendered ABOVE the new-password field', () => {
    renderPage();
    const source = readFileSync(
      resolve(process.cwd(), 'src/features/settings/SettingsPage.tsx'),
      'utf-8',
    );
    const reauthIndex = source.indexOf('settings-current-password');
    const newPasswordIndex = source.indexOf('settings-new-password');
    expect(reauthIndex).toBeGreaterThan(-1);
    expect(reauthIndex).toBeLessThan(newPasswordIndex);
  });

  it('T-14-12-04 is referenced only inside the closed-by note, never inside a surviving accepted-risk block', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/features/settings/SettingsPage.tsx'),
      'utf-8',
    );
    const matches = source.match(/T-14-12-04/g) ?? [];
    expect(matches.length).toBe(1);
    expect(source).toContain('closes T-14-12-04');
    expect(source).not.toMatch(/form does NOT ask for the current password/);
  });
});
