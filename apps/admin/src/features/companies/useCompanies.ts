import { getSupabase } from '@/lib/supabase';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Companies + concierge-onboarding data layer (ADMN-02).
 *
 * The admin SPA talks to Supabase through the anon/RLS client only. A company's
 * onboarding lifecycle (0047) is `onboarding_status` (draft → onboarding →
 * active) plus a `wizard_step` resume pointer; the operator UPDATEs these (and
 * the company name) through the visible_companies()-scoped policy added in 0047.
 *
 * CREATION goes through the `operator-create-company` Edge Function (0057), NOT a
 * direct insert: `companies` has no INSERT policy/grant (0047 left self-service
 * creation closed), and a brand-new company would be invisible to its creator
 * anyway (visible_companies() derives from an existing team/contract). The Edge
 * Function calls the SECURITY DEFINER `operator_create_company()`, which inserts
 * the draft company AND bootstraps visibility (a dedicated company team led by
 * the operator) in one atomic, operator-only transaction.
 */

export type OnboardingStatus = 'draft' | 'onboarding' | 'active';

export interface Company {
  id: string;
  name: string;
  onboarding_status: OnboardingStatus;
  /** 0-based resume pointer; null once onboarding is complete. */
  wizard_step: number | null;
  /** Master data (0052) — progressive onboarding, all nullable. */
  legal_form: string | null;
  commercial_register_no: string | null;
  contact_name: string | null;
  contact_email: string | null;
  /** Closed-set signed-contract count for the "Verträge" column (0054/0053). */
  signed_contract_count: number;
  /** Closed-set commission sum in EUR (0054/0053) — feeds the firm-detail Provision tab. */
  commission_sum_eur: number;
}

export const COMPANIES_QUERY_KEY = ['companies', 'list'] as const;

interface CompaniesAdminRow {
  id: string;
  name: string;
  onboarding_status: OnboardingStatus;
  wizard_step: number | null;
  legal_form: string | null;
  commercial_register_no: string | null;
  contact_name: string | null;
  contact_email: string | null;
  signed_contract_count: number | string | null;
  commission_sum_eur: number | string | null;
}

async function fetchCompanies(): Promise<Company[]> {
  const supabase = getSupabase();
  // companies_admin_list (0054, security_invoker) = companies + master data (0052)
  // + signed_contract_count / commission_sum_eur (0053). RLS-scoped to the caller.
  const { data, error } = await supabase
    .from('companies_admin_list')
    .select(
      'id, name, onboarding_status, wizard_step, legal_form, commercial_register_no, contact_name, contact_email, signed_contract_count, commission_sum_eur',
    )
    .order('name', { ascending: true });
  if (error) {
    throw error;
  }
  return ((data ?? []) as unknown as CompaniesAdminRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    onboarding_status: r.onboarding_status,
    wizard_step: r.wizard_step,
    legal_form: r.legal_form,
    commercial_register_no: r.commercial_register_no,
    contact_name: r.contact_name,
    contact_email: r.contact_email,
    signed_contract_count: Number(r.signed_contract_count ?? 0),
    commission_sum_eur: Number(r.commission_sum_eur ?? 0),
  }));
}

export function useCompanies() {
  return useQuery({ queryKey: COMPANIES_QUERY_KEY, queryFn: fetchCompanies });
}

/**
 * Create a new company as a draft (wizard step 0) and return the row.
 *
 * Invokes the `operator-create-company` Edge Function (0057) rather than a direct
 * insert — see the module note. `functions.invoke` surfaces a non-2xx response as
 * a `FunctionsHttpError`, which the mutation throws so callers can drive an
 * `onError` path (the CTA has no other failure signal otherwise).
 */
export function useCreateCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string): Promise<Company> => {
      const supabase = getSupabase();
      const { data, error } = await supabase.functions.invoke<{
        id: string;
        name: string;
        onboarding_status: OnboardingStatus;
        wizard_step: number | null;
      }>('operator-create-company', {
        body: { name },
      });
      if (error) {
        throw error;
      }
      if (!data) {
        throw new Error('operator-create-company returned no company');
      }
      // A brand-new draft has no master data and no closed contracts yet.
      return {
        id: data.id,
        name: data.name,
        onboarding_status: data.onboarding_status,
        wizard_step: data.wizard_step,
        legal_form: null,
        commercial_register_no: null,
        contact_name: null,
        contact_email: null,
        signed_contract_count: 0,
        commission_sum_eur: 0,
      };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: COMPANIES_QUERY_KEY });
    },
  });
}

export interface OnboardingDraft {
  id: string;
  name?: string;
  onboarding_status: OnboardingStatus;
  /** null clears the resume pointer (onboarding complete). */
  wizard_step: number | null;
  /** Master data (0052) — pass null to clear, omit to leave unchanged. */
  legal_form?: string | null;
  commercial_register_no?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
}

/**
 * Persist a wizard draft/completion: name + onboarding_status + wizard_step +
 * the 0052 master-data columns (Rechtsform / Handelsregister-Nr. / Ansprechpartner
 * / E-Mail). Written through the same visible_companies()-scoped companies_update
 * policy (0047); contact_email is CHECK-validated server-side (0052).
 */
export function useSaveOnboarding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (draft: OnboardingDraft): Promise<void> => {
      const supabase = getSupabase();
      const patch: Record<string, unknown> = {
        onboarding_status: draft.onboarding_status,
        wizard_step: draft.wizard_step,
      };
      if (draft.name !== undefined) {
        patch.name = draft.name;
      }
      if (draft.legal_form !== undefined) {
        patch.legal_form = draft.legal_form;
      }
      if (draft.commercial_register_no !== undefined) {
        patch.commercial_register_no = draft.commercial_register_no;
      }
      if (draft.contact_name !== undefined) {
        patch.contact_name = draft.contact_name;
      }
      if (draft.contact_email !== undefined) {
        patch.contact_email = draft.contact_email;
      }
      const { error } = await supabase.from('companies').update(patch).eq('id', draft.id);
      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: COMPANIES_QUERY_KEY });
    },
  });
}

export interface CompanyProduct {
  id: string;
  slug: string;
  version: number;
}

/** Published products of a company — the rows the commission list references. */
export function useCompanyProducts(companyId: string | null) {
  return useQuery({
    queryKey: ['companies', 'products', companyId],
    enabled: Boolean(companyId),
    queryFn: async (): Promise<CompanyProduct[]> => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('product_definitions')
        .select('id, slug, version')
        .eq('company_id', companyId as string)
        .eq('status', 'published')
        .order('slug', { ascending: true });
      if (error) {
        throw error;
      }
      return (data ?? []) as CompanyProduct[];
    },
  });
}

export interface CommissionEntry {
  product_definition_id: string;
  rate: number | null;
  /** Optional — the wizard does not set one and the column default applies. */
  rate_type?: string | null;
}

/** A `commission_rates` row as it comes back from PostgREST. */
export interface ExistingCommissionRate {
  product_definition_id: string;
  /** Postgres `numeric` arrives as a JSON STRING — never compare it with ===. */
  rate: number | string | null;
  rate_type: string | null;
  created_at: string;
}

/** Normalise a rate for comparison: null/undefined collapse, numeric strings
 *  become numbers. PostgREST serialises `numeric` as a string, so '15.00' and
 *  15 are the SAME rate and must not read as an edit. */
function normaliseRate(rate: number | string | null | undefined): number | null {
  if (rate === null || rate === undefined || rate === '') {
    return null;
  }
  const parsed = typeof rate === 'number' ? rate : Number(rate);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * QUICK-GTI (Befund 5): which of `entries` actually differ from what is
 * already stored.
 *
 * Root cause of the duplication: `useSaveCommission` was a plain INSERT with
 * no notion of existing rows, and `commission_rates` carries no unique
 * constraint — so every pass through the wizard's final step appended a full
 * set of rows and the rate list grew without bound.
 *
 * WHY THE FIX IS A DIFF AND NOT A CONSTRAINT OR A REPLACE — do not "improve"
 * this into either:
 *  - `0049:37-42` records an explicit, reasoned decision NOT to add a unique
 *    index on (company_id, product_definition_id): the freeze is already
 *    deterministic by recency, and a unique index "would break the shipped
 *    Phase-5 admin write path (useSaveCommission does a plain INSERT -> would
 *    throw 23505 on any re-save), violating D-02's 'rates stay editable'".
 *  - A delete-then-insert replace is not even expressible: `0047:85-105`
 *    grants only select/insert/update and defines NO DELETE policy. There is
 *    no DELETE right to use.
 *
 * Append-on-change is therefore deliberate, not a shortcoming: the recency
 * history IS the mechanism `freeze_contract_commission` (0049:88-96) relies on
 * (`order by cr.created_at desc limit 1`). This function uses exactly that
 * same rule to decide what "current" means, so the UI and the freeze can never
 * disagree about which rate is in force.
 *
 * Pure and separately exported so it is testable without a Supabase client.
 */
export function diffCommissionEntries(
  existing: ExistingCommissionRate[],
  entries: CommissionEntry[],
): CommissionEntry[] {
  // Newest row per product, by created_at desc — the freeze's rule verbatim.
  const newest = new Map<string, ExistingCommissionRate>();
  for (const row of existing) {
    const current = newest.get(row.product_definition_id);
    if (!current || row.created_at > current.created_at) {
      newest.set(row.product_definition_id, row);
    }
  }

  return entries.filter((entry) => {
    if (!entry.product_definition_id) {
      return false;
    }
    const current = newest.get(entry.product_definition_id);
    if (!current) {
      return true;
    }
    if (normaliseRate(entry.rate) !== normaliseRate(current.rate)) {
      return true;
    }
    // Only compared when the caller actually names a rate_type: the wizard
    // does not, and comparing undefined against the column default would
    // report a change on every single save.
    if (entry.rate_type !== undefined && entry.rate_type !== current.rate_type) {
      return true;
    }
    return false;
  });
}

/**
 * Append-on-change insert of the commission list rows for a company (WALT-02).
 *
 * "Append-on-change" is deliberate and load-bearing, not a missing feature:
 * `freeze_contract_commission` (0049:88-96) resolves the current rate by
 * recency, so the history must keep growing when a rate genuinely changes.
 * What must NOT happen is a NO-OP re-save appending a duplicate set — see
 * `diffCommissionEntries` for why the fix is a diff rather than a unique index
 * (0049:37-42) or a delete-then-insert (0047 grants no DELETE).
 */
export function useSaveCommission() {
  return useMutation({
    mutationFn: async (input: { companyId: string; entries: CommissionEntry[] }): Promise<void> => {
      const supabase = getSupabase();

      // RLS already scopes this read via visible_companies (MAND-02) — no
      // client-side company filter beyond the query's own key.
      const { data: existing, error: readError } = await supabase
        .from('commission_rates')
        .select('product_definition_id, rate, rate_type, created_at')
        .eq('company_id', input.companyId);
      if (readError) {
        throw readError;
      }

      const changed = diffCommissionEntries(
        (existing ?? []) as unknown as ExistingCommissionRate[],
        input.entries,
      );

      const rows = changed.map((e) => ({
        company_id: input.companyId,
        product_definition_id: e.product_definition_id,
        rate: e.rate,
      }));
      // With the diff in place this early exit now ALSO means "nothing
      // changed", which is the whole point of the fix.
      if (rows.length === 0) {
        return;
      }
      const { error } = await supabase.from('commission_rates').insert(rows);
      if (error) {
        throw error;
      }
    },
  });
}

/**
 * Persist the per-company webhook target (0037). One row per company; since the
 * project bans ON CONFLICT on RLS tables, resolve insert-vs-update by a prior
 * read. A per-company HMAC-SHA256 signing secret is generated here.
 */
export function useSaveWebhook() {
  return useMutation({
    mutationFn: async (input: { companyId: string; targetUrl: string }): Promise<void> => {
      const supabase = getSupabase();
      const { data: existing, error: readError } = await supabase
        .from('webhook_config')
        .select('id')
        .eq('company_id', input.companyId)
        .maybeSingle();
      if (readError) {
        throw readError;
      }
      if (existing?.id) {
        const { error } = await supabase
          .from('webhook_config')
          .update({ target_url: input.targetUrl, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
        if (error) {
          throw error;
        }
        return;
      }
      const { error } = await supabase.from('webhook_config').insert({
        company_id: input.companyId,
        target_url: input.targetUrl,
        webhook_secret: generateWebhookSecret(),
      });
      if (error) {
        throw error;
      }
    },
  });
}

/** Cryptographically-random per-company webhook signing secret (hex). */
function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
