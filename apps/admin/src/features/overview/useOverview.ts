import type { OnboardingStatus } from '@/features/companies/useCompanies';
import { getSupabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';

/**
 * Übersicht (operator dashboard) data layer.
 *
 * The admin SPA reads Supabase directly through the anon/RLS client (every read
 * below still passes visible_companies()/visible_contracts() RLS — this is a
 * presentation aggregation, never an access-control authority). The dashboard's
 * live sources per the 1:1 design:
 *   - active-companies count + onboarding funnel  ← companies.onboarding_status (0047)
 *   - signed-contracts trend + KPI + delta        ← contract_status_events 'signed' (0034)
 *   - "Verträge nach Unternehmen" team bars        ← contracts grouped by company (0001)
 *   - "Letzte Aktivität" feed                      ← recent status events + new companies
 *   - "Provision (MTD)" KPI                        ← reporting_commission_mtd (0053)
 *   - "Webhook-Zustellrate" KPI                    ← operator_webhook_delivery_rate (0056)
 *
 * The commission + webhook-rate views are security_invoker (0053/0056), so they
 * inherit the caller's visible_companies()/visible_contracts() scope like every
 * other read here — a presentation aggregation, never an access-control authority.
 */

/** Range toggle values (7 / 30 / 90 Tage) — number of days back from now. */
export type RangeDays = 7 | 30 | 90;

export interface OverviewCompany {
  id: string;
  name: string;
  onboarding_status: OnboardingStatus;
  created_at: string;
}

export interface StatusEvent {
  id: string;
  company_id: string;
  event_type: 'signed' | 'cancelled';
  occurred_at: string;
}

export interface OverviewData {
  /** Every company visible to the operator (newest first). */
  companies: OverviewCompany[];
  /** signed + cancelled events within the selected range (ascending by time). */
  events: StatusEvent[];
  /** signed-event count in the immediately preceding equal-length window (delta base). */
  previousSignedCount: number;
  /** company_id for every visible contract (all-time) — counted client-side for team bars. */
  contractCompanyIds: string[];
  /** Month-to-date confirmed commission in EUR (Widerrufsfrist passed), 0053. */
  commissionConfirmedEur: number;
  /** Month-to-date commission still inside the 14-day withdrawal window, 0053. */
  commissionPendingEur: number;
  /** Webhook delivered/(delivered+dead_letter) as a 0..1 fraction, or null when no events (0056). */
  webhookDeliveryRate: number | null;
}

const DAY_MS = 86_400_000;

async function fetchOverview(days: RangeDays): Promise<OverviewData> {
  const supabase = getSupabase();
  const now = Date.now();
  const startISO = new Date(now - days * DAY_MS).toISOString();
  const prevStartISO = new Date(now - 2 * days * DAY_MS).toISOString();

  const [companiesRes, eventsRes, prevRes, contractsRes, commissionRes, webhookRateRes] =
    await Promise.all([
      supabase
        .from('companies')
        .select('id, name, onboarding_status, created_at')
        .order('created_at', { ascending: false }),
      supabase
        .from('contract_status_events')
        .select('id, company_id, event_type, occurred_at')
        .gte('occurred_at', startISO)
        .order('occurred_at', { ascending: true }),
      supabase
        .from('contract_status_events')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'signed')
        .gte('occurred_at', prevStartISO)
        .lt('occurred_at', startISO),
      supabase.from('contracts').select('company_id'),
      // security_invoker single-row scalar views (0053 / 0056) — RLS-scoped.
      supabase.from('reporting_commission_mtd').select('confirmed_eur, pending_eur').maybeSingle(),
      supabase.from('operator_webhook_delivery_rate').select('delivery_rate').maybeSingle(),
    ]);

  if (companiesRes.error) {
    throw companiesRes.error;
  }
  if (eventsRes.error) {
    throw eventsRes.error;
  }
  if (prevRes.error) {
    throw prevRes.error;
  }
  if (contractsRes.error) {
    throw contractsRes.error;
  }
  if (commissionRes.error) {
    throw commissionRes.error;
  }
  if (webhookRateRes.error) {
    throw webhookRateRes.error;
  }

  const commission = (commissionRes.data ?? null) as {
    confirmed_eur: number | string | null;
    pending_eur: number | string | null;
  } | null;
  const webhookRate = (webhookRateRes.data ?? null) as { delivery_rate: number | string | null } | null;

  return {
    companies: (companiesRes.data ?? []) as OverviewCompany[],
    events: (eventsRes.data ?? []) as StatusEvent[],
    previousSignedCount: prevRes.count ?? 0,
    contractCompanyIds: ((contractsRes.data ?? []) as { company_id: string }[]).map(
      (row) => row.company_id,
    ),
    commissionConfirmedEur: Number(commission?.confirmed_eur ?? 0),
    commissionPendingEur: Number(commission?.pending_eur ?? 0),
    webhookDeliveryRate:
      webhookRate?.delivery_rate == null ? null : Number(webhookRate.delivery_rate),
  };
}

export function useOverview(days: RangeDays) {
  return useQuery({
    queryKey: ['overview', days],
    queryFn: () => fetchOverview(days),
  });
}
