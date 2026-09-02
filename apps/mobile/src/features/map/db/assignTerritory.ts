import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '../../../lib/auth/supabase';

/**
 * assignTerritory — direct `assign_territory` RPC helper (TASGN-01/02).
 *
 * Iron Rule 1 governs the sales happy path (offline-first PowerSync writes)
 * only. Assigning/clearing a territory's rep is a LEAD control-plane action
 * on a table that is READ-ONLY, SERVER/RPC-WRITTEN ONLY on-device
 * (territory_assignments — Plan 02's schema.ts doc comment): the write flows
 * exclusively through this direct RPC call, mirroring the same
 * getSupabase()-direct-call precedent as useRoleScope/useSessionIdentity and
 * this plan's useMarkFirstSync — NEVER through the connector's upload path
 * or CRUD transaction queue.
 */

/** Mirrors 0061_territory_assignments.sql's assign_territory() return values. */
export type AssignVerdict = 'assigned' | 'not_entitled' | 'not_team_member' | 'not_activated';

export interface CreateAssignTerritoryOptions {
  /** Injectable for tests (a spy client); defaults to the real getSupabase() singleton. */
  supabase?: Pick<SupabaseClient, 'rpc'>;
}

export interface AssignTerritory {
  /**
   * Calls `assign_territory(p_territory_id, p_rep_id)` and returns the
   * discriminated verdict verbatim — a non-'assigned' verdict is a normal
   * RETURN VALUE (not thrown), so the caller maps it to inline copy. Only a
   * genuine transport/network failure throws. `repId: null` clears the
   * assignment (a real server-side DELETE, 0061).
   */
  assignTerritory(territoryId: string, repId: string | null): Promise<AssignVerdict>;
}

/**
 * Injectable options-object DI (mirrors housesRepo.ts/territoriesRepo.ts's
 * style — never a module-level singleton), wrapping the direct Supabase RPC
 * call instead of the PowerSync db handle those repos wrap.
 */
export function createAssignTerritory(options: CreateAssignTerritoryOptions = {}): AssignTerritory {
  const supabase = options.supabase ?? getSupabase();

  return {
    async assignTerritory(territoryId, repId) {
      const { data, error } = await supabase.rpc('assign_territory', {
        p_territory_id: territoryId,
        p_rep_id: repId,
      });
      if (error) throw error;
      return data as AssignVerdict;
    },
  };
}
