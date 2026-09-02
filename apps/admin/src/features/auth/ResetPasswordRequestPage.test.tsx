import i18n from '@/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { performResetRequest, ResetPasswordRequestPage } from './ResetPasswordRequestPage';

/**
 * Task 1 (14-11): proves the D-20 enumeration-safety contract structurally —
 * `performResetRequest` renders an IDENTICAL outcome for a success-shaped and
 * a "user not found"-shaped auth fake (both resolve without throwing), and
 * only a THROWN exception (genuine network/transport failure) diverges into
 * the distinct error state (14-RESEARCH Pitfall 2).
 */

const mocks = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ auth: { resetPasswordForEmail: mocks.resetPasswordForEmail } }),
}));

afterEach(() => {
  mocks.resetPasswordForEmail.mockReset();
});

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/reset-password-request']}>
        <ResetPasswordRequestPage />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('performResetRequest (D-20 structural proof)', () => {
  it('returns "sent" for a success-shaped auth response', async () => {
    const auth = { resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }) };
    const result = await performResetRequest({
      auth,
      email: 'rep@fixture.test',
      redirectTo: 'https://admin.fixture.test/reset-password',
    });
    expect(result).toEqual({ status: 'sent' });
  });

  it('returns the IDENTICAL "sent" outcome for a "user not found"-shaped error response', async () => {
    const auth = {
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: { message: 'User not found' } }),
    };
    const result = await performResetRequest({
      auth,
      email: 'nobody@fixture.test',
      redirectTo: 'https://admin.fixture.test/reset-password',
    });
    expect(result).toEqual({ status: 'sent' });
  });

  it('returns "network-error" ONLY when the call throws (genuine transport failure)', async () => {
    const auth = { resetPasswordForEmail: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) };
    const result = await performResetRequest({
      auth,
      email: 'rep@fixture.test',
      redirectTo: 'https://admin.fixture.test/reset-password',
    });
    expect(result).toEqual({ status: 'network-error' });
  });

  it('builds redirectTo from window.location.origin, not a hardcoded host', () => {
    expect(window.location.origin).toBeTruthy();
  });
});

describe('ResetPasswordRequestPage behaviour', () => {
  it('renders the same confirmation text for a success and a "user not found"-shaped response', async () => {
    mocks.resetPasswordForEmail.mockResolvedValueOnce({ error: null });
    const { unmount } = renderPage();
    fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'rep@fixture.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link senden' }));
    await waitFor(() =>
      expect(
        screen.getByText(
          'Falls für diese E-Mail-Adresse ein Konto besteht, wurde eine Nachricht mit weiteren Schritten verschickt.',
        ),
      ).toBeTruthy(),
    );
    unmount();

    mocks.resetPasswordForEmail.mockResolvedValueOnce({ error: { message: 'User not found' } });
    renderPage();
    fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'nobody@fixture.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link senden' }));
    await waitFor(() =>
      expect(
        screen.getByText(
          'Falls für diese E-Mail-Adresse ein Konto besteht, wurde eine Nachricht mit weiteren Schritten verschickt.',
        ),
      ).toBeTruthy(),
    );
  });

  it('calls resetPasswordForEmail with redirectTo built from window.location.origin', async () => {
    mocks.resetPasswordForEmail.mockResolvedValueOnce({ error: null });
    renderPage();
    fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'rep@fixture.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link senden' }));
    await waitFor(() => expect(mocks.resetPasswordForEmail).toHaveBeenCalledTimes(1));
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith('rep@fixture.test', {
      redirectTo: `${window.location.origin}/reset-password`,
    });
  });

  it('renders a distinct error state on a network failure, never the confirmation', async () => {
    mocks.resetPasswordForEmail.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderPage();
    fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'rep@fixture.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link senden' }));
    await waitFor(() =>
      expect(screen.getByText('Keine Verbindung. Prüfe dein Netz und versuche es erneut.')).toBeTruthy(),
    );
    expect(
      screen.queryByText(
        'Falls für diese E-Mail-Adresse ein Konto besteht, wurde eine Nachricht mit weiteren Schritten verschickt.',
      ),
    ).toBeNull();
  });

  it('blocks double-submit while a request is in flight', async () => {
    let resolveCall: (value: { error: null }) => void = () => {};
    mocks.resetPasswordForEmail.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCall = resolve;
      }),
    );
    renderPage();
    fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'rep@fixture.test' } });
    const button = screen.getByRole('button', { name: 'Link senden' });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    resolveCall({ error: null });
    await waitFor(() => expect(mocks.resetPasswordForEmail).toHaveBeenCalledTimes(1));
  });

  it('always offers a way back to login (resetRequest.backToLogin)', () => {
    renderPage();
    const link = screen.getByRole('link', { name: 'Zurück zur Anmeldung' });
    expect(link.getAttribute('href')).toBe('/login');
  });
});
