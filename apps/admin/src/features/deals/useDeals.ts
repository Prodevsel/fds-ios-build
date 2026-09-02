import { getSupabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';

/**
 * QUICK-F99 — the per-deal list behind `/abschluesse` and the document opener
 * next to each row.
 *
 * NO client-side scoping happens here, deliberately. `cancellation_contract_detail`
 * (0055) is `security_invoker`, so the caller's own `visible_contracts` RLS
 * decides which rows come back: a team lead gets their teams, an operator gets
 * their sales orgs, and neither is filtered in TypeScript (MAND-02 — the rule
 * lives in Postgres and nowhere else).
 *
 * The view's `cancellation_` prefix is a naming leftover from its first
 * consumer (the Widerruf screen). It is reused rather than duplicated on
 * purpose: it already assembles exactly the deal_reference / customer /
 * company / product / rep / signed_at / commission / latest_status a per-deal
 * row needs, and a second near-identical view would be a second thing to keep
 * correct.
 */

/** One individual closed deal as rendered by DealsPage. */
export interface DealRow {
  id: string;
  company_id: string;
  deal_reference: string | null;
  company_name: string | null;
  product_name: string | null;
  rep_name: string | null;
  customer_name: string | null;
  commission_amount_eur: number | null;
  signed_at: string | null;
  latest_status: 'signed' | 'cancelled' | null;
}

interface DealDetailRow {
  contract_id: string;
  company_id: string;
  deal_reference: string | null;
  company_name: string | null;
  product_name: string | null;
  rep_name: string | null;
  customer_name: string | null;
  commission_amount_eur: number | string | null;
  signed_at: string | null;
  latest_status: 'signed' | 'cancelled' | null;
}

const DETAIL_COLS =
  'contract_id, company_id, deal_reference, company_name, product_name, rep_name, customer_name, commission_amount_eur, signed_at, latest_status';

function mapDeal(r: DealDetailRow): DealRow {
  return {
    id: r.contract_id,
    company_id: r.company_id,
    deal_reference: r.deal_reference,
    company_name: r.company_name,
    product_name: r.product_name,
    rep_name: r.rep_name,
    customer_name: r.customer_name,
    commission_amount_eur: r.commission_amount_eur == null ? null : Number(r.commission_amount_eur),
    signed_at: r.signed_at,
    latest_status: r.latest_status,
  };
}

/**
 * QUICK-GTI (Befund 4): the document job's state, per contract.
 *
 * `render_jobs` is unreachable from any client by design (0038:79-89) and this
 * file never names it — `visible_contract_delivery_states` (0092) is the only
 * surface, and it decides what the caller may see via
 * `visible_contracts(auth.uid())`. Same rule as the deals query above: no
 * client-side scoping, no role branch (MAND-02).
 */
export type DeliveryStatus = 'pending' | 'delivered' | 'dead_letter';

export interface DeliveryState {
  contractId: string;
  status: DeliveryStatus;
  attempts: number;
  lastError: string | null;
  emailSentAt: string | null;
}

interface DeliveryStateRow {
  contract_id: string;
  delivery_status: DeliveryStatus;
  attempts: number | string | null;
  last_error: string | null;
  email_sent_at: string | null;
}

/**
 * One RPC call for the whole page, keyed by contract id.
 *
 * A contract absent from the map has NO render job — deliberately distinct
 * from a job that is pending, which is the distinction the operator was
 * missing in the first place. The caller renders the placeholder for absence,
 * never a guessed state.
 */
export function useDeliveryStates() {
  return useQuery({
    queryKey: ['deals', 'delivery-states'],
    queryFn: async (): Promise<Map<string, DeliveryState>> => {
      const supabase = getSupabase();
      const { data, error } = await supabase.rpc('visible_contract_delivery_states');
      if (error) {
        throw error;
      }
      const rows = (data ?? []) as unknown as DeliveryStateRow[];
      return new Map(
        rows.map((r) => [
          r.contract_id,
          {
            contractId: r.contract_id,
            status: r.delivery_status,
            attempts: r.attempts == null ? 0 : Number(r.attempts),
            lastError: r.last_error,
            emailSentAt: r.email_sent_at,
          },
        ]),
      );
    },
  });
}

/** The most recent visible deals, newest signature first. No filter, no role branch. */
export function useRecentDeals() {
  return useQuery({
    queryKey: ['deals', 'recent'],
    queryFn: async (): Promise<DealRow[]> => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('cancellation_contract_detail')
        .select(DETAIL_COLS)
        .order('signed_at', { ascending: false, nullsFirst: false })
        .limit(50);
      if (error) {
        throw error;
      }
      return ((data ?? []) as unknown as DealDetailRow[]).map(mapDeal);
    },
  });
}

/**
 * The same closed status set the app switches on (contractPdfAccess.ts), so
 * both clients can be equally honest per row: a wait, a failure and a missing
 * connection are three different things.
 */
export type DealPdfStatus = 'ready' | 'pending' | 'failed' | 'offline' | 'unavailable';

/** Signed URLs are bearer credentials — short-lived, never stored, never an href. */
const SIGNED_URL_TTL_SECONDS = 60;

/**
 * Resolves one deal's document and, when it is ready, opens it in a new tab.
 *
 * Authorization is `contract_pdf_artifact` (0089) — `visible_contracts` and
 * nothing else. Zero rows means "not visible or not there", which 0089 makes
 * deliberately indistinguishable, so this returns `unavailable` rather than
 * guessing. A thrown transport error is `offline`, never `failed`.
 */
export async function openDealPdf(contractId: string): Promise<DealPdfStatus> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('contract_pdf_artifact', {
      p_contract_id: contractId,
    });
    if (error) {
      return 'offline';
    }
    const row = ((data ?? []) as { artifact_status: string; pdf_path: string | null }[])[0];
    if (!row) {
      return 'unavailable';
    }
    if (row.artifact_status === 'pending') {
      return 'pending';
    }
    if (row.artifact_status !== 'ready' || !row.pdf_path) {
      return 'failed';
    }

    const { data: signed, error: signError } = await supabase.storage
      .from('contract-pdfs')
      .createSignedUrl(row.pdf_path, SIGNED_URL_TTL_SECONDS);
    if (signError || !signed?.signedUrl) {
      return 'offline';
    }
    window.open(signed.signedUrl, '_blank', 'noopener,noreferrer');
    return 'ready';
  } catch {
    return 'offline';
  }
}
