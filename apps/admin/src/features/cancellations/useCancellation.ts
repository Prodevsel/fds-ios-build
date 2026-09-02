import { getSupabase } from '@/lib/supabase';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Widerruf (withdrawal / Storno) recording data layer (D-18).
 *
 * A contract carries NO mutable status column (D-22) — post-signature status is an
 * APPEND-ONLY event stream in `contract_status_events` (0034). Recording a Widerruf
 * INSERTs one `cancelled` event (attributed to the caller via `recorded_by =
 * auth.uid()`, enforced by the insert policy); the table's BEFORE UPDATE/DELETE
 * triggers make it immutable (no edit/undo, T-05-38). The contract's derived status
 * is PROJECTED from these events here — never written back onto `contracts`. This is
 * the v1 manual source that feeds the `contract.cancelled` webhook via the outbox.
 */

/**
 * One search/detail row assembled by the cancellation_contract_detail view (0055,
 * security_invoker) — deal_reference + company/product/rep names, customer name,
 * commission amount, the computed 14-day withdrawal_deadline and the latest status.
 * customer_name is nullable (set by the mobile checkout at insert; a documented
 * follow-up), so the UI keeps an honest "—" when it is null.
 */
export interface ContractRow {
  id: string;
  company_id: string;
  deal_reference: string | null;
  company_name: string | null;
  product_name: string | null;
  rep_name: string | null;
  customer_name: string | null;
  commission_amount_eur: number | null;
  snapshot_door_price: number | null;
  signed_at: string | null;
  withdrawal_deadline: string | null;
  latest_status: 'signed' | 'cancelled' | null;
}

interface ContractDetailRow {
  contract_id: string;
  company_id: string;
  deal_reference: string | null;
  company_name: string | null;
  product_name: string | null;
  rep_name: string | null;
  customer_name: string | null;
  commission_amount_eur: number | string | null;
  snapshot_door_price: number | string | null;
  signed_at: string | null;
  withdrawal_deadline: string | null;
  latest_status: 'signed' | 'cancelled' | null;
}

function mapDetail(r: ContractDetailRow): ContractRow {
  return {
    id: r.contract_id,
    company_id: r.company_id,
    deal_reference: r.deal_reference,
    company_name: r.company_name,
    product_name: r.product_name,
    rep_name: r.rep_name,
    customer_name: r.customer_name,
    commission_amount_eur:
      r.commission_amount_eur == null ? null : Number(r.commission_amount_eur),
    snapshot_door_price: r.snapshot_door_price == null ? null : Number(r.snapshot_door_price),
    signed_at: r.signed_at,
    withdrawal_deadline: r.withdrawal_deadline,
    latest_status: r.latest_status,
  };
}

const DETAIL_COLS =
  'contract_id, company_id, deal_reference, company_name, product_name, rep_name, customer_name, commission_amount_eur, snapshot_door_price, signed_at, withdrawal_deadline, latest_status';

export type ContractStatusEventType = 'signed' | 'cancelled';

export interface ContractStatusEvent {
  id: string;
  event_type: ContractStatusEventType;
  occurred_at: string;
  reason: string | null;
}

/**
 * Search visible contracts by deal_reference via cancellation_contract_detail
 * (0055). The view is security_invoker, so visible_contracts RLS scopes results;
 * one query returns the customer/company/product/rep/deadline/status the search
 * table + detail card render (removes the per-row N+1 the design noted).
 */
export function useContractSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ['cancellations', 'contract-search', trimmed],
    enabled: trimmed.length > 0,
    queryFn: async (): Promise<ContractRow[]> => {
      const supabase = getSupabase();
      // Escape LIKE metacharacters so a literal % / _ / \ in the operator's query
      // is matched literally, not treated as a wildcard (backslash first).
      const escaped = trimmed.replace(/[\\%_]/g, (ch) => `\\${ch}`);
      const { data, error } = await supabase
        .from('cancellation_contract_detail')
        .select(DETAIL_COLS)
        .ilike('deal_reference', `%${escaped}%`)
        .order('signed_at', { ascending: false, nullsFirst: false })
        .limit(25);
      if (error) {
        throw error;
      }
      return ((data ?? []) as unknown as ContractDetailRow[]).map(mapDetail);
    },
  });
}

export const contractEventsQueryKey = (contractId: string | null) =>
  ['cancellations', 'events', contractId] as const;

/** The append-only status timeline for one contract (the derived-status source). */
export function useContractEvents(contractId: string | null) {
  return useQuery({
    queryKey: contractEventsQueryKey(contractId),
    enabled: Boolean(contractId),
    queryFn: async (): Promise<ContractStatusEvent[]> => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('contract_status_events')
        .select('id, event_type, occurred_at, reason')
        .eq('contract_id', contractId as string)
        .order('occurred_at', { ascending: true });
      if (error) {
        throw error;
      }
      return (data ?? []) as ContractStatusEvent[];
    },
  });
}

/** Derive the contract's current status from its event stream (cancelled is terminal). */
export function deriveStatus(events: ContractStatusEvent[]): 'signed' | 'cancelled' {
  return events.some((e) => e.event_type === 'cancelled') ? 'cancelled' : 'signed';
}

/**
 * Record a Widerruf: an append-only INSERT of a `cancelled` event. `recorded_by`
 * MUST equal the caller (auth.uid()) per the insert policy — there is no undo.
 */
export function useRecordCancellation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      contractId: string;
      companyId: string;
      reason: string | null;
    }): Promise<void> => {
      const supabase = getSupabase();
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user) {
        throw new Error('no session');
      }
      const { error } = await supabase.from('contract_status_events').insert({
        contract_id: input.contractId,
        company_id: input.companyId,
        event_type: 'cancelled',
        recorded_by: userData.user.id,
        reason: input.reason,
      });
      if (error) {
        throw error;
      }
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: contractEventsQueryKey(variables.contractId),
      });
    },
  });
}
