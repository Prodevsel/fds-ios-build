import { useSession } from '@/lib/auth/useSession';
import { getSupabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { type GeoJsonPolygon, asGeoJsonPolygon } from './polygon';
import type { HouseStatus } from '@/design/tokens';

/**
 * Read layer for the Gebiete screen.
 *
 * Every query below is a plain anon-key/RLS read — the same authority the rest
 * of apps/admin uses. Scoping comes from the database, never from a client-side
 * filter: `visible_territories` / `visible_houses` (migration 0002) already
 * restrict what a team lead may see, and `territory_assignments` has its own
 * assignee+lead-only policy (0061). So these queries are deliberately
 * unfiltered by team — adding a `.eq('team_id', …)` here would only duplicate,
 * and could silently disagree with, the policy that actually decides.
 */

/** A team the signed-in user is the recorded lead of (`teams.lead_id`). */
export interface LedTeam {
  id: string;
  name: string;
  /** Exactly one of these is non-null (`teams` CHECK num_nonnulls = 1). */
  companyId: string | null;
  salesOrgId: string | null;
}

export interface Territory {
  id: string;
  name: string;
  teamId: string;
  /** `null` for a territory that exists but has never been drawn. */
  boundary: GeoJsonPolygon | null;
  /**
   * `territories.locked_by` — the TRANSIENT claim/draw-session lock a rep takes
   * from their device via `lock_territory`, NOT the durable assignment. Kept
   * separate here because it genuinely is a separate fact; see
   * `useTerritoryMutations.ts` for why this screen never writes it.
   */
  lockedBy: string | null;
}

export interface House {
  id: string;
  /** `houses.address` is nullable — never substitute a placeholder. */
  address: string | null;
  status: HouseStatus;
  lat: number;
  lon: number;
  territoryId: string | null;
}

export interface TeamMember {
  userId: string;
  /** `app_users.full_name` is null until the rep completes their profile. */
  name: string | null;
  roleId: string;
  teamId: string;
}

/** One row of `territory_assignments` — at most one per territory (unique). */
export interface TerritoryAssignment {
  territoryId: string;
  assignedRepId: string;
}

export const TERRITORIES_QUERY_KEY = ['territories', 'list'] as const;
export const ASSIGNMENTS_QUERY_KEY = ['territories', 'assignments'] as const;

const HOUSE_STATUSES: readonly HouseStatus[] = [
  'new',
  'not_home',
  'follow_up',
  'no_interest',
  'blacklist',
  'success',
];

function asHouseStatus(value: unknown): HouseStatus | null {
  return typeof value === 'string' && (HOUSE_STATUSES as readonly string[]).includes(value)
    ? (value as HouseStatus)
    : null;
}

interface TeamRow {
  id: string;
  name: string;
  company_id: string | null;
  sales_org_id: string | null;
}

interface TerritoryRow {
  id: string;
  name: string;
  team_id: string;
  locked_by: string | null;
  boundary: unknown;
}

interface HouseRow {
  id: string;
  address: string | null;
  status: string;
  lat: number;
  lon: number;
  territory_id: string | null;
}

interface MembershipRow {
  user_id: string;
  role_id: string;
  team_id: string;
  app_users: { full_name: string | null } | null;
}

interface AssignmentRow {
  territory_id: string;
  assigned_rep_id: string;
}

/**
 * The teams the signed-in user leads. Resolved via RLS (`teams.lead_id =
 * auth.uid()`), and needed for more than an id: creating a territory has to
 * copy the team's `company_id`/`sales_org_id` verbatim, because the
 * `territories_insert_by_team` policy re-checks that the new row's owner
 * columns are NOT DISTINCT FROM the team's.
 */
export function useLedTeams() {
  const { session } = useSession();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['territories', 'led-teams', userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<LedTeam[]> => {
      const { data, error } = await getSupabase()
        .from('teams')
        .select('id, name, company_id, sales_org_id')
        .eq('lead_id', userId as string)
        .order('name', { ascending: true });
      if (error) {
        throw error;
      }
      return ((data ?? []) as TeamRow[]).map((row) => ({
        id: row.id,
        name: row.name,
        companyId: row.company_id,
        salesOrgId: row.sales_org_id,
      }));
    },
  });
}

/** Every territory the caller may see, drawn or not. */
export function useTerritories() {
  const { session } = useSession();
  return useQuery({
    queryKey: TERRITORIES_QUERY_KEY,
    enabled: Boolean(session?.user.id),
    queryFn: async (): Promise<Territory[]> => {
      const { data, error } = await getSupabase()
        .from('territories')
        .select('id, name, team_id, locked_by, boundary')
        .order('name', { ascending: true });
      if (error) {
        throw error;
      }
      return ((data ?? []) as TerritoryRow[]).map((row) => ({
        id: row.id,
        name: row.name,
        teamId: row.team_id,
        lockedBy: row.locked_by,
        boundary: asGeoJsonPolygon(row.boundary),
      }));
    },
  });
}

/**
 * Every house the caller may see. Rows whose `status` is not one of the four
 * values the CHECK constraint allows are dropped rather than coerced to a
 * default — an unknown status must not silently render as "neu".
 */
export function useHouses() {
  const { session } = useSession();
  return useQuery({
    queryKey: ['territories', 'houses'],
    enabled: Boolean(session?.user.id),
    queryFn: async (): Promise<House[]> => {
      const { data, error } = await getSupabase()
        .from('houses')
        .select('id, address, status, lat, lon, territory_id')
        // 0088: the territory overview shows BUILDINGS, not doors. Without
        // this filter every party of a multi-party building would count as a
        // house of its own on the map and in every total derived from it.
        // parent_house_id stays out of the select list — nothing renders it.
        .is('parent_house_id', null);
      if (error) {
        throw error;
      }
      const houses: House[] = [];
      for (const row of (data ?? []) as HouseRow[]) {
        const status = asHouseStatus(row.status);
        if (status === null) {
          continue;
        }
        houses.push({
          id: row.id,
          address: row.address,
          status,
          lat: row.lat,
          lon: row.lon,
          territoryId: row.territory_id,
        });
      }
      return houses;
    },
  });
}

/** Memberships of every team the caller can see, with the profile display name. */
export function useTeamMembers() {
  const { session } = useSession();
  return useQuery({
    queryKey: ['territories', 'members'],
    enabled: Boolean(session?.user.id),
    queryFn: async (): Promise<TeamMember[]> => {
      const { data, error } = await getSupabase()
        .from('memberships')
        .select('user_id, role_id, team_id, app_users(full_name)');
      if (error) {
        throw error;
      }
      return ((data ?? []) as unknown as MembershipRow[]).map((row) => ({
        userId: row.user_id,
        name: row.app_users?.full_name ?? null,
        roleId: row.role_id,
        teamId: row.team_id,
      }));
    },
  });
}

/** Current territory→rep assignments, keyed by territory id. */
export function useTerritoryAssignments() {
  const { session } = useSession();
  return useQuery({
    queryKey: ASSIGNMENTS_QUERY_KEY,
    enabled: Boolean(session?.user.id),
    queryFn: async (): Promise<TerritoryAssignment[]> => {
      const { data, error } = await getSupabase()
        .from('territory_assignments')
        .select('territory_id, assigned_rep_id');
      if (error) {
        throw error;
      }
      return ((data ?? []) as AssignmentRow[]).map((row) => ({
        territoryId: row.territory_id,
        assignedRepId: row.assigned_rep_id,
      }));
    },
  });
}
