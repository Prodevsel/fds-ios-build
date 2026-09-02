import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import i18n from '@/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  derivePasswordHint,
  performPasswordReset,
  readRecoveryTokenHash,
  ResetPasswordPage,
} from './ResetPasswordPage';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  updateUser: vi.fn(),
  onAuthStateChange: vi.fn(),
  verifyOtp: vi.fn(),
  unsubscribe: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mocks.navigate };
});

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: {
      getSession: mocks.getSession,
      updateUser: mocks.updateUser,
      onAuthStateChange: mocks.onAuthStateChange,
      verifyOtp: mocks.verifyOtp,
    },
  }),
}));

afterEach(() => {
  mocks.getSession.mockReset();
  mocks.updateUser.mockReset();
  mocks.onAuthStateChange.mockReset();
  mocks.verifyOtp.mockReset();
  mocks.unsubscribe.mockReset();
  mocks.navigate.mockReset();
  mocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: mocks.unsubscribe } } });
});

function renderPage(path = '/reset-password') {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <ResetPasswordPage />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('derivePasswordHint', () => {
  it('reports tooShort with the correct remaining count under 12 characters', () => {
    expect(derivePasswordHint('short')).toEqual({ tooShort: true, remaining: 7 });
  });

  it('reports NOT tooShort at exactly 12 characters', () => {
    expect(derivePasswordHint('123456789012')).toEqual({ tooShort: false, remaining: 0 });
  });
});

describe('readRecoveryTokenHash', () => {
  it('extracts the token_hash the auth-email hook actually emits', () => {
    expect(readRecoveryTokenHash('?token_hash=pkce_abc123&type=recovery')).toBe('pkce_abc123');
  });

  it('returns null when there is no token in the query string', () => {
    expect(readRecoveryTokenHash('')).toBeNull();
    expect(readRecoveryTokenHash('?type=recovery')).toBeNull();
    expect(readRecoveryTokenHash('?token_hash=')).toBeNull();
  });
});

describe('performPasswordReset', () => {
  it('returns success when updateUser resolves without error', async () => {
    const auth = { updateUser: vi.fn().mockResolvedValue({ error: null }) };
    const result = await performPasswordReset({ auth, password: 'a-strong-enough-password' });
    expect(result).toEqual({ status: 'success' });
    expect(auth.updateUser).toHaveBeenCalledTimes(1);
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'a-strong-enough-password' });
  });

  it('returns rejected on a server-side rejection', async () => {
    const auth = { updateUser: vi.fn().mockResolvedValue({ error: { message: 'Password too weak' } }) };
    const result = await performPasswordReset({ auth, password: 'weak' });
    expect(result).toEqual({ status: 'rejected' });
  });

  it('returns error when the call throws', async () => {
    const auth = { updateUser: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) };
    const result = await performPasswordReset({ auth, password: 'whatever12345' });
    expect(result).toEqual({ status: 'error' });
  });
});

describe('ResetPasswordPage behaviour', () => {
  it('shows the always-visible password hint before typing and before submit (D-10)', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    renderPage();
    await waitFor(() => expect(screen.getByText('Mindestens 12 Zeichen.')).toBeTruthy());
  });

  it('shows the too-short countdown with correct remaining count while focused and under 12 chars', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    renderPage();
    const input = await screen.findByLabelText('Passwort');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'abcde' } });
    await waitFor(() => expect(screen.getByText('Noch 7 Zeichen bis zur Mindestlänge.')).toBeTruthy());
  });

  it('calls updateUser once and blocks double-submit', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    let resolveCall: (value: { error: null }) => void = () => {};
    mocks.updateUser.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCall = resolve;
      }),
    );
    renderPage();
    const input = await screen.findByLabelText('Passwort');
    fireEvent.change(input, { target: { value: 'a-strong-enough-password' } });
    const button = screen.getByRole('button', { name: 'Neues Passwort speichern' });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    resolveCall({ error: null });
    await waitFor(() => expect(mocks.updateUser).toHaveBeenCalledTimes(1));
  });

  it('renders passwordPolicy.rejectedByServer on a server rejection, never a bare "invalid password"', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    mocks.updateUser.mockResolvedValueOnce({ error: { message: 'weak' } });
    renderPage();
    const input = await screen.findByLabelText('Passwort');
    fireEvent.change(input, { target: { value: 'a-strong-enough-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Neues Passwort speichern' }));
    await waitFor(() =>
      expect(
        screen.getByText(
          'Das Passwort erfüllt die Anforderungen nicht (mindestens 12 Zeichen, keine zu häufig verwendeten Passwörter). Bitte ein anderes Passwort wählen.',
        ),
      ).toBeTruthy(),
    );
  });

  it('renders resetComplete.linkExpired WITH a link back to the request page when no recovery session exists', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    renderPage();
    await waitFor(() =>
      expect(
        screen.getByText('Dieser Link ist abgelaufen oder wurde bereits verwendet. Fordere einen neuen Link an.'),
      ).toBeTruthy(),
    );
    const link = screen.getByRole('link', { name: 'Passwort zurücksetzen' });
    expect(link.getAttribute('href')).toBe('/reset-password-request');
  });

  it('navigates with replace: true on success', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    mocks.updateUser.mockResolvedValueOnce({ error: null });
    renderPage();
    const input = await screen.findByLabelText('Passwort');
    fireEvent.change(input, { target: { value: 'a-strong-enough-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Neues Passwort speichern' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true }));
  });

  it('clears the address bar after the recovery session is established', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');
    renderPage();
    await screen.findByLabelText('Passwort');
    expect(replaceStateSpy).toHaveBeenCalledWith(null, '', window.location.pathname);
    replaceStateSpy.mockRestore();
  });

  // REGRESSION (14-REVIEW CR-02): the auth-email hook emits
  // `?token_hash=…&type=recovery`, a shape supabase-js's detectSessionInUrl
  // does not recognize (it handles an implicit-grant fragment or a PKCE
  // `?code=` only). Waiting on getSession()/PASSWORD_RECOVERY alone meant every
  // valid emailed link showed "Link abgelaufen" and admin reset never worked.
  it('consumes the emailed token_hash via verifyOtp and shows the form (14-REVIEW CR-02)', async () => {
    mocks.verifyOtp.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null });
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    renderPage('/reset-password?token_hash=pkce_abc123&type=recovery');

    await screen.findByLabelText('Passwort');
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: 'pkce_abc123', type: 'recovery' });
    expect(
      screen.queryByText('Dieser Link ist abgelaufen oder wurde bereits verwendet. Fordere einen neuen Link an.'),
    ).toBeNull();
  });

  it('clears the address bar once the emailed token_hash has been verified', async () => {
    mocks.verifyOtp.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null });
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');
    renderPage('/reset-password?token_hash=pkce_abc123&type=recovery');

    await screen.findByLabelText('Passwort');
    expect(replaceStateSpy).toHaveBeenCalledWith(null, '', window.location.pathname);
    replaceStateSpy.mockRestore();
  });

  it('shows resetComplete.linkExpired when verifyOtp rejects an already-used or expired token', async () => {
    mocks.verifyOtp.mockResolvedValue({ data: null, error: { message: 'Token has expired or is invalid' } });
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    renderPage('/reset-password?token_hash=stale_token&type=recovery');

    await waitFor(() =>
      expect(
        screen.getByText('Dieser Link ist abgelaufen oder wurde bereits verwendet. Fordere einen neuen Link an.'),
      ).toBeTruthy(),
    );
  });

  it('never calls verifyOtp when the landing carries no token_hash', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    renderPage();

    await screen.findByLabelText('Passwort');
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it('contains no manual URL-fragment parsing', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/features/auth/ResetPasswordPage.tsx'), 'utf-8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/location\.hash/i);
    expect(code).not.toMatch(/substring\(1\)/i);
    expect(code).not.toMatch(/URLSearchParams\(window\.location\.hash\)/i);
  });
});
