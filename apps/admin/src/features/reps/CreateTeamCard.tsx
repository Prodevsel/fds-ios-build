import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getSupabase } from '@/lib/supabase';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useReps } from './useReps';

/**
 * Ein Vertriebsteam anlegen (0087).
 *
 * A company team is created for you when a company is onboarded. A sales-org
 * team — the kind that carries territories, houses and the reps who walk them —
 * had no path at all: "Team Leonberg" exists because somebody wrote an INSERT by
 * hand, and a second sales organisation could not be set up without database
 * access.
 *
 * `teams` grants authenticated SELECT and nothing else, so the write goes
 * through the `create_sales_team` RPC, which checks org-admin membership of the
 * target organisation against auth.uid() itself. The card simply hides for
 * anyone with no organisation to create in — the RPC would reject them anyway.
 */

interface AdministeredOrg {
  id: string;
  name: string;
}

/** Sales organisations the signed-in user administers. RLS scopes the read. */
function useAdministeredOrgs() {
  return useQuery({
    queryKey: ['reps', 'administered-orgs'],
    queryFn: async (): Promise<AdministeredOrg[]> => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('org_admins')
        .select('sales_org_id, sales_org(id, name)')
        .order('sales_org_id', { ascending: true });
      if (error) {
        throw error;
      }
      // PostgREST types an embedded relation as an ARRAY even where the FK
      // makes it at most one row, so normalise both shapes rather than
      // asserting one of them away.
      const rows = (data ?? []) as unknown as {
        sales_org: AdministeredOrg | AdministeredOrg[] | null;
      }[];
      return rows
        .flatMap((row) => (Array.isArray(row.sales_org) ? row.sales_org : [row.sales_org]))
        .filter((org): org is AdministeredOrg => org !== null && org !== undefined);
    },
  });
}

export function CreateTeamCard() {
  const { t } = useTranslation('reps');
  const queryClient = useQueryClient();
  const { data: orgs } = useAdministeredOrgs();

  const { data: reps } = useReps();

  const [name, setName] = React.useState('');
  const [orgId, setOrgId] = React.useState('');
  const [leadId, setLeadId] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<string | null>(null);

  const createTeam = useMutation({
    mutationFn: async (input: { orgId: string; name: string; leadId: string }): Promise<void> => {
      const { error: rpcError } = await getSupabase().rpc('create_sales_team', {
        p_sales_org_id: input.orgId,
        p_name: input.name,
        // The parameter has existed since 0087, which already validates the
        // lead against visible_app_users — only this caller was incomplete, so
        // every team was created leaderless and needed a second trip through
        // "Teamleitung festlegen".
        p_lead_id: input.leadId || null,
      });
      if (rpcError) {
        throw rpcError;
      }
    },
  });

  // Default to the only organisation rather than making the operator choose
  // between one option.
  React.useEffect(() => {
    if (!orgId && orgs?.length === 1 && orgs[0]) {
      setOrgId(orgs[0].id);
    }
  }, [orgs, orgId]);

  if (!orgs || orgs.length === 0) {
    return null;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreated(null);
    const trimmed = name.trim();
    if (!trimmed || !orgId) {
      return;
    }
    createTeam.mutate(
      { orgId, name: trimmed, leadId },
      {
        onSuccess: () => {
          setCreated(trimmed);
          setName('');
          setLeadId('');
          void queryClient.invalidateQueries({ queryKey: ['reps'] });
          void queryClient.invalidateQueries({ queryKey: ['companies', 'sales-teams'] });
        },
        onError: () => setError(t('createTeam.error')),
      },
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-md p-lg">
        <div className="flex flex-col gap-xs">
          <h2 className="font-display text-heading text-foreground">{t('createTeam.heading')}</h2>
          <p className="text-body text-muted-foreground">{t('createTeam.body')}</p>
        </div>

        <form className="flex flex-wrap items-end gap-md" onSubmit={handleSubmit}>
          {orgs.length > 1 ? (
            <div className="flex min-w-[14rem] flex-col gap-xs">
              <Label htmlFor="create-team-org">{t('createTeam.orgLabel')}</Label>
              <select
                id="create-team-org"
                className="h-10 rounded-md border border-input bg-transparent px-md text-body"
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
              >
                {orgs.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="flex min-w-[16rem] flex-1 flex-col gap-xs">
            <Label htmlFor="create-team-name">{t('createTeam.nameLabel')}</Label>
            <Input
              id="create-team-name"
              value={name}
              placeholder={t('createTeam.namePlaceholder')}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="flex min-w-[14rem] flex-col gap-xs">
            <Label htmlFor="create-team-lead">{t('createTeam.leadLabel')}</Label>
            <select
              id="create-team-lead"
              className="h-10 rounded-md border border-input bg-transparent px-md text-body"
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
            >
              <option value="">{t('createTeam.leadNone')}</option>
              {reps
                ?.filter((rep) => rep.userId !== null)
                .map((rep) => (
                  <option key={rep.id} value={rep.userId as string}>
                    {rep.name ?? rep.userId}
                  </option>
                ))}
            </select>
          </div>

          <Button type="submit" disabled={createTeam.isPending || !name.trim()}>
            {createTeam.isPending ? t('createTeam.submitting') : t('createTeam.submit')}
          </Button>
        </form>

        {created ? (
          <p role="status" className="text-body text-muted-foreground">
            {t('createTeam.created').replace('{name}', created)}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-body text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
