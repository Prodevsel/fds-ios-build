import { useSession } from '@/lib/auth/useSession';
import { getSupabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';

/**
 * Reporting data layer (ADMN-03). Reads the RLS-scoped aggregate views from
 * migration 0048 (reporting_kpis / reporting_deals_per_week / reporting_deals_
 * per_rep) through the anon/RLS Supabase client — the `security_invoker` views
 * inherit the signed-in team lead's RLS, so each query already returns ONLY
 * their own team's tester-excluded aggregates (no client-side scoping needed and
 * none possible to widen). Commission (Provision + Ø Deal) comes from the 0053
 * reporting_commission_per_rep view, joined onto the per-rep deals row by rep_id.
 */

export interface ReportingKpis {
  activeContracts: number;
  activeReps: number;
  avgContractsPerRep: number;
}

export interface DealsPerWeek {
  weekStart: string;
  isoYear: number;
  isoWeek: number;
  deals: number;
}

export interface DealsPerRep {
  repId: string;
  repName: string | null;
  /** Signed deals from 0048 (all-signed incl. later-cancelled). */
  deals: number;
  /** Closed-set commission sum in EUR (0053), or null when the rep has no commission row. */
  commissionSumEur: number | null;
  /**
   * Closed-set deal count from 0053 — the Ø Deal denominator. Excludes cancelled
   * deals, so it can differ from `deals` after a Widerruf; using it (not `deals`)
   * keeps team Ø Deal = Σ commission / Σ commissionDeals numerator-consistent.
   */
  commissionDeals: number | null;
  /** Ø Deal = commission_sum / deals_count (0053, null-safe), or null when absent. */
  avgDealEur: number | null;
}

export const REPORTING_KPIS_KEY = ['reporting', 'kpis'] as const;
export const REPORTING_WEEK_KEY = ['reporting', 'deals-per-week'] as const;
export const REPORTING_REP_KEY = ['reporting', 'deals-per-rep'] as const;

async function fetchKpis(): Promise<ReportingKpis> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('reporting_kpis')
    .select('active_contracts, active_reps, avg_contracts_per_rep')
    .maybeSingle();
  if (error) {
    throw error;
  }
  return {
    activeContracts: Number(data?.active_contracts ?? 0),
    activeReps: Number(data?.active_reps ?? 0),
    avgContractsPerRep: Number(data?.avg_contracts_per_rep ?? 0),
  };
}

interface WeekRow {
  week_start: string;
  iso_year: number;
  iso_week: number;
  deals_count: number;
}

async function fetchDealsPerWeek(): Promise<DealsPerWeek[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('reporting_deals_per_week')
    .select('week_start, iso_year, iso_week, deals_count')
    .order('week_start', { ascending: true });
  if (error) {
    throw error;
  }
  return ((data ?? []) as unknown as WeekRow[]).map((r) => ({
    weekStart: r.week_start,
    isoYear: r.iso_year,
    isoWeek: r.iso_week,
    deals: Number(r.deals_count),
  }));
}

interface RepRow {
  rep_id: string;
  rep_name: string | null;
  deals_count: number;
}

interface CommissionRepRow {
  rep_id: string;
  commission_sum_eur: number | string | null;
  deals_count: number | string | null;
}

/** Per-rep accumulator while collapsing the (team_id, rep_id) grain to rep_id. */
interface RepAcc {
  repName: string | null;
  deals: number;
  commissionSum: number;
  commissionDeals: number;
  hasCommission: boolean;
}

async function fetchDealsPerRep(): Promise<DealsPerRep[]> {
  const supabase = getSupabase();
  const [dealsRes, commissionRes] = await Promise.all([
    supabase.from('reporting_deals_per_rep').select('rep_id, rep_name, deals_count'),
    supabase.from('reporting_commission_per_rep').select('rep_id, commission_sum_eur, deals_count'),
  ]);
  if (dealsRes.error) {
    throw dealsRes.error;
  }
  if (commissionRes.error) {
    throw commissionRes.error;
  }
  // Both 0048 (reporting_deals_per_rep) and 0053 (reporting_commission_per_rep)
  // are grouped by (team_id, rep_id): a rep visible in more than one team appears
  // in multiple rows. Collapse to one row per rep_id (summing both closed sets)
  // so no commission is dropped and every rendered row has a unique, stable key.
  const byRep = new Map<string, RepAcc>();
  const acc = (repId: string): RepAcc => {
    let a = byRep.get(repId);
    if (!a) {
      a = { repName: null, deals: 0, commissionSum: 0, commissionDeals: 0, hasCommission: false };
      byRep.set(repId, a);
    }
    return a;
  };
  for (const r of (dealsRes.data ?? []) as unknown as RepRow[]) {
    const a = acc(r.rep_id);
    a.deals += Number(r.deals_count);
    a.repName = a.repName ?? r.rep_name;
  }
  for (const c of (commissionRes.data ?? []) as unknown as CommissionRepRow[]) {
    const a = acc(c.rep_id);
    a.commissionSum += Number(c.commission_sum_eur ?? 0);
    a.commissionDeals += Number(c.deals_count ?? 0);
    a.hasCommission = true;
  }
  const rows: DealsPerRep[] = [...byRep.entries()].map(([repId, a]) => ({
    repId,
    repName: a.repName,
    deals: a.deals,
    commissionSumEur: a.hasCommission ? a.commissionSum : null,
    commissionDeals: a.hasCommission ? a.commissionDeals : null,
    // Recompute Ø Deal from the aggregated sums so it stays sum/count-consistent
    // across teams (per-team avg_deal_eur values are not average-able).
    avgDealEur: a.hasCommission && a.commissionDeals > 0 ? a.commissionSum / a.commissionDeals : null,
  }));
  // Fixed alphabetical order by rep name so a categorical hue follows the entity,
  // never the rank (Data Visualization Contract — team comparison chart).
  return rows.sort((a, b) =>
    (a.repName ?? '').localeCompare(b.repName ?? '', 'de', { sensitivity: 'base' }),
  );
}

export function useReportingKpis() {
  const { session } = useSession();
  return useQuery({
    queryKey: REPORTING_KPIS_KEY,
    queryFn: fetchKpis,
    enabled: Boolean(session?.user.id),
  });
}

export function useDealsPerWeek() {
  const { session } = useSession();
  return useQuery({
    queryKey: REPORTING_WEEK_KEY,
    queryFn: fetchDealsPerWeek,
    enabled: Boolean(session?.user.id),
  });
}

export function useDealsPerRep() {
  const { session } = useSession();
  return useQuery({
    queryKey: REPORTING_REP_KEY,
    queryFn: fetchDealsPerRep,
    enabled: Boolean(session?.user.id),
  });
}
