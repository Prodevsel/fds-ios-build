import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '../../../lib/auth/supabase';

/**
 * deletionRequestRepo — SEC-09: a thin, typed wrapper over the single
 * `request_account_deletion(p_note text)` SECURITY DEFINER RPC (plan 15-04,
 * `supabase/migrations/0081_deletion_requests.sql`).
 *
 * This call files a request that informs the organization. It deletes nothing
 * — not the account, not a session, not a contract — and the server-side
 * schema guarantees the last of those structurally (migration 0081 has no FK
 * to `contracts`, proven by pgTAP in plan 15-04). Signed contracts are
 * retained under § 257 HGB / § 147 AO regardless of this request; that
 * retention obligation outranks Art. 17 GDPR deletion for those rows.
 *
 * Deliberately performs NO direct table access of the `deletion_requests`
 * table at all (no query builder, no `.from(...)` call anywhere in this
 * file) — the table has no client write policy at all (0081's only write
 * path is the RPC below, `security definer`), and reading it from the
 * device is out of scope for this phase (it is an operator/back-office
 * concern, read via the two RLS-scoped `deletion_requests_select`
 * predicates by a team lead/org-admin, never by this app). Do not add a
 * sync stream or a read path for this table here — 15-PATTERNS.md's
 * explicit instruction, mirroring `my_tenant_identity` (0078)/
 * `territory_assignments` (0061)'s same RPC-write/dashboard-read
 * disposition.
 *
 * Mirrors `sessionsRepo.ts`'s/`assignTerritory.ts`'s options-object DI
 * shape over a direct Supabase RPC call — this is a control-plane write
 * outside Iron Rule 1's local-SQLite path, never a PowerSync db handle.
 *
 * Outcome classification mirrors `performPasswordChange`'s (ChangePasswordScreen.tsx)
 * classify-network-vs-policy-rejection shape: a transport/network failure
 * (`'offline'`) is distinguishable from a genuine server-side rejection
 * (`'error'`) and from the RPC's own normal `'already_pending'` verdict,
 * so the screen can render something true in each case rather than one
 * generic error. `submit()` never throws — every failure mode resolves.
 */

/** Mirrors 0081_deletion_requests.sql's `request_account_deletion()` discriminated return values, plus this repo's own classified failure outcomes. */
export type DeletionRequestOutcome = 'recorded' | 'already_pending' | 'offline' | 'error';

const KNOWN_RPC_VERDICTS = new Set<string>(['recorded', 'already_pending']);

/**
 * Deliberately has ONLY `submit` — no read, update, or delete method. The
 * only write path this feature is allowed to perform (mirrors
 * `SessionsRepo`'s "exactly the operations this feature is allowed to
 * perform" discipline).
 */
export interface DeletionRequestRepo {
  /**
   * Calls `request_account_deletion(p_note)`. Never throws — every failure
   * mode is a resolved, classified outcome so the caller can render honest
   * copy for each one.
   */
  submit(note: string | null): Promise<DeletionRequestOutcome>;
}

export interface CreateDeletionRequestRepoOptions {
  /** Injectable for tests (a spy client); defaults to the real getSupabase() singleton. */
  supabase?: Pick<SupabaseClient, 'rpc'>;
}

/** Classifies a returned (non-thrown) PostgrestError-shaped RPC error as a transport/network failure vs. a genuine server-side rejection — mirrors `classifyAuthError`'s (LoginScreen.tsx) no-HTTP-response / message-keyword heuristic. */
function isNetworkError(error: { message?: unknown; status?: unknown; name?: unknown }): boolean {
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return (
    error.name === 'AuthRetryableFetchError' ||
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('failed to')
  );
}

/**
 * Injectable repo (options-object DI, mirrors `createSessionsRepo`/
 * `createAssignTerritory`).
 */
export function createDeletionRequestRepo(
  options: CreateDeletionRequestRepoOptions = {},
): DeletionRequestRepo {
  const supabase = options.supabase ?? getSupabase();

  return {
    async submit(note) {
      try {
        const { data, error } = await supabase.rpc('request_account_deletion', { p_note: note });
        if (error) {
          return isNetworkError(error as { message?: unknown; status?: unknown; name?: unknown })
            ? 'offline'
            : 'error';
        }
        if (typeof data === 'string' && KNOWN_RPC_VERDICTS.has(data)) {
          return data as DeletionRequestOutcome;
        }
        // An unrecognized shape from the RPC is never trusted as 'recorded'
        // — a schema/contract drift must surface as an error, not a false
        // success.
        return 'error';
      } catch {
        // A thrown exception here means the request never reached the
        // server at all (e.g. a genuine fetch rejection on an offline
        // device) — never surfaced as a generic 'error'.
        return 'offline';
      }
    },
  };
}
