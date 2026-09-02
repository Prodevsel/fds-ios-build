import { useSession } from '@/lib/auth/useSession';
import { getSupabase } from '@/lib/supabase';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Leaderboard scope-config data layer (GAMI-02, table 0063). An `operator`
 * (org_admins row, D-01) reads/writes the SINGLE `leaderboard_config` row for
 * their own `sales_org_id` — the admin app's `operator` role IS an org_admins
 * membership, so this hook never needs the company_id-owned branch 0063 also
 * supports (that path exists for a different tenant-config surface, not this
 * admin dashboard's own operator identity).
 *
 * Write precedent mirrors apps/admin/src/features/companies/useBranding.ts
 * exactly: read-then-branch, real `update({...}).eq('id', existing.id)` when a
 * row exists, else a plain `insert({...})` — NEVER a single merge-style write
 * (the banned Postgres ON-CON-FLICT clause) against this force-RLS table
 * (02-08 Iron Rule, T-09-07).
 */

export type LeaderboardScope = 'team' | 'org';

export interface LeaderboardConfig {
  id: string;
  sales_org_id: string | null;
  company_id: string | null;
  default_scope: LeaderboardScope;
  show_commission_amounts: boolean;
}

const SELECT_COLS = 'id, sales_org_id, company_id, default_scope, show_commission_amounts';

async function fetchOwnSalesOrgId(userId: string): Promise<string | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('org_admins')
    .select('sales_org_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return (data?.sales_org_id as string | undefined) ?? null;
}

/** The signed-in operator's own sales_org_id (via their org_admins row). */
export function useOwnSalesOrgId() {
  const { session } = useSession();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['leaderboard-config', 'own-sales-org', userId],
    queryFn: () => fetchOwnSalesOrgId(userId as string),
    enabled: Boolean(userId),
  });
}

/** The org's leaderboard_config row, or null when the org has never opted in. */
export function useLeaderboardConfig(salesOrgId: string | null) {
  return useQuery({
    queryKey: ['leaderboard-config', salesOrgId],
    enabled: Boolean(salesOrgId),
    queryFn: async (): Promise<LeaderboardConfig | null> => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('leaderboard_config')
        .select(SELECT_COLS)
        .eq('sales_org_id', salesOrgId as string)
        .maybeSingle();
      if (error) {
        throw error;
      }
      return (data as LeaderboardConfig | null) ?? null;
    },
  });
}

export interface SaveLeaderboardConfigInput {
  salesOrgId: string;
  /** The existing row's id, or null when this org has no config row yet. */
  existingId: string | null;
  defaultScope: LeaderboardScope;
  showCommissionAmounts: boolean;
}

/**
 * Persist the org's scope config. When a row already exists, updates it via
 * `update().eq('id', ...)`; otherwise inserts a fresh row. Never a merge-style
 * single write against a force-RLS table (the ON-CON-FLICT 42501 trap, 02-08)
 * — insert-vs-update is resolved by the caller's prior read (`existingId`),
 * matching useBranding's `useSaveBranding` precedent.
 */
export function useSaveLeaderboardConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveLeaderboardConfigInput): Promise<void> => {
      const supabase = getSupabase();
      if (input.existingId) {
        const { error } = await supabase
          .from('leaderboard_config')
          .update({
            default_scope: input.defaultScope,
            show_commission_amounts: input.showCommissionAmounts,
            updated_at: new Date().toISOString(),
          })
          .eq('id', input.existingId);
        if (error) {
          throw error;
        }
        return;
      }
      const { error } = await supabase.from('leaderboard_config').insert({
        sales_org_id: input.salesOrgId,
        default_scope: input.defaultScope,
        show_commission_amounts: input.showCommissionAmounts,
      });
      if (error) {
        throw error;
      }
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['leaderboard-config', variables.salesOrgId],
      });
    },
  });
}
