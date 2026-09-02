import type { HouseStatus } from '../../design/tokens';
import type { BlacklistRow, HouseRow } from './db/housesRepo';

/**
 * Pure rollup of a multi-party building (0088_houses_units.sql): a building is
 * a `houses` row with `parent_house_id IS NULL`, a party (Partei) is a
 * `houses` row pointing at it.
 *
 * Deliberately a pure, exported module and NOT component logic: the mobile
 * test harness has no `react-test-renderer`, so anything that only exists
 * inside a component cannot be asserted. Everything decidable about a pin
 * lives here.
 *
 * No React, no imports from components, no database access — the caller
 * supplies the rows.
 */

/** Maximum parties per building, mirroring the 0088 `unit_count` CHECK. */
export const MAX_UNITS_PER_BUILDING = 200;

export interface BuildingRollup {
  /** The status the pin renders. NEVER `houses.status` once parties exist. */
  status: HouseStatus;
  /** Untouched doors ('new' parties). `null` for a building with no parties. */
  openUnits: number | null;
  hasUnits: boolean;
}

/**
 * The rank order for a building's derived status, fixed and in this order:
 *
 *   0. no parties       -> pass the building's own status straight through.
 *                          THE backward-compatibility guarantee: every house in
 *                          the running demo is party-less and must render
 *                          exactly the pin it rendered before 0088. This is
 *                          checked first, ahead of everything, so no later rule
 *                          can reach a party-less house at all.
 *   1. no-solicitation  -> 'blacklist'. Legally binding; beats every open door.
 *   2. any 'follow_up'  -> 'follow_up'. A date beats a colour.
 *   3. any 'new'        -> 'new'. Doors are still open — a signed deal is a
 *                          hint, not a full stop. This is the green-pin-with-a-
 *                          number case seen from the data side.
 *   4. any 'not_home'   -> 'not_home'. Nobody answered THERE, so the building
 *                          is still work in hand — just not untouched work.
 *                          Below 'new' because an untouched door is the
 *                          stronger claim on the rep's next hour.
 *   5. any 'success'    -> 'success'. Every remaining party is terminal and at
 *                          least one of them signed.
 *   6. otherwise        -> 'no_interest'. Every party terminal, nobody signed.
 *
 * Rank 5/6 used to be a single rank returning 'success' whenever every party
 * was terminal — which rendered a building where twelve parties said no as a
 * green closed deal, and fed it into the day's `deals` counter
 * (MapScreen.tsx:1736). Terminal is not the same as sold.
 *
 * `openUnits` counts only 'new' parties: a party with an appointment is
 * accounted for, not open. A locked building reports 0 — nothing there is open.
 *
 * `unit_count` is NOT consulted here. A doorbell-panel number without party
 * rows behind it is not an open door (no invented data).
 */
export function deriveBuildingStatus(input: {
  building: Pick<HouseRow, 'id' | 'status'>;
  units: Pick<HouseRow, 'status'>[];
  noSolicitation: boolean;
}): BuildingRollup {
  const { building, units, noSolicitation } = input;

  // Rank 0 — the party-less short-circuit.
  if (units.length === 0) {
    return { status: building.status, openUnits: null, hasUnits: false };
  }

  // Rank 1 — a lock on the building beats everything below it.
  if (noSolicitation) {
    return { status: 'blacklist', openUnits: 0, hasUnits: true };
  }

  const openUnits = units.filter((u) => u.status === 'new').length;
  // 'not_home' is deliberately NOT counted as open: the rep already stood
  // there. It is work in hand, which rank 4 expresses through the colour, not
  // through the "X of N doors open" denominator.

  // Rank 2 — an appointment.
  if (units.some((u) => u.status === 'follow_up')) {
    return { status: 'follow_up', openUnits, hasUnits: true };
  }

  // Rank 3 — at least one door untouched.
  if (openUnits > 0) {
    return { status: 'new', openUnits, hasUnits: true };
  }

  // Rank 4 — nobody answered, but the door is not done with.
  if (units.some((u) => u.status === 'not_home')) {
    return { status: 'not_home', openUnits, hasUnits: true };
  }

  // Rank 5 — every party terminal and at least one signed.
  if (units.some((u) => u.status === 'success')) {
    return { status: 'success', openUnits: 0, hasUnits: true };
  }

  // Rank 6 — every party terminal, nobody signed. Not green, and not the legal
  // lock either (rank 1 already caught that): a plain no.
  return { status: 'no_interest', openUnits: 0, hasUnits: true };
}

/**
 * Whether a building carries a no-solicitation lock (Sperrvermerk), from the
 * two places one can be recorded today.
 *
 * The second condition — the building's own status being 'blacklist' — is not
 * belt-and-braces. Before 0104 the map UI wrote a lock as `status = 'blacklist'`
 * PLUS a `blacklist_entries` row whose `reason` was pre-filled to the WRONG
 * value, 'not_interested' (`addBlacklistEntry`, housesRepo). If rank 1 listened
 * only for `reason === 'no_solicitation'`, every such legacy lock would
 * silently fall back to "open" the moment the rep adds the first party — a
 * weakening of the strongest rule in the set. Both sources therefore count.
 *
 * From 0104 on the two sources agree (the repo writes 'no_solicitation'), which
 * makes this rule stronger rather than redundant: the status check is what
 * carries the pre-0104 rows, and it must stay for as long as any of them exist
 * — which, on an INSERT-ONLY table, is forever.
 *
 * What it deliberately does NOT do is treat 'no_interest' as a lock. A polite
 * no carries no legal consequence (§ 7 UWG covers the FORM of advertising, not
 * its content) and must stay revisitable — that is the entire point of 0103.
 */
export function hasNoSolicitationLock(
  entries: Pick<BlacklistRow, 'house_id' | 'reason'>[],
  buildingId: string,
  buildingStatus: HouseStatus,
): boolean {
  if (buildingStatus === 'blacklist') {
    return true;
  }
  return entries.some((e) => e.house_id === buildingId && e.reason === 'no_solicitation');
}

/**
 * Parties keyed by their building, each group ordered by `created_at` ascending
 * and stable for equal timestamps (rows created in the same millisecond keep
 * their input order, so the list does not shuffle between renders).
 *
 * Rows without a parent are skipped — a building never groups itself.
 */
export function groupUnitsByParent(units: HouseRow[]): Map<string, HouseRow[]> {
  const grouped = new Map<string, HouseRow[]>();
  for (const unitRow of units) {
    const parentId = unitRow.parent_house_id;
    if (parentId === null) {
      continue;
    }
    const bucket = grouped.get(parentId);
    if (bucket) {
      bucket.push(unitRow);
    } else {
      grouped.set(parentId, [unitRow]);
    }
  }
  // Array.prototype.sort is stable per spec, so equal created_at keeps order.
  for (const bucket of grouped.values()) {
    bucket.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  }
  return grouped;
}

export interface UnitSyncPlan {
  /** How many party rows to INSERT to reach the doorbell-panel count. */
  createCount: number;
  /**
   * ALWAYS EMPTY — see the note on `planUnitSync`. Kept in the shape so the
   * emptiness is visible at every call site rather than merely absent.
   */
  deleteIds: string[];
}

/**
 * Turns "the doorbell panel says 12" into the rows to create.
 *
 * There is no delete half, and that is a finding rather than a shortcut:
 *
 *   * 0016 grants only select/insert/update on `houses` — there is no server
 *     DELETE policy, so a deletion cannot be authorised at all, and
 *   * `connector.ts`'s `applyHousesOperation` has exactly two arms, PATCH and
 *     PUT. A local DELETE op would fall through into the PUT arm and
 *     re-INSERT the very row it was meant to remove.
 *
 * So lowering the number lowers the number and nothing else. A party that has
 * been knocked on keeps existing — which is also the behaviour one wants: a
 * miscounted panel must never be able to erase a recorded result.
 *
 * `createCount` is clamped to [0, MAX_UNITS_PER_BUILDING] so a mistyped count
 * cannot push thousands of rows into the upload queue (T-N0F-03; the 0088
 * CHECK is the server-side half of the same cap).
 */
export function planUnitSync(existingUnits: HouseRow[], desiredCount: number): UnitSyncPlan {
  const desired = normalizeUnitCount(desiredCount);
  return { createCount: Math.max(desired - existingUnits.length, 0), deleteIds: [] };
}

/**
 * The doorbell-panel number as it may be stored and acted on: a whole number in
 * [0, MAX_UNITS_PER_BUILDING]. Anything unreadable (empty field, NaN, negative)
 * is zero — never an unbounded create loop (T-N0F-03).
 */
export function normalizeUnitCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(Math.trunc(value), 0), MAX_UNITS_PER_BUILDING);
}
