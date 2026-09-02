import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getSupabase } from '@/lib/supabase';
import { AuthShell } from './AuthShell';

/**
 * ResetPasswordPage — admin SEC-01 vertical slice, second half. Route
 * `/reset-password`, the `redirectTo` landing from `ResetPasswordRequestPage`.
 *
 * LINK SHAPE (14-REVIEW CR-02). `supabase/functions/auth-email-hook/
 * buildPasswordResetEmail.ts` emits `${redirect_to}?token_hash=…&type=recovery`.
 * supabase-js's `detectSessionInUrl` recognizes only two callback shapes — an
 * implicit-grant fragment (`access_token`/`error*`) and a PKCE `?code=` paired
 * with a stored code-verifier — and this link is NEITHER, so relying on it
 * alone left `getSession()` null and showed `resetComplete.linkExpired` for
 * every valid emailed link. A `token_hash` link is consumed with
 * `verifyOtp({ token_hash, type: 'recovery' })`, exactly as the mobile app's
 * `useDeepLinkRecovery.ts` already does; this page now does the same.
 *
 * The token is read from the router's own `location.search` (never the URL
 * fragment, never `window.location.hash`) and the address bar is cleared
 * unconditionally via `history.replaceState(null, '', window.location.pathname)`
 * as soon as the recovery session exists — `pathname` alone strips whatever
 * the token arrived in, before any render that could leak it via a referrer
 * (T-14-11-02).
 */

const MIN_PASSWORD_LENGTH = 12;

export function derivePasswordHint(password: string): { tooShort: boolean; remaining: number } {
  const remaining = Math.max(0, MIN_PASSWORD_LENGTH - password.length);
  return { tooShort: remaining > 0, remaining };
}

export type PasswordResetResult = { status: 'success' } | { status: 'rejected' } | { status: 'error' };

export interface PasswordResetAuthClient {
  updateUser: (attrs: { password: string }) => Promise<{ error: { message: string } | null }>;
}

export async function performPasswordReset({
  auth,
  password,
}: {
  auth: PasswordResetAuthClient;
  password: string;
}): Promise<PasswordResetResult> {
  try {
    const { error } = await auth.updateUser({ password });
    if (error) {
      return { status: 'rejected' };
    }
    return { status: 'success' };
  } catch {
    return { status: 'error' };
  }
}

type SessionState = 'checking' | 'ready' | 'expired';

/**
 * Pure: extracts the recovery `token_hash` from a query string, or `null` when
 * the landing was not reached through an emailed recovery link. Never logged,
 * never rendered — it is a bearer credential.
 */
export function readRecoveryTokenHash(search: string): string | null {
  const tokenHash = new URLSearchParams(search).get('token_hash');
  return tokenHash && tokenHash.length > 0 ? tokenHash : null;
}

export function ResetPasswordPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const { search } = useLocation();
  const [sessionState, setSessionState] = useState<SessionState>('checking');
  const [password, setPassword] = useState('');
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rejected, setRejected] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    let cancelled = false;

    const markReady = () => {
      if (cancelled) return;
      setSessionState('ready');
      // Clears any recovery token left in the address bar/history — see file
      // header (T-14-11-02). Unconditional: no fragment/query inspection.
      window.history.replaceState(null, '', window.location.pathname);
    };

    const checkSession = async () => {
      // The emailed link's own shape first (see file header): a `token_hash`
      // is only consumable via verifyOtp — detectSessionInUrl cannot see it.
      const tokenHash = readRecoveryTokenHash(search);
      if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
        if (cancelled) return;
        if (error) {
          // Already used, genuinely expired, or tampered with — the same
          // honest dead-end-free copy either way (never echoes the reason).
          setSessionState('expired');
          return;
        }
        markReady();
        return;
      }

      // No token in the URL: an existing session (e.g. the PASSWORD_RECOVERY
      // event already fired, or the operator navigated here signed in).
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) {
        markReady();
      } else {
        setSessionState('expired');
      }
    };
    void checkSession();

    const { data: subscription } = supabase.auth.onAuthStateChange((event: string, session: unknown) => {
      if (event === 'PASSWORD_RECOVERY' && session) {
        markReady();
      }
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
    // `markReady()`'s history.replaceState does not touch the router's own
    // location, so this effect does not re-run (and never re-verifies a
    // single-use token) after the address bar is cleared.
  }, [search]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setRejected(false);
    const outcome = await performPasswordReset({ auth: getSupabase().auth, password });
    setLoading(false);
    if (outcome.status === 'success') {
      navigate('/', { replace: true });
      return;
    }
    setRejected(true);
  };

  if (sessionState === 'checking') {
    return <AuthShell>{null}</AuthShell>;
  }

  if (sessionState === 'expired') {
    return (
      <AuthShell>
        <div className="w-full max-w-[352px]">
          <div className="mb-lg text-body text-muted-foreground">{t('resetComplete.linkExpired')}</div>
          <Link to="/reset-password-request" className="text-body text-porch underline">
            {t('login.resetLinkCta')}
          </Link>
        </div>
      </AuthShell>
    );
  }

  const hint = derivePasswordHint(password);
  const showTooShort = focused && hint.tooShort;

  return (
    <AuthShell>
      <form onSubmit={onSubmit} className="w-full max-w-[352px]">
        <div className="mb-xs font-display text-display font-medium leading-[34px] text-ink">
          {t('resetComplete.title')}
        </div>

        {rejected && (
          <div className="mb-lg rounded-md border border-brick/25 bg-brick/[.07] px-md py-sm text-body text-brick">
            {t('passwordPolicy.rejectedByServer')}
          </div>
        )}

        <Label htmlFor="reset-new-password" className="mb-sm block">
          {t('login.passwordLabel')}
        </Label>
        <Input
          id="reset-new-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoComplete="new-password"
          className="mb-sm"
        />
        <div className="mb-lg text-body text-muted-foreground">
          {showTooShort ? t('passwordPolicy.tooShort', { n: hint.remaining }) : t('passwordPolicy.hint')}
        </div>

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? t('login.submitting') : t('resetComplete.submitCta')}
        </Button>
      </form>
    </AuthShell>
  );
}
