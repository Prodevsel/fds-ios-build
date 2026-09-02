import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '../../../lib/auth/supabase';

/**
 * sessionsRepo — SEC-06, D-11/D-12/D-13/D-14: a thin, typed wrapper over the
 * two `public.list_my_sessions()` / `public.revoke_my_session(uuid)`
 * SECURITY DEFINER RPCs (plan 14-01, `supabase/migrations/0077_my_sessions_rpc.sql`).
 *
 * Mirrors `assignTerritory.ts`/`useLeaderboard.ts`'s direct-`supabase.rpc` DI
 * shape (options-object DI, `Pick<SupabaseClient, 'rpc'>` injectable for
 * tests) rather than `settingsPolicyRepo.ts`'s PowerSync-`db` shape — session
 * rows are NOT synced data (Iron Rule 1 does not apply here the way it does
 * to `user_settings`/`tenant_setting_policies`; a session list is a live,
 * server-authoritative view, not something a rep edits offline).
 *
 * Revocation-latency bound (D-05/D-07): `revoke_my_session` deletes the
 * `auth.sessions` row, which cascades to `auth.refresh_tokens` and therefore
 * blocks all FUTURE token refreshes for that session — but an
 * already-issued access token already in a device's memory stays valid up
 * to `jwt_expiry` (900s / 15 minutes). No caller of this repo may render or
 * imply an INSTANT-revocation claim; `sessions.revokingState`/
 * `sessions.latencyExplainer` (SessionsScreen.tsx) are the honest copy this
 * bound requires.
 *
 * IDOR-safe silent no-op (D-13, `14-RESEARCH.md` Anti-Patterns): the RPC's
 * DELETE predicate is scoped to the target session id AND the caller's own
 * `auth.uid()` (see the 0077 migration for the exact SQL predicate) and
 * NEVER raises when zero rows match — a call against another user's
 * session id produces the identical outcome to a call against a
 * non-existent id. A resolved `revokeSession()` promise therefore does NOT
 * prove the target session belonged to the caller; only a subsequent
 * `listSessions()` that no longer returns the row proves it. The caller
 * (SessionsScreen.tsx) must refresh the list to learn the truth, never treat
 * "no error" as "that session was mine."
 *
 * No client-side filtering by user id anywhere in this file: both RPCs are
 * already scoped by `auth.uid()` inside their own SQL body, and re-filtering
 * here would duplicate an authorization rule in a second place (CLAUDE.md
 * SSOT, the same reasoning `settingsPolicyRepo.ts` records for its own
 * missing WHERE clause).
 */

/** Mirrors `list_my_sessions()`'s real returned column set (0077) exactly —
 * D-14 forbids inventing a friendly device label, a geo/IP-derived place, a
 * parsed client/agent name, or a guessed platform field. A type that
 * cannot express those fields prevents a later screen from quietly adding
 * one. */
export interface SessionRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Nullable in the live schema — the UI renders `sessions.userAgentCaption` verbatim, never a parsed device name. */
  userAgent: string | null;
  /** Nullable in the live schema (clean address text via `host(s.ip)`, no netmask) — the UI shows `sessions.ipUnavailable` when null. */
  ip: string | null;
  /** Nullable in the live schema — `auth.sessions.refreshed_at` stays NULL
   * until a session's FIRST token refresh (i.e. for the first ~15 minutes of
   * every brand-new session). The UI falls back to `createdAt` for
   * `sessions.lastActiveLabel`; a row is never dropped over it. */
  refreshedAt: string | null;
  /** Nullable in the live schema — GoTrue only populates
   * `auth.sessions.not_after` when session timeboxing is configured, and
   * `supabase/config.toml`'s `[auth.sessions].timebox` is deliberately unset,
   * so this is NULL for every session this project creates. Never rendered
   * (14-UI-SPEC.md forbids surfacing it); kept only because it is part of the
   * RPC's real column set. */
  notAfter: string | null;
  /** UX-ONLY (derived from the `session_id` JWT claim) — NEVER a security boundary. Selects a confirmation tier, never an authorization outcome (14-RESEARCH.md Anti-Patterns). */
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
 * Pure parser: narrows a raw RPC row into a `SessionRow`, or `null` if it
 * fails a required-field/type guard. A row missing `id` or with a
 * non-boolean `is_current` is DROPPED, not coerced — mirrors
 * `settingsPolicyRepo.ts`'s `parsePolicyRow` "drop rather than guess"
 * convention. `user_agent`/`ip`/`refreshed_at`/`not_after` are all nullable in
 * the live schema (only `id`/`user_id` are `not null` on `auth.sessions`) and
 * parse successfully as `null` — guarding on them would drop EVERY real row,
 * since GoTrue leaves `not_after` NULL whenever session timeboxing is unset
 * (which it is here) and `refreshed_at` NULL until the first token refresh.
 */
export function parseSessionRow(raw: RawSessionRow): SessionRow | null {
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

function parseSessionRows(rows: readonly RawSessionRow[]): SessionRow[] {
  const parsed: SessionRow[] = [];
  for (const row of rows) {
    const session = parseSessionRow(row);
    if (session) parsed.push(session);
  }
  return parsed;
}

export interface CreateSessionsRepoOptions {
  /** Injectable for tests (a spy client); defaults to the real getSupabase() singleton. */
  supabase?: Pick<SupabaseClient, 'rpc'>;
}

/**
 * Deliberately has ONLY `listSessions`/`revokeSession` — no update, no
 * insert, no "revoke all". Exactly the two operations this feature is
 * allowed to perform (D-14).
 */
export interface SessionsRepo {
  /** Calls `list_my_sessions()`, returns parsed rows in the RPC's own order (newest first, per the migration's `order by s.created_at desc`). Malformed rows are dropped, never guessed. */
  listSessions(): Promise<SessionRow[]>;
  /** Calls `revoke_my_session(p_session_id)`. Resolves on success (including the IDOR-safe silent no-op for someone else's id — see file header), rejects with a classified error on a network/transport failure. */
  revokeSession(id: string): Promise<void>;
}

/** Injectable repo (options-object DI, mirrors createAssignTerritory/createLeaderboardRepo). */
export function createSessionsRepo(options: CreateSessionsRepoOptions = {}): SessionsRepo {
  const supabase = options.supabase ?? getSupabase();

  return {
    async listSessions() {
      const { data, error } = await supabase.rpc('list_my_sessions');
      if (error) throw error;
      return parseSessionRows((data as RawSessionRow[] | null) ?? []);
    },

    async revokeSession(id) {
      const { error } = await supabase.rpc('revoke_my_session', { p_session_id: id });
      if (error) throw error;
    },
  };
}
