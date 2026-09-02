import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getSupabase } from '@/lib/supabase';
import { AuthShell } from './AuthShell';

/**
 * ResetPasswordRequestPage — admin SEC-01 vertical slice, first half. Route
 * `/reset-password-request`, unauthenticated, on `AuthShell` (14-10). Renders
 * inside the shared two-panel layout, form panel only — the brand hero panel
 * is not re-duplicated here.
 *
 * D-20 (enumeration safety): `performResetRequest` below never inspects the
 * `error` Supabase's `resetPasswordForEmail` may return — Supabase's own API
 * already never distinguishes "no such user" from success for this call, and
 * branching on `error` content here would reintroduce an enumeration side
 * channel. The ONLY signal allowed to diverge from the "sent" outcome is a
 * thrown exception (a genuine transport/network failure), caught below.
 */

export type ResetRequestResult = { status: 'sent' } | { status: 'network-error' };

export interface ResetRequestAuthClient {
  resetPasswordForEmail: (
    email: string,
    options: { redirectTo: string },
  ) => Promise<{ error: { message: string } | null }>;
}

export async function performResetRequest({
  auth,
  email,
  redirectTo,
}: {
  auth: ResetRequestAuthClient;
  email: string;
  redirectTo: string;
}): Promise<ResetRequestResult> {
  try {
    await auth.resetPasswordForEmail(email, { redirectTo });
    // No branch on `error` here — see file header (D-20, 14-RESEARCH Pitfall 2).
    return { status: 'sent' };
  } catch {
    return { status: 'network-error' };
  }
}

export function ResetPasswordRequestPage() {
  const { t } = useTranslation('auth');
  const { t: tCommon } = useTranslation('common');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResetRequestResult | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || loading) return;
    setLoading(true);
    const outcome = await performResetRequest({
      auth: getSupabase().auth,
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    setResult(outcome);
  };

  if (result?.status === 'sent') {
    return (
      <AuthShell>
        <div className="w-full max-w-[352px]">
          <div className="mb-xs font-display text-display font-medium leading-[34px] text-ink">
            {t('resetRequest.title')}
          </div>
          <div className="mb-lg text-body text-muted-foreground">{t('resetRequest.confirmation')}</div>
          <Link to="/login" className="text-body text-porch underline">
            {t('resetRequest.backToLogin')}
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form onSubmit={onSubmit} className="w-full max-w-[352px]">
        <div className="mb-xs font-display text-display font-medium leading-[34px] text-ink">
          {t('resetRequest.title')}
        </div>
        <div className="mb-lg text-body text-muted-foreground">{t('resetRequest.subtitle')}</div>

        {result?.status === 'network-error' && (
          <div className="mb-lg rounded-md border border-brick/25 bg-brick/[.07] px-md py-sm text-body text-brick">
            {tCommon('errors.offline')}
          </div>
        )}

        <Label htmlFor="reset-request-email" className="mb-sm block">
          {t('login.emailLabel')}
        </Label>
        <Input
          id="reset-request-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('login.emailPlaceholder')}
          autoComplete="email"
          className="mb-lg"
        />

        <Button type="submit" disabled={loading} className="mb-lg w-full">
          {loading ? t('login.submitting') : t('resetRequest.submitCta')}
        </Button>

        <Link to="/login" className="text-body text-porch underline">
          {t('resetRequest.backToLogin')}
        </Link>
      </form>
    </AuthShell>
  );
}
