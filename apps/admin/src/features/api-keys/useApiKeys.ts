import { getSupabase } from '@/lib/supabase';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * API-key lifecycle data layer (API-01 / D-06).
 *
 * Key ISSUANCE goes through the `api-key-issue` Edge Function (reveal-once, the
 * plaintext is generated server-side and only its SHA-256 hash is persisted —
 * never mint a bearer secret client-side). LISTING + DEACTIVATION are ordinary
 * RLS reads/writes on `api_keys` (0035): the SPA sees only a company's masked
 * `key_prefix` + status, never a plaintext key. Deactivation is a status UPDATE
 * (active → revoked); rows are never deleted (audit trail retained). The DB
 * trigger `enforce_max_active_api_keys()` is the authoritative max-2 cap — the UI
 * disable is a convenience only (T-05-37).
 */

export type ApiKeyStatus = 'active' | 'revoked';

export interface ApiKey {
  id: string;
  key_prefix: string;
  label: string | null;
  status: ApiKeyStatus;
  created_at: string;
  revoked_at: string | null;
}

export const apiKeysQueryKey = (companyId: string | null) => ['api-keys', companyId] as const;

/** A company's keys (RLS-scoped): newest first, only masked prefixes are exposed. */
export function useApiKeys(companyId: string | null) {
  return useQuery({
    queryKey: apiKeysQueryKey(companyId),
    enabled: Boolean(companyId),
    queryFn: async (): Promise<ApiKey[]> => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('api_keys')
        .select('id, key_prefix, label, status, created_at, revoked_at')
        .eq('company_id', companyId as string)
        .order('created_at', { ascending: false });
      if (error) {
        throw error;
      }
      return (data ?? []) as ApiKey[];
    },
  });
}

// ---------------------------------------------------------------------------
// Operator cross-company mode (3.1) — operator_api_keys / operator_api_key_stats
// (0056, security_invoker). An operator owns many companies; these RLS-scoped
// aggregates re-present exactly what the per-company api_keys RLS already permits
// (prefix + status only, NEVER key_hash). Reveal-once creation stays per-company.
// ---------------------------------------------------------------------------

export const OPERATOR_API_KEYS_KEY = ['api-keys', 'operator'] as const;
export const OPERATOR_API_KEY_STATS_KEY = ['api-keys', 'operator-stats'] as const;

export interface OperatorApiKey extends ApiKey {
  company_id: string;
  company_name: string | null;
}

export interface OperatorApiKeyStats {
  activeCount: number;
  companiesCovered: number;
  revokedCount: number;
}

/** Every visible company's keys (cross-company), newest first. Masked prefix only. */
export function useOperatorApiKeys(enabled: boolean) {
  return useQuery({
    queryKey: OPERATOR_API_KEYS_KEY,
    enabled,
    queryFn: async (): Promise<OperatorApiKey[]> => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('operator_api_keys')
        .select('id, company_id, company_name, key_prefix, label, status, created_at, revoked_at')
        .order('created_at', { ascending: false });
      if (error) {
        throw error;
      }
      return (data ?? []) as unknown as OperatorApiKey[];
    },
  });
}

/** Operator stat cards: active count, companies covered, revoked count. */
export function useOperatorApiKeyStats(enabled: boolean) {
  return useQuery({
    queryKey: OPERATOR_API_KEY_STATS_KEY,
    enabled,
    queryFn: async (): Promise<OperatorApiKeyStats> => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('operator_api_key_stats')
        .select('active_count, companies_covered, revoked_count')
        .maybeSingle();
      if (error) {
        throw error;
      }
      const row = (data ?? null) as {
        active_count: number | string | null;
        companies_covered: number | string | null;
        revoked_count: number | string | null;
      } | null;
      return {
        activeCount: Number(row?.active_count ?? 0),
        companiesCovered: Number(row?.companies_covered ?? 0),
        revokedCount: Number(row?.revoked_count ?? 0),
      };
    },
  });
}

/** The one-time plaintext returned by the Edge Function at issuance. */
export interface IssuedKey {
  id: string;
  key: string;
  key_prefix: string;
  status: 'active';
}

/** Stable machine codes the dialog maps to the api-keys namespace error copy. */
export type IssueErrorCode = 'max_active' | 'unauthorized' | 'generic';

export class IssueError extends Error {
  constructor(readonly code: IssueErrorCode) {
    super(code);
    this.name = 'IssueError';
  }
}

/**
 * Mint a new key via the `api-key-issue` Edge Function. Returns the plaintext
 * ONCE (the caller shows it, then discards it). Maps the function's stable error
 * codes/HTTP statuses to UI codes — never surfaces a raw upstream string (V7).
 */
export function useIssueApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { companyId: string; label: string | null }): Promise<IssuedKey> => {
      const supabase = getSupabase();
      const { data, error } = await supabase.functions.invoke<IssuedKey>('api-key-issue', {
        body: { company_id: input.companyId, label: input.label ?? undefined },
      });
      if (error) {
        throw new IssueError(await mapIssueError(error));
      }
      if (!data?.key) {
        throw new IssueError('generic');
      }
      return data;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: apiKeysQueryKey(variables.companyId) });
      void queryClient.invalidateQueries({ queryKey: OPERATOR_API_KEYS_KEY });
      void queryClient.invalidateQueries({ queryKey: OPERATOR_API_KEY_STATS_KEY });
    },
  });
}

/** Deactivate (revoke) a key — status UPDATE, never a DELETE. */
export function useDeactivateApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { companyId: string; keyId: string }): Promise<void> => {
      const supabase = getSupabase();
      const { error } = await supabase
        .from('api_keys')
        .update({ status: 'revoked', revoked_at: new Date().toISOString() })
        .eq('id', input.keyId);
      if (error) {
        throw error;
      }
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: apiKeysQueryKey(variables.companyId) });
      // Keep the operator cross-company list + stats in sync after a revoke.
      void queryClient.invalidateQueries({ queryKey: OPERATOR_API_KEYS_KEY });
      void queryClient.invalidateQueries({ queryKey: OPERATOR_API_KEY_STATS_KEY });
    },
  });
}

/** Parse a functions.invoke error into a stable UI code (reads the JSON body). */
async function mapIssueError(error: unknown): Promise<IssueErrorCode> {
  // FunctionsHttpError carries a Response context whose body holds the machine code.
  const ctx = (error as { context?: { status?: number; clone?: () => Response } }).context;
  if (ctx?.clone) {
    const body = await ctx
      .clone()
      .json()
      .catch(() => null);
    if (body?.error === 'max_active') {
      return 'max_active';
    }
    if (ctx.status === 403) {
      return 'unauthorized';
    }
  }
  return 'generic';
}
