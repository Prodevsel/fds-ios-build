import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getSupabase } from '@/lib/supabase';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { useMutation } from '@tanstack/react-query';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

/** Roles a team lead may provision via invite (mirrors the Edge Function). */
const ROLE_OPTIONS = ['rep', 'team_lead'] as const;
type InviteRole = (typeof ROLE_OPTIONS)[number];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Stable machine error codes mapped to i18n copy — never a raw upstream string. */
type InviteErrorCode = 'duplicate' | 'unauthorized' | 'invalidEmail' | 'noTeam' | 'generic';

interface InviteRepDialogProps {
  open: boolean;
  onClose: () => void;
  teamId: string | null;
  /** Fired with the invited email on success (parent shows the toast + row). */
  onInvited: (email: string, role: InviteRole) => void;
}

/**
 * Email-only rep invite (D-03). Invokes the `rep-invite` Edge Function via the
 * supabase client's `functions.invoke` — NEVER the Auth Admin API directly (the
 * service-role key stays server-side, T-05-30). Success bubbles up to the parent
 * for the "Einladung versendet" toast + optimistic row; the duplicate-email path
 * surfaces the German "bereits eingeladen" copy inline.
 */
export function InviteRepDialog({ open, onClose, teamId, onInvited }: InviteRepDialogProps) {
  const { t } = useTranslation('reps');
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState<InviteRole>('rep');
  const [errorCode, setErrorCode] = React.useState<InviteErrorCode | null>(null);

  const mutation = useMutation({
    mutationFn: async (): Promise<void> => {
      const supabase = getSupabase();
      const { error } = await supabase.functions.invoke('rep-invite', {
        body: { email: email.trim(), team_id: teamId, role },
      });
      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      onInvited(email.trim(), role);
      reset();
      onClose();
    },
    onError: async (error) => {
      setErrorCode(await mapInviteError(error));
    },
  });

  function reset() {
    setEmail('');
    setRole('rep');
    setErrorCode(null);
    mutation.reset();
  }

  function handleClose() {
    if (mutation.isPending) return;
    reset();
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorCode(null);
    if (!EMAIL_RE.test(email.trim())) {
      setErrorCode('invalidEmail');
      return;
    }
    // No team resolved => the Edge Function is GUARANTEED to reject this with
    // a 400 on `team_id`, and `errors.generic` would then advise a retry that
    // cannot possibly work. Say the true thing instead, and never fire the
    // request at all.
    if (!teamId) {
      setErrorCode('noTeam');
      return;
    }
    mutation.mutate();
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={t('invite.dialogTitle')}
      description={t('invite.dialogDescription')}
      closeLabel={t('invite.close')}
    >
      <form className="flex flex-col gap-lg" onSubmit={handleSubmit} noValidate>
        <div className="flex flex-col gap-xs">
          <Label htmlFor="invite-email">{t('invite.emailLabel')}</Label>
          <Input
            id="invite-email"
            type="email"
            autoComplete="off"
            autoFocus
            placeholder={t('invite.emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={errorCode === 'invalidEmail' || errorCode === 'duplicate'}
          />
        </div>

        <div className="flex flex-col gap-xs">
          <Label htmlFor="invite-role">{t('invite.roleLabel')}</Label>
          <select
            id="invite-role"
            className="flex h-10 w-full rounded-md border border-input bg-transparent px-md py-sm text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={role}
            onChange={(e) => setRole(e.target.value as InviteRole)}
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {t(`invite.roles.${r}`)}
              </option>
            ))}
          </select>
        </div>

        {errorCode ? (
          <p role="alert" className="text-body text-destructive">
            {t(`errors.${errorCode}`)}
          </p>
        ) : null}

        <div className="flex justify-end gap-sm">
          <Button type="button" variant="outline" onClick={handleClose} disabled={mutation.isPending}>
            {t('invite.cancel')}
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? t('invite.submitting') : t('invite.submit')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Map a functions.invoke error to a stable UI code (parses the JSON body). */
async function mapInviteError(error: unknown): Promise<InviteErrorCode> {
  if (error instanceof FunctionsHttpError) {
    const status = error.context.status;
    const body = await error.context
      .clone()
      .json()
      .catch(() => null);
    if (body?.error === 'already_invited') {
      return 'duplicate';
    }
    // A 400 naming `team_id` is the same real cause as the pre-flight check
    // above, reached from the other side (e.g. a team that vanished between
    // resolve and submit).
    if (status === 400 && JSON.stringify(body ?? '').includes('team_id')) {
      return 'noTeam';
    }
    if (status === 403) {
      return 'unauthorized';
    }
  }
  return 'generic';
}
