import { getSupabase } from '@/lib/supabase';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Which sales teams may sell a company's products (0086).
 *
 * Before this existed, the answer was a shadow membership: a rep was quietly
 * placed inside a company team that had no other purpose, and nothing anywhere
 * said what that meant. The binding names it, and this module is the operator's
 * side of it.
 *
 * RLS is the real boundary in both directions — `visible_team_partner_companies`
 * decides what is listed, and the insert policy decides what may be written
 * (org admin of the team's OWN sales organisation, and only to a company they
 * can already see). Neither is re-implemented here; a rejected write surfaces
 * as an error rather than being pre-empted by a guess in the UI.
 */

export interface SalesTeam {
  id: string;
  name: string;
}

export const PARTNER_TEAMS_QUERY_KEY = ['companies', 'partner-teams'] as const;

/**
 * The sales-org teams the signed-in operator can see. `sales_org_id is not
 * null` is what makes it a SALES team rather than a company team — a company
 * team carries its own company and can never be bound to another.
 */
export function useSalesTeams() {
  return useQuery({
    queryKey: ['companies', 'sales-teams'],
    queryFn: async (): Promise<SalesTeam[]> => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('teams')
        .select('id, name')
        .not('sales_org_id', 'is', null)
        .order('name', { ascending: true });
      if (error) {
        throw error;
      }
      return (data ?? []) as SalesTeam[];
    },
  });
}

/** Team ids currently bound to this company. */
export function useCompanyPartnerTeams(companyId: string | null) {
  return useQuery({
    queryKey: [...PARTNER_TEAMS_QUERY_KEY, companyId],
    enabled: Boolean(companyId),
    queryFn: async (): Promise<string[]> => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('team_partner_companies')
        .select('team_id')
        .eq('company_id', companyId as string);
      if (error) {
        throw error;
      }
      return ((data ?? []) as { team_id: string }[]).map((row) => row.team_id);
    },
  });
}

/**
 * Bind or unbind in one call, because the control is a checkbox and that is
 * what a checkbox means. There is no UPDATE path on the table by design — a
 * binding either exists or it does not.
 */
export function useSetPartnerTeam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      companyId: string;
      teamId: string;
      bound: boolean;
    }): Promise<void> => {
      const supabase = getSupabase();
      if (input.bound) {
        const { error } = await supabase
          .from('team_partner_companies')
          .insert({ team_id: input.teamId, company_id: input.companyId });
        if (error) {
          throw error;
        }
        return;
      }
      const { error } = await supabase
        .from('team_partner_companies')
        .delete()
        .eq('team_id', input.teamId)
        .eq('company_id', input.companyId);
      if (error) {
        throw error;
      }
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: [...PARTNER_TEAMS_QUERY_KEY, variables.companyId],
      });
    },
  });
}
