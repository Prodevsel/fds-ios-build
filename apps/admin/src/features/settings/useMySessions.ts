import { getSupabase } from '@/lib/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

/**
 * Admin session-list data layer (SEC-06, D-23). A thin wrapper over the SAME
 * two `public.list_my_sessions()` / `public.revoke_my_session(uuid)`
 * SECURITY DEFINER RPCs the mobile app's `sessionsRepo.ts` already consumes
 * (plan 14-01, `supabase/migrations/0077_my_sessions_rpc.sql`). D-23 is
 * explicit that admin ships additional UI over this already-proven
 * foundation — this file writes NO new RPC, no elevated-role call, and no
 * admin-only variant.
 *
 * Revocation-latency bound (D-05/D-07, mirrored verbatim from the mobile
 * sibling): the mutating RPC deletes the caller's own session row, which
 * cascades to the row that backs future token refreshes — but an
 * already-issued access token in a device's memory stays valid up to
 * `jwt_expiry` (900s / 15 minutes). No caller of this hook may render or
 * imply an instant-cutoff claim; `sessions.revokingState`/
 * `sessions.latencyExplainer` (SessionsTab.tsx) are the honest copy this
 * bound requires.
 *
 * IDOR-safe silent no-op (D-13): the mutating RPC's own delete predicate is
 * scoped to the target session id AND the caller's own identity, and never
 * raises when zero rows match — a call against a session that does not
 * belong to the caller produces the identical resolved outcome as a call
 * against a nonexistent id. A resolved `revoke()` promise therefore does NOT
 * prove the target session belonged to the caller; only a subsequent list
 * refresh that no longer returns the row proves it — this hook always
 * refetches after a successful revoke rather than trusting the resolved
 * promise alone.
 *
 * No client-side re-filtering by caller identity anywhere in this file: the
 * RPC is already scoped server-side, and duplicating that scoping here would
 * put the same authorization rule in a second place (CLAUDE.md SSOT).
 */

/** Mirrors `list_my_sessions()`'s real returned column set exactly — D-14
 *  forbids inventing a friendly device label, a geo/IP-derived place, a
 *  parsed client/agent name, or a guessed platform field. A type that cannot
 *  express those fields prevents a later screen from quietly adding one. */
export interface AdminSessionRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Nullable in the live schema — rendered verbatim, never a parsed device name. */
  userAgent: string | null;
  /** Nullable in the live schema (clean address text, no netmask) — the UI shows `sessions.ipUnavailable` when null. */
  ip: string | null;
  /** Nullable in the live schema — `auth.sessions.refreshed_at` stays NULL
   *  until a session's FIRST token refresh (i.e. for the first ~15 minutes of
   *  every brand-new session). The UI falls back to `createdAt` for the
   *  "Zuletzt aktiv" column; a row is never dropped over it. */
  refreshedAt: string | null;
  /** Nullable in the live schema — GoTrue only populates
   *  `auth.sessions.not_after` when session timeboxing is configured, and
   *  `supabase/config.toml`'s `[auth.sessions].timebox` is deliberately unset,
   *  so this is NULL for every session this project creates. Never rendered
   *  (14-UI-SPEC.md forbids surfacing it); kept only because it is part of the
   *  RPC's real column set. */
  notAfter: string | null;
  /** UX-ONLY (derived from a JWT claim comparison) — NEVER a security boundary. Selects a confirmation tier, never an authorization outcome. */
  isCurrent: boolean;
}

/** Raw shape returned by `supabase.rpc('list_my_sessions')` — snake_case, unknown-typed until parsed. */
interface RawSessionRow {
  id?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  user_agent?: unknown;
  ip?: unknown;
  refreshed_at?: unknown;
  not_after?: unknown;
  is_current?: unknown;
}

/**
 * Pure parser: narrows a raw RPC row into an `AdminSessionRow`, or `null` if
 * it fails a required-field/type guard. A row missing `id` or with a
 * non-boolean `is_current` is DROPPED, not coerced — matches the mobile
 * sibling's "drop rather than guess" discipline so the two clients cannot
 * drift in what they claim about a malformed row. Nullable `user_agent`/`ip`/
 * `refreshed_at`/`not_after` (only `id`/`user_id` are `not null` on
 * `auth.sessions`) parse successfully as `null` — guarding on the two
 * timestamps would drop EVERY real row, since GoTrue leaves `not_after` NULL
 * whenever session timeboxing is unset (which it is here) and `refreshed_at`
 * NULL until the first token refresh.
 */
export function parseAdminSessionRow(raw: RawSessionRow): AdminSessionRow | null {
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null;
  if (typeof raw.created_at !== 'string') return null;
  if (typeof raw.updated_at !== 'string') return null;
  if (typeof raw.is_current !== 'boolean') return null;
  const userAgent = typeof raw.user_agent === 'string' ? raw.user_agent : null;
  const ip = typeof raw.ip === 'string' ? raw.ip : null;
  const refreshedAt = typeof raw.refreshed_at === 'string' ? raw.refreshed_at : null;
  const notAfter = typeof raw.not_after === 'string' ? raw.not_after : null;

  return {
    id: raw.id,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    userAgent,
    ip,
    refreshedAt,
    notAfter,
    isCurrent: raw.is_current,
  };
}

function parseAdminSessionRows(rows: readonly RawSessionRow[]): AdminSessionRow[] {
  const parsed: AdminSessionRow[] = [];
  for (const row of rows) {
    const session = parseAdminSessionRow(row);
    if (session) parsed.push(session);
  }
  return parsed;
}

const QUERY_KEY = ['admin-my-sessions'];

async function fetchMySessions(): Promise<AdminSessionRow[]> {
  const { data, error } = await getSupabase().rpc('list_my_sessions');
  if (error) {
    throw error;
  }
  // Newest-first ordering comes from the RPC's own `order by ... desc`
  // clause (plan 14-01) — no client-side re-sort.
  return parseAdminSessionRows((data as RawSessionRow[] | null) ?? []);
}

export interface UseMySessionsResult {
  sessions: AdminSessionRow[];
  isLoading: boolean;
  isError: boolean;
  /** Ids currently mid-revoke — a row stays visible in the "ending" state
   *  while its id is a member, regardless of whether the list refetch still
   *  returns it (see the file header's honesty note). */
  revokingIds: ReadonlySet<string>;
  /** Set when the most recent `revoke()` call failed (network/offline) — the
   *  affected row's revoking mark is cleared so it never gets stuck showing
   *  "Wird beendet" after a failure that never reached the server. */
  revokeError: boolean;
  revoke: (id: string) => Promise<void>;
}

/** The signed-in operator's own sessions (list) plus the revoke mutation, over the SAME shared RPCs mobile consumes. */
export function useMySessions(): UseMySessionsResult {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchMySessions,
  });

  const [revokingIds, setRevokingIds] = React.useState<ReadonlySet<string>>(new Set());
  const [revokeError, setRevokeError] = React.useState(false);

  const revoke = React.useCallback(
    async (id: string) => {
      setRevokeError(false);
      setRevokingIds((prev) => new Set(prev).add(id));
      try {
        const { error } = await getSupabase().rpc('revoke_my_session', { p_session_id: id });
        if (error) {
          throw error;
        }
        // Honest bound (D-07): the row is not removed here. The next
        // refetch either still returns it (15-minute latency window — the
        // row stays visible in the revoking state) or no longer returns it
        // (genuinely gone) — this hook never assumes the latter from a
        // resolved promise alone.
        await query.refetch();
      } catch {
        setRevokeError(true);
        setRevokingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [query],
  );

  React.useEffect(() => {
    return () => {
      void queryClient.cancelQueries({ queryKey: QUERY_KEY });
    };
  }, [queryClient]);

  return {
    sessions: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    revokingIds,
    revokeError,
    revoke,
  };
}
