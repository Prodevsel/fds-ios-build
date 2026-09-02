import { useSession } from '@/lib/auth/useSession';
import { getSupabase } from '@/lib/supabase';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Tenant governance data layer (SET-07/SET-08 admin half, table 0074). An
 * `operator` (org_admins row, D-14 — the existing role, no new one invented)
 * reads/writes `tenant_setting_policies` rows for their own `sales_org_id`.
 *
 * `useOwnSalesOrgId` is copied in shape from
 * `apps/admin/src/features/leaderboard/useLeaderboardConfig.ts`'s
 * `fetchOwnSalesOrgId`/`useOwnSalesOrgId` (PATTERNS.md: EXACT analog).
 *
 * UNLIKE `leaderboard_config` (one row per tenant total), this table has
 * MULTIPLE rows per tenant — one per `setting_key` — so the read fetches ALL
 * rows for the tenant and indexes them client-side by `setting_key`, never a
 * bare `.maybeSingle()`.
 *
 * The save mutation is read-then-branch, mirroring
 * `useSaveLeaderboardConfig`/`useSaveAdminAccountSettings` verbatim:
 * `update({...}).eq('id', existingId)` when a row for that key already
 * exists, else a plain `insert({...})`. NEVER a single merge-style write
 * (the banned Postgres ON-CON-FLICT clause) — the standing 02-08 42501 trap
 * against this force-RLS table (Postgres evaluates the INSERT policy WITH
 * CHECK for ANY merge-style write arm).
 *
 * `CEILINGABLE_SETTING_KEYS` is a fast, honest client-side echo of the
 * server's `tenant_setting_policies_ceiling_only_orderable` CHECK (0074):
 * `notification_quiet_hours` may NEVER carry a ceiling (D-04, NOTIF-04, §
 * 84 HGB — a rep is a Handelsvertreter who must freely determine their own
 * working time; a tenant-enforced ceiling on quiet hours would be a
 * Scheinselbständigkeit exposure). The database CHECK is the real
 * authority; this guard only fails fast and legibly in the client instead
 * of surfacing an opaque 23514 constraint violation.
 */

export type TenantSettingKey = 'auto_lock_timeout_minutes' | 'wifi_only_bulk_transfer' | 'notification_quiet_hours' | 'scanner_torch_default';
export type PolicyKind = 'ceiling' | 'proposed_default';

/** Mirrors `ceilingable_setting_key` (0074) — the only keys a `policy_kind: 'ceiling'` row may target. */
export const CEILINGABLE_SETTING_KEYS = ['auto_lock_timeout_minutes', 'wifi_only_bulk_transfer'] as const;

export interface TenantSettingPolicy {
  id: string;
  sales_org_id: string | null;
  company_id: string | null;
  setting_key: TenantSettingKey;
  policy_kind: PolicyKind;
  policy_value: unknown;
}

const SELECT_COLS = 'id, sales_org_id, company_id, setting_key, policy_kind, policy_value';

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
    queryKey: ['tenant-setting-policies', 'own-sales-org', userId],
    queryFn: () => fetchOwnSalesOrgId(userId as string),
    enabled: Boolean(userId),
  });
}

/** All of the tenant's policy rows, indexed client-side by setting_key (this table has one row PER KEY, not one row total). */
export function useTenantSettingPolicies(salesOrgId: string | null) {
  return useQuery({
    queryKey: ['tenant-setting-policies', salesOrgId],
    enabled: Boolean(salesOrgId),
    queryFn: async (): Promise<Record<string, TenantSettingPolicy>> => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('tenant_setting_policies')
        .select(SELECT_COLS)
        .eq('sales_org_id', salesOrgId as string);
      if (error) {
        throw error;
      }
      const rows = (data as TenantSettingPolicy[] | null) ?? [];
      const byKey: Record<string, TenantSettingPolicy> = {};
      for (const row of rows) {
        byKey[row.setting_key] = row;
      }
      return byKey;
    },
  });
}

export interface SavePolicyInput {
  salesOrgId: string;
  /** The existing row's id for this setting_key, or null when the tenant has no row for it yet. */
  existingId: string | null;
  settingKey: TenantSettingKey;
  policyKind: PolicyKind;
  policyValue: unknown;
}

/**
 * Persist a single tenant policy row. Read-then-branch: `update()` when
 * `existingId` is set, else `insert()`. Never a merge-style write (the
 * banned Postgres ON-CON-FLICT clause).
 *
 * Throws BEFORE ever calling Supabase when asked to write a `ceiling` for a
 * key outside `CEILINGABLE_SETTING_KEYS` — see file header (D-04/NOTIF-04/§
 * 84 HGB). This is a fast client-side echo of
 * `tenant_setting_policies_ceiling_only_orderable`; the database CHECK
 * remains the real authority.
 */
export function useSaveTenantSettingPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SavePolicyInput): Promise<void> => {
      if (
        input.policyKind === 'ceiling' &&
        !(CEILINGABLE_SETTING_KEYS as readonly string[]).includes(input.settingKey)
      ) {
        throw new Error(
          `useSaveTenantSettingPolicy: "${input.settingKey}" may never carry a ceiling (D-04/NOTIF-04/§ 84 HGB) — only ${CEILINGABLE_SETTING_KEYS.join(', ')} are ceilingable.`,
        );
      }

      const supabase = getSupabase();
      if (input.existingId) {
        const { error } = await supabase
          .from('tenant_setting_policies')
          .update({
            policy_kind: input.policyKind,
            policy_value: input.policyValue,
            updated_at: new Date().toISOString(),
          })
          .eq('id', input.existingId);
        if (error) {
          throw error;
        }
        return;
      }
      const { error } = await supabase.from('tenant_setting_policies').insert({
        sales_org_id: input.salesOrgId,
        setting_key: input.settingKey,
        policy_kind: input.policyKind,
        policy_value: input.policyValue,
      });
      if (error) {
        throw error;
      }
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['tenant-setting-policies', variables.salesOrgId],
      });
    },
  });
}
