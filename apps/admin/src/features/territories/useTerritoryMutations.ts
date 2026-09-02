import { getSupabase } from '@/lib/supabase';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { GeoJsonPolygon } from './polygon';
import { ASSIGNMENTS_QUERY_KEY, TERRITORIES_QUERY_KEY } from './useTerritoryData';

/**
 * Write layer for the Gebiete screen.
 *
 * WHY RPCs AND NOT PLAIN TABLE WRITES — verified against the live database,
 * not assumed:
 *
 *  - `territories` grants the `authenticated` role SELECT and INSERT only.
 *    There is no UPDATE grant and no UPDATE policy at all, so a PATCH from
 *    this SPA comes back `42501 permission denied for table territories`.
 *    Setting a boundary therefore HAS to go through
 *    `create_territory_boundary` (0018), which is SECURITY DEFINER, re-derives
 *    the caller's entitlement, and validates the ring with `ST_IsValid`.
 *  - `territory_assignments` has a SELECT policy and nothing else, so the
 *    assignment write HAS to go through `assign_territory` (0061).
 *
 * WHY THE CLIENT MINTS THE TERRITORY UUID — `INSERT … RETURNING` on
 * `territories` is rejected under RLS: the SELECT policy calls the STABLE
 * `visible_territories()`, which runs on the statement's own snapshot and so
 * cannot see the row the same statement is inserting. Asking PostgREST for the
 * inserted representation therefore fails with an RLS violation even though
 * the INSERT itself is allowed. Generating the id here means the follow-up
 * boundary RPC needs no read-back. (See the report accompanying this change —
 * this is a database-side defect, worked around client-side rather than
 * papered over.)
 */

/** Discriminated verdicts both territory RPCs answer with. */
export type TerritoryVerdict =
  | 'created'
  | 'assigned'
  | 'not_entitled'
  | 'not_team_member'
  | 'not_activated'
  | 'invalid_geometry';

const VERDICTS: readonly TerritoryVerdict[] = [
  'created',
  'assigned',
  'not_entitled',
  'not_team_member',
  'not_activated',
  'invalid_geometry',
];

/** A non-success RPC verdict, carried as an error so react-query surfaces it. */
export class TerritoryVerdictError extends Error {
  readonly verdict: TerritoryVerdict | 'unknown';
  constructor(verdict: TerritoryVerdict | 'unknown') {
    super(`territory RPC verdict: ${verdict}`);
    this.name = 'TerritoryVerdictError';
    this.verdict = verdict;
  }
}

function asVerdict(value: unknown): TerritoryVerdict | 'unknown' {
  return typeof value === 'string' && (VERDICTS as readonly string[]).includes(value)
    ? (value as TerritoryVerdict)
    : 'unknown';
}

/**
 * i18n key (within the `territories` namespace) for a failed write. Pure and
 * total: an unrecognised verdict maps to the generic key rather than being
 * dropped, so a future RPC verdict can never fail silently.
 */
export function verdictMessageKey(error: unknown): string {
  if (error instanceof TerritoryVerdictError && error.verdict !== 'unknown') {
    return `verdict.${error.verdict}`;
  }
  return 'verdict.unknown';
}

export interface CreateTerritoryInput {
  name: string;
  teamId: string;
  /** Copied verbatim from the team — the INSERT policy re-checks both. */
  companyId: string | null;
  salesOrgId: string | null;
  boundary: GeoJsonPolygon;
}

/**
 * Create a named territory and give it a boundary: one INSERT (RLS-checked)
 * followed by the boundary RPC (entitlement + `ST_IsValid`).
 *
 * These two steps are NOT atomic and cannot be made so from the client. If the
 * RPC rejects the ring, the territory row survives with a null boundary and
 * there is no DELETE policy to undo it — which is exactly why `draftToPolygon`
 * refuses a self-intersecting draft before this mutation is ever called.
 */
export function useCreateTerritory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTerritoryInput): Promise<string> => {
      const supabase = getSupabase();
      const id = crypto.randomUUID();

      const { error: insertError } = await supabase.from('territories').insert({
        id,
        name: input.name,
        team_id: input.teamId,
        company_id: input.companyId,
        sales_org_id: input.salesOrgId,
      });
      if (insertError) {
        throw insertError;
      }

      const { data, error } = await supabase.rpc('create_territory_boundary', {
        p_territory_id: id,
        p_boundary: input.boundary,
      });
      if (error) {
        throw error;
      }
      const verdict = asVerdict(data);
      if (verdict !== 'created') {
        throw new TerritoryVerdictError(verdict);
      }
      return id;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TERRITORIES_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['territories', 'houses'] });
    },
  });
}

export interface AssignTerritoryInput {
  territoryId: string;
  /** `null` clears the assignment (the RPC does a real DELETE). */
  repId: string | null;
}

/**
 * Assign, reassign or unassign a territory via `assign_territory`.
 *
 * This deliberately does NOT touch `territories.locked_by`. Migration 0061's
 * own rationale (decision D-04) rejected putting the assignee on `territories`
 * because that table syncs team-wide, which would leak the assignee to every
 * teammate; `locked_by` is documented there as "a transient draw/claim-session
 * lock", a different fact with a different lifetime. Writing it from here
 * would re-introduce the leak the schema was shaped to avoid — and is in any
 * case impossible without a new SECURITY DEFINER function, since
 * `authenticated` holds no UPDATE grant on `territories`.
 */
export function useAssignTerritory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AssignTerritoryInput): Promise<void> => {
      const { data, error } = await getSupabase().rpc('assign_territory', {
        p_territory_id: input.territoryId,
        p_rep_id: input.repId,
      });
      if (error) {
        throw error;
      }
      const verdict = asVerdict(data);
      if (verdict !== 'assigned') {
        throw new TerritoryVerdictError(verdict);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ASSIGNMENTS_QUERY_KEY });
    },
  });
}
