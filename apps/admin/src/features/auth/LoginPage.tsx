import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getSupabase } from '@/lib/supabase';
import { version } from '../../../package.json';
import { AuthShell } from './AuthShell';

/**
 * Login — form panel on `AuthShell` (the two-panel layout extracted in this
 * plan's Task 1). REBUILT for i18n (D-17): every visible string resolves
 * through `useTranslation('auth')` against `features/auth/i18n/de.json`, zero
 * German literals remain in JSX. The version footer reads the real
 * `apps/admin/package.json` version field (D-19) instead of a hand-typed
 * literal. The two reset links are real `<Link to="/reset-password-request">`
 * — the route + page land in plan 14-11; this plan only removes the dead
 * `preventDefault()` no-ops and wires a named destination (T-14-10-04).
 *
 * The right-hand form panel uses ONLY the 4/8/16/24/32 spacing scale and the
 * four canonical admin type sizes/`@/components/ui/*` primitives — the hero
 * panel's bespoke sizes stay in `AuthShell`, unaffected by this rebuild.
 */
export function LoginPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !pw || loading) return;
    setLoading(true);
    setError(false);
    const { error: signInError } = await getSupabase().auth.signInWithPassword({
      email,
      password: pw,
    });
    setLoading(false);
    if (signInError) {
      setError(true);
      return;
    }
    navigate('/', { replace: true });
  };

  return (
    <AuthShell>
      <form
        onSubmit={onSubmit}
        className="w-full max-w-[352px]"
        style={{ animation: 'fdsRise .5s cubic-bezier(.2,.7,.3,1) both' }}
      >
        {import.meta.env.DEV && (
          <DemoAccountChips
            onPick={(pickedEmail, pickedPw) => {
              setEmail(pickedEmail);
              setPw(pickedPw);
            }}
          />
        )}

        <div className="mb-xs font-display text-display font-medium leading-[34px] text-ink">
          {t('login.title')}
        </div>
        <div className="mb-lg text-body text-muted-foreground">{t('login.subtitle')}</div>

        {error && (
          <div className="mb-lg flex items-start gap-sm rounded-md border border-brick/25 bg-brick/[.07] px-md py-sm">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#C0362C"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mt-px flex-none"
              aria-hidden
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4" />
              <path d="M12 16h.01" />
            </svg>
            <div className="text-body leading-[18px] text-brick">
              {t('login.errorCredentials')}{' '}
              <Link to="/reset-password-request" className="text-brick underline">
                {t('login.errorCredentialsLinkSuffix')}
              </Link>
              .
            </div>
          </div>
        )}

        <Label htmlFor="login-email" className="mb-sm block">
          {t('login.emailLabel')}
        </Label>
        <Input
          id="login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('login.emailPlaceholder')}
          autoComplete="email"
          className="mb-md"
        />

        <div className="mb-sm flex items-baseline justify-between">
          <Label htmlFor="login-pw">{t('login.passwordLabel')}</Label>
          <Link to="/reset-password-request" className="text-label text-porch normal-case">
            {t('login.resetLinkCta')}
          </Link>
        </div>
        <div className="relative mb-lg">
          <Input
            id="login-pw"
            type={showPw ? 'text' : 'password'}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            className="pr-[46px]"
          />
          <button
            type="button"
            onClick={() => setShowPw((s) => !s)}
            aria-label={showPw ? t('login.hidePasswordLabel') : t('login.showPasswordLabel')}
            title={showPw ? t('login.hidePasswordLabel') : t('login.showPasswordLabel')}
            className="absolute right-xs top-[5px] flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground"
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? t('login.submitting') : t('login.submitCta')}
        </Button>

        <div className="mt-lg text-label normal-case text-ink/40">
          {t('login.footerAccessNote')} · <span className="font-mono">{t('version.label', { version })}</span>
        </div>
      </form>
    </AuthShell>
  );
}

/**
 * Demo-account shortcut row for the live customer demo — rendered ONLY from
 * inside the `import.meta.env.DEV` branch above. Vite replaces `DEV` with
 * `false` in a production build, so this declaration and the credential data
 * below it become unreachable and are dropped by tree-shaking. Neither symbol
 * is exported: exporting would keep them reachable and defeat that
 * elimination. Verified by grepping the real `dist/` output for both the
 * password and the demo email domain (T-MQB-02).
 */
const DEMO_ACCOUNTS = [
  { key: 'operator', email: 'admin@demo.frontdoorsales.de', pw: 'DemoZugang2026!' },
  { key: 'teamleitung', email: 'teamleitung@demo.frontdoorsales.de', pw: 'DemoZugang2026!' },
  { key: 'vertrieb', email: 'vertrieb@demo.frontdoorsales.de', pw: 'DemoZugang2026!' },
] as const;

function DemoAccountChips({ onPick }: { onPick: (email: string, pw: string) => void }) {
  const { t } = useTranslation('auth');
  return (
    <div className="mb-lg">
      <div className="mb-sm text-label normal-case text-ink/40">{t('demoAccounts.hint')}</div>
      <div className="flex flex-wrap gap-sm">
        {DEMO_ACCOUNTS.map((account) => (
          <Button
            key={account.key}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPick(account.email, account.pw)}
          >
            {t(`demoAccounts.${account.key}`)}
          </Button>
        ))}
      </div>
    </div>
  );
}
