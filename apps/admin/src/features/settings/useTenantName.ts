import { useSession } from '@/lib/auth/useSession';
import { getSupabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';

/**
 * Tenant-identity data layer (SEC-10, D-15/D-16). Reads
 * `public.my_tenant_identity()` (plan 14-02, migration
 * `0078_my_tenant_identity_rpc.sql`) — a zero-parameter, `auth.uid()`-scoped
 * SECURITY DEFINER RPC. This hook passes NO `company_id`/`sales_org_id` from
 * the client; every scoping decision happens server-side.
 *
 * The RPC's own `order by tenant_kind, tenant_name` clause makes its result
 * deterministic; this hook additionally picks the FIRST row of that ordering
 * as the single display value — the same "first row after the RPC's own
 * ordering" rule the mobile tenant-chrome hook (14-09) uses, so both apps
 * resolve a multi-row caller (a rep holding more than one membership, or
 * both a membership and an org_admins row) to the same displayed name. The
 * full row list stays available via `tenants` for any consumer that needs
 * more than the single display value.
 *
 * Zero rows is NOT an error — it is an explicit "unknown tenant" state
 * (`tenantName: null`). The UI must render a neutral loading/unknown
 * placeholder in that case, never a fabricated or stale name (D-15's whole
 * point: the defect being removed is exactly a fallback company name).
 */

export type TenantKind = 'company' | 'sales_org';

export interface TenantIdentityRow {
  tenant_kind: TenantKind;
  tenant_id: string;
  tenant_name: string;
}

async function fetchTenantIdentity(): Promise<TenantIdentityRow[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('my_tenant_identity');
  if (error) {
    throw error;
  }
  return (data as TenantIdentityRow[] | null) ?? [];
}

export interface UseTenantNameResult {
  /** The first row's tenant_name after the RPC's own ordering, or `null` when
   *  zero rows are returned (the explicit unknown state) or while loading. */
  tenantName: string | null;
  tenantKind: TenantKind | null;
  /** The full row list — a caller may hold more than one tenant relationship. */
  tenants: TenantIdentityRow[];
  isLoading: boolean;
  isError: boolean;
}

/** The signed-in caller's own tenant identity (rep or operator path). */
export function useTenantName(): UseTenantNameResult {
  const { session } = useSession();
  const userId = session?.user.id;

  const query = useQuery({
    queryKey: ['tenant-identity', userId],
    enabled: Boolean(userId),
    queryFn: fetchTenantIdentity,
  });

  const tenants = query.data ?? [];
  const first = tenants[0];

  return {
    tenantName: first?.tenant_name ?? null,
    tenantKind: first?.tenant_kind ?? null,
    tenants,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
