import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/lib/auth/useSession';
import { cn } from '@/lib/utils';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import {
  type LeaderboardScope,
  useLeaderboardConfig,
  useOwnSalesOrgId,
  useSaveLeaderboardConfig,
} from './useLeaderboardConfig';

/**
 * GAMI-02/D-01 admin scope-config form: an org admin (operator) sets whether
 * the leaderboard is team-scoped (the hard default) or an explicit
 * company-wide opt-in, plus the show-commission-amounts flag.
 *
 * Role gating here is a UX convenience only — the real authority is
 * `leaderboard_config`'s org-admin-only INSERT/UPDATE RLS (0063, T-09-10); a
 * non-admin who somehow reached this form would still get a server-side
 * rejection on save, never a client-trusted write.
 */
export function LeaderboardConfigForm() {
  const { t } = useTranslation('leaderboard');
  const { role } = useSession();
  const { data: salesOrgId } = useOwnSalesOrgId();
  const { data: config, isLoading } = useLeaderboardConfig(salesOrgId ?? null);
  const save = useSaveLeaderboardConfig();

  // Local edit state seeded once the persisted row (or its absence) resolves.
  // No config row yet means the org has never opted in — team scope, the hard
  // default (D-01), never company-wide.
  const [scope, setScope] = React.useState<LeaderboardScope | null>(null);
  const [showCommission, setShowCommission] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    if (!isLoading && scope === null) {
      setScope(config?.default_scope ?? 'team');
      setShowCommission(config?.show_commission_amounts ?? false);
    }
  }, [isLoading, config, scope]);

  if (role !== 'operator') {
    return (
      <div className="rounded-md border border-input bg-muted p-md text-body text-muted-foreground">
        {t('notAdmin')}
      </div>
    );
  }

  if (isLoading || scope === null || showCommission === null) {
    return (
      <div className="flex flex-col gap-md">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  function handleSave() {
    if (!salesOrgId || scope === null || showCommission === null) {
      return;
    }
    save.mutate({
      salesOrgId,
      existingId: config?.id ?? null,
      defaultScope: scope,
      showCommissionAmounts: showCommission,
    });
  }

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-col gap-xs">
        <h3 className="font-display text-heading text-foreground">{t('heading')}</h3>
        <p className="text-body text-muted-foreground">{t('subtitle')}</p>
      </div>

      <fieldset className="flex flex-col gap-sm">
        <legend className="text-label font-medium uppercase tracking-wide text-muted-foreground">
          {t('scope.legend')}
        </legend>

        <ScopeOption
          id="leaderboard-scope-team"
          name="leaderboard-scope"
          checked={scope === 'team'}
          onChange={() => setScope('team')}
          label={t('scope.team.label')}
          hint={t('scope.team.hint')}
        />
        <ScopeOption
          id="leaderboard-scope-org"
          name="leaderboard-scope"
          checked={scope === 'org'}
          onChange={() => setScope('org')}
          label={t('scope.org.label')}
          hint={t('scope.org.hint')}
        />
      </fieldset>

      <div className="flex items-start gap-sm">
        <input
          type="checkbox"
          id="leaderboard-show-commission"
          checked={showCommission}
          onChange={(e) => setShowCommission(e.target.checked)}
          className="mt-[3px] size-4 rounded border-input"
        />
        <div className="flex flex-col gap-xs">
          <Label htmlFor="leaderboard-show-commission">{t('showCommission.label')}</Label>
          <p className="text-label text-muted-foreground">{t('showCommission.hint')}</p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-sm">
        {save.isSuccess ? <span className="text-label text-pine">{t('saved')}</span> : null}
        <Button onClick={handleSave} disabled={save.isPending || !salesOrgId}>
          {save.isPending ? t('saving') : t('save')}
        </Button>
      </div>
    </div>
  );
}

function ScopeOption({
  id,
  name,
  checked,
  onChange,
  label,
  hint,
}: {
  id: string;
  name: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  hint: string;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer flex-col gap-xs rounded-md border p-md transition-colors',
        checked ? 'border-primary bg-primary/5' : 'border-input hover:bg-muted',
      )}
    >
      <div className="flex items-center gap-sm">
        <input
          type="radio"
          id={id}
          name={name}
          checked={checked}
          onChange={onChange}
          aria-label={label}
          className="size-4"
        />
        <span aria-hidden className="text-body font-medium text-foreground">
          {label}
        </span>
      </div>
      <p className="pl-lg text-label text-muted-foreground">{hint}</p>
    </label>
  );
}
