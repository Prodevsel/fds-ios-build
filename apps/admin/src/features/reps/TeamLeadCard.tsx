import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { getSupabase } from '@/lib/supabase';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useAdministrableTeams, useTeamCandidates } from './useReps';

/**
 * Teamleitung festlegen (0091).
 *
 * `teams.lead_id` is the SOLE source of the dashboard `team_lead` role, and no
 * control ever wrote it. The invite dialog's "Teamleitung" role looks like it
 * appoints one and does not: it writes only `memberships.role_id`
 * (0046:73-78), which nothing in the system reads as authority. The appointee
 * signs in and lands on "Kein Zugang".
 *
 * So this card is the missing write path, not a convenience. The body copy
 * says so plainly, because the invite dialog actively suggests otherwise.
 *
 * The write goes through the `set_team_lead` RPC, which checks org-admin
 * membership of the team's sales organisation against auth.uid() itself. Only
 * SALES-ORG teams are offered (`useAdministrableTeams`) — a company team has
 * no `sales_org_id`, so the RPC could never act on one anyway. The card hides
 * itself when there is nothing to administer, the same self-hiding contract
 * `CreateTeamCard` documents.
 */
export function TeamLeadCard() {
  const { t } = useTranslation('reps');
  const queryClient = useQueryClient();
  const { data: teams } = useAdministrableTeams();

  const [teamId, setTeamId] = React.useState('');
  const [leadId, setLeadId] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [assigned, setAssigned] = React.useState<string | null>(null);

  // Default to the only team rather than making the operator choose between
  // one option (same reasoning as CreateTeamCard's org default).
  React.useEffect(() => {
    if (!teamId && teams && teams.length > 0 && teams[0]) {
      setTeamId(teams[0].id);
    }
  }, [teams, teamId]);

  const { data: candidates } = useTeamCandidates(teamId || null);

  const setLead = useMutation({
    mutationFn: async (input: { teamId: string; leadId: string }): Promise<void> => {
      const { error: rpcError } = await getSupabase().rpc('set_team_lead', {
        p_team_id: input.teamId,
        p_lead_id: input.leadId,
      });
      if (rpcError) {
        throw rpcError;
      }
    },
  });

  if (!teams || teams.length === 0) {
    return null;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAssigned(null);
    if (!teamId || !leadId) {
      return;
    }
    const name = candidates?.find((c) => c.id === leadId)?.name ?? leadId;
    setLead.mutate(
      { teamId, leadId },
      {
        onSuccess: () => {
          setAssigned(name);
          // The appointee's dashboard role is derived from teams.lead_id, so
          // the admin-role query has to be refetched too — not just the roster.
          void queryClient.invalidateQueries({ queryKey: ['reps'] });
          void queryClient.invalidateQueries({ queryKey: ['admin-role'] });
        },
        onError: () => setError(t('teamLead.error')),
      },
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-md p-lg">
        <div className="flex flex-col gap-xs">
          <h2 className="font-display text-heading text-foreground">{t('teamLead.heading')}</h2>
          <p className="text-body text-muted-foreground">{t('teamLead.body')}</p>
        </div>

        <form className="flex flex-wrap items-end gap-md" onSubmit={handleSubmit}>
          <div className="flex min-w-[14rem] flex-col gap-xs">
            <Label htmlFor="team-lead-team">{t('teamLead.teamLabel')}</Label>
            <select
              id="team-lead-team"
              className="h-10 rounded-md border border-input bg-transparent px-md text-body"
              value={teamId}
              onChange={(e) => {
                setTeamId(e.target.value);
                setLeadId('');
                setAssigned(null);
              }}
            >
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex min-w-[14rem] flex-col gap-xs">
            <Label htmlFor="team-lead-person">{t('teamLead.personLabel')}</Label>
            <select
              id="team-lead-person"
              className="h-10 rounded-md border border-input bg-transparent px-md text-body"
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              disabled={(candidates?.length ?? 0) === 0}
            >
              <option value="">
                {(candidates?.length ?? 0) === 0
                  ? t('teamLead.emptyCandidates')
                  : t('teamLead.personLabel')}
              </option>
              {candidates?.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </div>

          <Button type="submit" disabled={setLead.isPending || !leadId}>
            {setLead.isPending ? t('teamLead.submitting') : t('teamLead.submit')}
          </Button>
        </form>

        {assigned ? (
          <p role="status" className="text-body text-muted-foreground">
            {t('teamLead.assigned').replace('{name}', assigned)}
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
