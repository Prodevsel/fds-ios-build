import type { AbstractPowerSyncDatabase } from '@powersync/common';

/**
 * Local-SQLite reactive read of a team's assignable reps (TASGN-01): the
 * synced read-only `memberships` table joined to the synced read-only,
 * NARROWLY-SCOPED `app_users` table (id + full_name only — D-03, Plan 02) for
 * the assignee picker's display name. Mirrors housesRepo.ts's injectable
 * options-object DI style — no module-level singleton, only ever touches the
 * PowerSync `db` handle passed in.
 *
 * Read-only: this repo never writes `memberships`/`app_users` (both are
 * READ-ONLY, SERVER-WRITTEN ONLY per schema.ts's doc comment; the connector
 * rejects any local write regardless).
 */

export interface AssignableRepRow {
  id: string;
  /** Falls back to a stable placeholder when the synced app_users row has no name yet. */
  fullName: string;
}

interface RawAssignableRepRecord {
  id: string;
  full_name: string | null;
}

/** Stable placeholder for a team member whose app_users row has no synced full_name yet. */
export const UNNAMED_REP_PLACEHOLDER = '—';

function toAssignableRepRow(record: RawAssignableRepRecord): AssignableRepRow {
  return {
    id: record.id,
    fullName: record.full_name?.trim() ? record.full_name : UNNAMED_REP_PLACEHOLDER,
  };
}

// Joins the team's memberships to app_users by id — the narrow app_users
// stream (id, full_name only) is exactly the projection the picker needs, no
// broader profile fetch (D-03/Pitfall 4). Parameterized on team_id (unlike
// useRoleScope's/housesRepo's param-less queries): the picker is scoped to
// one territory's team at a time.
const ASSIGNABLE_REPS_QUERY = `
  SELECT app_users.id AS id, app_users.full_name AS full_name
  FROM memberships
  JOIN app_users ON app_users.id = memberships.user_id
  WHERE memberships.team_id = ?
`;

export interface CreateAssignableRepsRepoOptions {
  db: AbstractPowerSyncDatabase;
}

export interface AssignableRepsRepo {
  /**
   * Reactive query over the given team's members joined to their synced
   * display names. Invokes `onChange` with the current row set immediately
   * and again on every underlying SQLite change (PowerSync's `db.watch`,
   * callback form). Returns an unsubscribe function, mirrors
   * housesRepo.watchHouses.
   */
  watchAssignableReps(
    teamId: string,
    onChange: (reps: AssignableRepRow[]) => void,
    onError?: (error: unknown) => void,
  ): () => void;
}

/**
 * Injectable repo (options-object DI, matching housesRepo.ts/
 * territoriesRepo.ts's style — never a module-level singleton) wrapping the
 * PowerSync db handle.
 */
export function createAssignableRepsRepo(options: CreateAssignableRepsRepoOptions): AssignableRepsRepo {
  const { db } = options;

  return {
    watchAssignableReps(teamId, onChange, onError) {
      const controller = new AbortController();
      db.watch(
        ASSIGNABLE_REPS_QUERY,
        [teamId],
        {
          onResult: (result) => {
            const rows = (result.rows?._array ?? []) as RawAssignableRepRecord[];
            onChange(rows.map(toAssignableRepRow));
          },
          onError: (error) => onError?.(error),
        },
        { signal: controller.signal },
      );
      return () => controller.abort();
    },
  };
}
