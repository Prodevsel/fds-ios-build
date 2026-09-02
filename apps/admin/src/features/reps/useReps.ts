import { useSession } from '@/lib/auth/useSession';
import { getSupabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';

/**
 * Rep roster + provisioning data layer (ADMN-01 / ONBD-02).
 *
 * The admin SPA talks to Supabase through the anon/RLS client only (the
 * service-role key is Edge-Function-only, T-05-30) — so the membership rows
 * come from exactly what a team lead may read under RLS: `memberships` of the
 * team(s) they lead (visible_memberships, 0002) joined to the teammate
 * profile in `app_users` (name + `first_synced_at`). Auth-confirmation state
 * lives in `auth.users`, which is NOT readable from this client, so it is
 * fetched from the `rep-roster` Edge Function (D-02) — a caller-scoped,
 * service-role read, never client-side.
 *
 * ROOT-CAUSE FIX (D-06): this used to hardcode every membership row as
 * `status: 'active'` regardless of confirmation state, because `memberships`
 * rows are created at INVITE time (0046 trigger), not at confirmation time —
 * a freshly-invited, never-opened-the-email rep looked identical to an active
 * one. The fix is a truthful 3-state derivation (`deriveRepStatus`): the
 * confirmed flag (rep-roster) and `first_synced_at` (server-computed facts)
 * are the authority; only the 3-way label mapping happens client-side.
 */

export type RepStatus = 'invited' | 'activated' | 'synced' | 'removed';

export interface Rep {
  /** Membership id for persisted rows; a synthetic `invited:<email>` id otherwise. */
  id: string;
  /** The underlying `app_users.id` (auth user id) — distinct from `id` above
   *  (the membership row id). Added for plan 15-12: `device_wipe_orders
   *  .device_owner_rep_id` (0079) references `app_users(id)`, not a
   *  membership id, so a caller resolving a wipe order's rep display name
   *  needs this field to join without a second roster query. `null` for
   *  locally-optimistic invited rows, which have no persisted membership yet. */
  userId: string | null;
  /** Profile display name (null until the rep completes their profile). */
  name: string | null;
  /** Provisioned role id (`rep` | `team_lead`). */
  role: string;
  status: RepStatus;
  /** Only known for locally-optimistic invited rows (from the invite form). */
  email?: string;
}

export const REPS_QUERY_KEY = ['reps', 'roster'] as const;

interface MembershipRow {
  id: string;
  user_id: string;
  role_id: string;
  app_users: { full_name: string | null; first_synced_at: string | null } | null;
}

interface RepRosterEntry {
  id: string;
  confirmed: boolean;
  last_sign_in_at: string | null;
}

/**
 * Pure 3-state derivation (ONBD-02), independently testable:
 *   invited   := NOT confirmed
 *   activated := confirmed AND first_synced_at IS NULL
 *   synced    := confirmed AND first_synced_at IS NOT NULL
 * `removed` is left unused here — no deactivation path exists this phase
 * (out of scope); it is never produced by this function.
 */
export function deriveRepStatus(confirmed: boolean, firstSyncedAt: string | null): RepStatus {
  if (!confirmed) {
    return 'invited';
  }
  return firstSyncedAt === null ? 'activated' : 'synced';
}

async function fetchReps(): Promise<Rep[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('memberships')
    .select('id, user_id, role_id, app_users(full_name, first_synced_at)')
    .order('created_at', { ascending: true });
  if (error) {
    throw error;
  }
  const rows = (data ?? []) as unknown as MembershipRow[];
  if (rows.length === 0) {
    return [];
  }

  // rep-roster is caller-scoped to exactly the same managed set this
  // `memberships` query already returns under RLS (D-02).
  const { data: rosterData, error: rosterError } = await supabase.functions.invoke('rep-roster');
  if (rosterError) {
    throw rosterError;
  }
  const confirmedMap = new Map<string, boolean>();
  for (const entry of ((rosterData as { reps?: RepRosterEntry[] } | null)?.reps ?? [])) {
    confirmedMap.set(entry.id, entry.confirmed);
  }

  return rows.map((m) => ({
    id: m.id,
    userId: m.user_id,
    name: m.app_users?.full_name ?? null,
    role: m.role_id,
    status: deriveRepStatus(confirmedMap.get(m.user_id) ?? false, m.app_users?.first_synced_at ?? null),
  }));
}

/** Team roster for the signed-in team lead. */
export function useReps() {
  const { session } = useSession();
  const enabled = Boolean(session?.user.id);
  return useQuery({
    queryKey: REPS_QUERY_KEY,
    queryFn: fetchReps,
    enabled,
  });
}

/**
 * The team id the signed-in user leads — required as the `team_id` the invite
 * Edge Function validates the caller's authority against. Resolved via RLS
 * (`teams.lead_id = auth.uid()`), never trusted from client input elsewhere.
 */
export function useLeadTeamId() {
  const { session } = useSession();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['reps', 'lead-team', userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<string | null> => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('teams')
        .select('id')
        .eq('lead_id', userId as string)
        // THE COMPANY-TEAM TRAP (T-gti-08). `operator_create_company`
        // (0057:83-84) sets `teams.lead_id = auth.uid()` on the COMPANY team it
        // bootstraps, purely so the operator can see the company they just
        // created. Without this filter, any operator who has ever run the
        // company wizard resolves to that company team — and the rep invite
        // then SUCCEEDS, silently filing the rep into a team with no
        // territories and no sales organisation. No error, no message, a
        // broken account that looks like a success. A sales-org team is the
        // only kind a rep or a lead belongs in.
        .not('sales_org_id', 'is', null)
        // A lead can lead more than one team. Without an ORDER BY, Postgres is
        // free to return a different one on any given call — the invite dialog
        // would then put a rep into whichever team came back that time. Oldest
        // first makes it at least deterministic; a team picker is the real fix.
        // ponytail: oldest-led-team, add a picker when a lead runs several.
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) {
        throw error;
      }
      return data?.id ?? null;
    },
  });
}

/** A sales-org team the signed-in user may administer or invite into. */
export interface AdministrableTeam {
  id: string;
  name: string;
  leadId: string | null;
}

/**
 * Every SALES-ORG team the signed-in user can see — the set the team selector
 * and the "Teamleitung festlegen" card operate on.
 *
 * NO client-side scoping by org membership: `teams_select` (0003) already
 * scopes this read to `visible_teams(auth.uid())`, and MAND-02 puts that rule
 * in Postgres, not here. The `sales_org_id is not null` filter is a different
 * kind of thing and is legitimate: it is not an authorization rule but "which
 * teams is this control FOR". Offering a company team in a picker would make
 * the trap documented in `useLeadTeamId` easier to walk into, not harder —
 * and `set_team_lead` (0091) would reject it anyway, since
 * `is_org_admin_for_team` joins on `sales_org_id`.
 */
export function useAdministrableTeams() {
  const { session } = useSession();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['reps', 'administrable-teams', userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<AdministrableTeam[]> => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('teams')
        .select('id, name, lead_id')
        .not('sales_org_id', 'is', null)
        .order('name', { ascending: true });
      if (error) {
        throw error;
      }
      const rows = (data ?? []) as unknown as {
        id: string;
        name: string | null;
        lead_id: string | null;
      }[];
      return rows.map((row) => ({
        id: row.id,
        name: row.name ?? '',
        leadId: row.lead_id ?? null,
      }));
    },
  });
}

/** A person who may be named the lead of a given team. */
export interface TeamCandidate {
  id: string;
  name: string;
}

/**
 * The members of `teamId` — exactly the people `set_team_lead` (0091) will
 * accept, since a team member is by construction inside
 * `visible_app_users(auth.uid())` for anyone who administers that team.
 * Offering anyone else would produce a 42501 the operator cannot act on.
 */
export function useTeamCandidates(teamId: string | null) {
  return useQuery({
    queryKey: ['reps', 'team-candidates', teamId],
    enabled: Boolean(teamId),
    queryFn: async (): Promise<TeamCandidate[]> => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('memberships')
        .select('user_id, app_users(full_name)')
        .eq('team_id', teamId as string)
        .order('created_at', { ascending: true });
      if (error) {
        throw error;
      }
      const rows = (data ?? []) as unknown as {
        user_id: string;
        app_users: { full_name: string | null } | null;
      }[];
      return rows.map((row) => ({
        id: row.user_id,
        name: row.app_users?.full_name ?? row.user_id,
      }));
    },
  });
}
