import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronLeft } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { PackageProductCard } from './PackageProductCard';
import type { Company } from './useCompanies';
import {
  useCompanyPartnerTeams,
  useSalesTeams,
  useSetPartnerTeam,
} from './usePartnerTeams';

/**
 * "Welche Vertriebsteams dürfen dieses Unternehmen verkaufen?" (0086)
 *
 * Reached by clicking an ACTIVE company row, which used to do nothing at all —
 * the row was inert once onboarding finished, so a finished company had no
 * detail view to attach this to.
 *
 * A ticked box is the whole mechanism by which a partner's catalogue reaches a
 * rep's phone. Before it existed, the same effect was achieved by adding the
 * rep to a company team that existed for no other reason, which nobody could
 * discover from the outside.
 */
export function PartnerTeamsPanel({
  company,
  onClose,
}: {
  company: Company;
  onClose: () => void;
}) {
  const { t } = useTranslation('companies');
  const { data: teams, isLoading } = useSalesTeams();
  const { data: boundTeamIds } = useCompanyPartnerTeams(company.id);
  const setPartnerTeam = useSetPartnerTeam();
  const [error, setError] = React.useState<string | null>(null);

  const bound = new Set(boundTeamIds ?? []);

  function handleToggle(teamId: string, next: boolean) {
    setError(null);
    setPartnerTeam.mutate(
      { companyId: company.id, teamId, bound: next },
      {
        // RLS rejects a team the operator does not administer. Say so plainly
        // instead of leaving a checkbox that silently springs back.
        onError: () => setError(t('partnerTeams.errorNotPermitted')),
      },
    );
  }

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-lg">
      <header className="flex flex-col gap-sm">
        <Button variant="ghost" className="self-start px-0" onClick={onClose}>
          <ChevronLeft aria-hidden className="size-4" />
          {t('partnerTeams.back')}
        </Button>
        <div className="flex flex-col gap-xs">
          <h1 className="font-display text-display text-foreground">{company.name}</h1>
          <p className="text-body text-muted-foreground">{t('partnerTeams.subtitle')}</p>
        </div>
      </header>

      <Card>
        <CardContent className="flex flex-col gap-md p-lg">
          <h2 className="font-display text-heading text-foreground">{t('partnerTeams.heading')}</h2>
          <p className="text-body text-muted-foreground">{t('partnerTeams.body')}</p>

          {isLoading ? <p className="text-body text-muted-foreground">{t('partnerTeams.loading')}</p> : null}

          {!isLoading && (teams?.length ?? 0) === 0 ? (
            <p className="text-body text-muted-foreground">{t('partnerTeams.noTeams')}</p>
          ) : null}

          <ul className="flex flex-col gap-sm">
            {teams?.map((team) => {
              const isBound = bound.has(team.id);
              return (
                <li key={team.id} className="flex items-center gap-sm">
                  <input
                    id={`partner-team-${team.id}`}
                    type="checkbox"
                    className="size-4 accent-[var(--color-accent)]"
                    checked={isBound}
                    disabled={setPartnerTeam.isPending}
                    onChange={(e) => handleToggle(team.id, e.target.checked)}
                  />
                  <label htmlFor={`partner-team-${team.id}`} className="text-body text-foreground">
                    {team.name}
                  </label>
                </li>
              );
            })}
          </ul>

          {error ? (
            <p role="alert" className="text-body text-destructive">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* The other thing that only makes sense after onboarding: what this
          company actually sells, and for how much. */}
      <PackageProductCard companyId={company.id} />
    </div>
  );
}
