import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import i18n from '@/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';

/**
 * Anti-regression proof for the audited D-17/D-19 defect (Phase 14, plan
 * 14-10): `LoginPage.tsx` originally shipped 366 lines with zero `t()` calls
 * and a hardcoded, factually-wrong `v0.5.0` version literal. A snapshot would
 * not catch a re-introduced literal — this file follows the repo's
 * established "source-contract test" style (13-04/`useLeaderboard` import-scan
 * precedent, ContractListScreen.test.tsx's hardcoded-German-copy scan) to
 * structurally assert neither regresses, plus a behavioural pass proving the
 * page actually renders/submits/errors through the new `auth` i18n namespace.
 *
 * Verified once, by hand, during Task 2: temporarily reintroducing a bare
 * German literal (e.g. `<div>Anmelden</div>`) into `LoginPage.tsx` turned the
 * "no hardcoded German copy" assertion red, and temporarily reintroducing
 * `v0.5.0` turned the "no bare version literal" assertion red — both reverted
 * before commit, confirming the source-contract test actually catches the
 * defect it exists to prevent.
 */

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ auth: { signInWithPassword: mocks.signIn } }),
}));

afterEach(() => {
  mocks.signIn.mockReset();
});

function renderLoginPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('LoginPage source contract (D-17/D-19 anti-regression)', () => {
  const rawSource = readFileSync(resolve(process.cwd(), 'src/features/auth/LoginPage.tsx'), 'utf-8');
  // Strip comments before scanning for code-level claims — this file's own
  // doc comment legitimately references German words/the old version literal
  // in prose without that being the code claim under test.
  const source = rawSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('has no hardcoded German copy — every user-facing string goes through t()', () => {
    const germanWords = [
      'Anmelden',
      'Passwort',
      'E-Mail',
      'Zugang nur',
      'zurücksetzen',
      'falsch',
      'Einladungs-Konto',
    ];
    for (const word of germanWords) {
      expect(source).not.toContain(word);
    }
  });

  it('never hardcodes a vX.Y.Z version literal — the footer sources apps/admin/package.json', () => {
    expect(source).not.toMatch(/v\d+\.\d+\.\d+/);
    expect(source).toContain("import { version } from '../../../package.json'");
  });

  it('uses the auth i18n namespace and calls t() more than 15 times', () => {
    expect(source).toContain("useTranslation('auth')");
    const calls = source.match(/\bt\(/g) ?? [];
    expect(calls.length).toBeGreaterThan(15);
  });

  it('replaces both dead #reset preventDefault() links with a real route', () => {
    // e.preventDefault() on the form's own onSubmit is legitimate; only the
    // dead reset-link no-op pattern is forbidden.
    expect(source).not.toMatch(/href="#reset"/);
    expect(source).not.toMatch(/onClick=\{\(e\) => e\.preventDefault\(\)\}/);
    expect(source.match(/to="\/reset-password-request"/g)?.length).toBe(2);
  });
});

describe('LoginPage behaviour', () => {
  afterEach(() => {
    mocks.signIn.mockReset();
  });

  it('renders the translated title, subtitle and submit CTA', () => {
    renderLoginPage();
    expect(screen.getByText('Anmelden', { selector: 'div' })).toBeTruthy();
    expect(screen.getByText('Melde dich mit deinem Einladungs-Konto an.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Anmelden' })).toBeTruthy();
  });

  it('renders the version footer sourced from package.json, not a stale literal', () => {
    renderLoginPage();
    expect(screen.getByText(/Version \d+\.\d+\.\d+/)).toBeTruthy();
  });

  it('shows the translated combined credential-error copy on a failed sign-in (T-14-10-01)', async () => {
    mocks.signIn.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    renderLoginPage();

    fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'rep@fixture.test' } });
    fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }));

    await waitFor(() =>
      expect(screen.getByText(/E-Mail oder Passwort falsch/)).toBeTruthy(),
    );
    // Never split into distinct unknown-email/wrong-password copy (T-14-10-01).
    expect(screen.queryByText(/unbekannt/i)).toBeNull();
  });

  it('the reset-password link points at the named 14-11 route', () => {
    renderLoginPage();
    const links = screen.getAllByRole('link', { name: /Passwort zurücksetzen|setze dein Passwort zurück/ });
    for (const link of links) {
      expect(link.getAttribute('href')).toBe('/reset-password-request');
    }
  });
});

describe('DEV-only demo account chips (QUICK-MQB-02)', () => {
  // vitest runs with import.meta.env.DEV === true, so the guarded branch renders here.
  it('renders one chip per demo role', () => {
    renderLoginPage();
    expect(screen.getByRole('button', { name: 'Operator' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Teamleitung' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Vertrieb' })).toBeTruthy();
  });

  it('fills email and password from the Operator chip in one click', () => {
    renderLoginPage();
    const email = screen.getByLabelText('E-Mail') as HTMLInputElement;
    const pw = screen.getByLabelText('Passwort') as HTMLInputElement;

    fireEvent.click(screen.getByRole('button', { name: 'Operator' }));

    expect(email.value).toBe('admin@demo.frontdoorsales.de');
    expect(pw.value.length).toBeGreaterThan(0);
  });

  it('fills the Vertrieb account from the Vertrieb chip', () => {
    renderLoginPage();
    const email = screen.getByLabelText('E-Mail') as HTMLInputElement;

    fireEvent.click(screen.getByRole('button', { name: 'Vertrieb' }));

    expect(email.value).toBe('vertrieb@demo.frontdoorsales.de');
  });

  it('a chip click never submits the form or reaches Supabase', () => {
    renderLoginPage();
    fireEvent.click(screen.getByRole('button', { name: 'Teamleitung' }));
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it('source contract: the credentials live only behind the import.meta.env.DEV guard', () => {
    const raw = readFileSync(resolve(process.cwd(), 'src/features/auth/LoginPage.tsx'), 'utf-8');
    const guardAt = raw.indexOf('import.meta.env.DEV');
    expect(guardAt).toBeGreaterThan(-1);
    // Every credential literal is declared after the guard, i.e. inside the
    // branch Vite eliminates when DEV is replaced by false in a prod build.
    for (const literal of ['DemoZugang2026', '@demo.frontdoorsales.de']) {
      expect(raw.indexOf(literal)).toBeGreaterThan(guardAt);
    }
    // Exporting the account data would keep it reachable and defeat DCE.
    expect(raw).not.toMatch(/export\s+(const|function)\s+DEMO_ACCOUNTS/);
  });

  it('source contract: no credential ever reaches the shipped i18n resource', () => {
    const de = readFileSync(resolve(process.cwd(), 'src/features/auth/i18n/de.json'), 'utf-8');
    expect(de).not.toContain('DemoZugang2026');
    expect(de).not.toContain('demo.frontdoorsales.de');
  });
});
