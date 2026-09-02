import type { AbstractPowerSyncDatabase } from '@powersync/common';

/**
 * Local-SQLite write/read path for team-lead territory boundary drawing
 * (MAP-04). Mirrors housesRepo.ts's injectable-options-object DI style — no
 * module-level singleton, only ever touches the PowerSync `db` handle passed
 * in (02-PATTERNS.md housesRepo/territoriesRepo role-match analog).
 *
 * `submitBoundary` is a LOCAL-ONLY write to `territories.boundary` (Iron Rule
 * 1: PowerSync is the only network data path — never a direct
 * `supabase.rpc`/`supabase.from` call from this repo). The connector's
 * `applyTerritoryOperation` (02-04) recognizes a PATCH that touches only the
 * `boundary` column and routes it to the `create_territory_boundary()` RPC
 * instead of the `lock_territory()` path; a server denial
 * ('invalid_geometry' | 'not_entitled') is surfaced via `onConflict` and the
 * optimistic local write is reverted there — this repo never sees that
 * round-trip, it only ever performs the local write.
 */

export interface CreateTerritoriesRepoOptions {
  db: AbstractPowerSyncDatabase;
}

/** A territory row visible to the team lead, regardless of boundary/lock state. */
export interface AssignableTerritoryRow {
  id: string;
  team_id: string;
  name: string;
  locked_by: string | null;
  /** Raw GeoJSON text (or null if no boundary drawn yet) — parse before rendering. */
  boundary: string | null;
}

interface RawAssignableTerritoryRecord {
  id: string;
  team_id: string;
  name: string;
  locked_by: string | null;
  boundary: string | null;
}

const ASSIGNABLE_TERRITORIES_QUERY = `
  SELECT id, team_id, name, locked_by, boundary FROM territories
`;

function toAssignableTerritoryRow(record: RawAssignableTerritoryRecord): AssignableTerritoryRow {
  return {
    id: record.id,
    team_id: record.team_id,
    name: record.name,
    locked_by: record.locked_by,
    boundary: record.boundary,
  };
}

export interface TerritoriesRepo {
  /**
   * Draw-mode submit (MAP-04): local-only PATCH of `territories.boundary`
   * only — never bundled with any other column (the connector rejects a
   * boundary PATCH that also touches `locked_by`/`locked_at`, see
   * connector.ts `applyTerritoryOperation`). `boundary` is stored as GeoJSON
   * text, matching schema.ts's `boundary: column.text` mapping.
   */
  submitBoundary(
    territoryId: string,
    boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  ): Promise<void>;
  /**
   * Reactive query over every territory currently visible to this session
   * (RLS/sync-stream visibility already scopes this to the team lead's own
   * team — no extra client-side team_id filter needed). Includes territories
   * with no boundary yet, so callers can find "assigned but not yet drawn"
   * targets. Returns an unsubscribe function, mirrors housesRepo.watchHouses.
   */
  watchAssignableTerritories(
    onChange: (territories: AssignableTerritoryRow[]) => void,
    onError?: (error: unknown) => void,
  ): () => void;
}

/**
 * Injectable repo (options-object DI, matching housesRepo.ts/attachments
 * queue.ts's style — never a module-level singleton) wrapping the PowerSync
 * db handle.
 */
export function createTerritoriesRepo(options: CreateTerritoriesRepoOptions): TerritoriesRepo {
  const { db } = options;

  return {
    async submitBoundary(territoryId, boundary) {
      await db.execute('UPDATE territories SET boundary = ? WHERE id = ?', [
        JSON.stringify(boundary),
        territoryId,
      ]);
    },

    watchAssignableTerritories(onChange, onError) {
      const controller = new AbortController();
      db.watch(
        ASSIGNABLE_TERRITORIES_QUERY,
        [],
        {
          onResult: (result) => {
            const rows = (result.rows?._array ?? []) as RawAssignableTerritoryRecord[];
            onChange(rows.map(toAssignableTerritoryRow));
          },
          onError: (error) => onError?.(error),
        },
        { signal: controller.signal },
      );
      return () => controller.abort();
    },
  };
}
