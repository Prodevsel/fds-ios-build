import type { AbstractPowerSyncDatabase } from '@powersync/common';
import * as Crypto from 'expo-crypto';
import type { HouseStatus } from '../../../design/tokens';

/**
 * Local-SQLite mirror of `houses` (0014_houses_and_blacklist.sql /
 * schema.ts). Read methods are 02-05 scope; write methods (tap-to-set-status,
 * MAP-02/MAP-05) are 02-06 scope, added below. `territory_id` is
 * server-computed (`assign_house_territory()` trigger, 0017) and never
 * client-authoritative — it is replicated down purely so the map can render
 * it, and is NEVER set by `insertHouseAtPoint` (RESEARCH.md Anti-Patterns:
 * client-supplied territory_id).
 *
 * All writes here are local-only (Iron Rule 1) — never a direct Supabase
 * call. Rows land in the CRUD upload queue and are drained by
 * `connector.ts`'s `applyHousesOperation`/`applyBlacklistOperation`
 * (LWW upsert / insert-only respectively) whenever the PowerSync connection
 * is up, mirroring `insertDemoRow`'s pattern in `useSkeletonFlow.ts`.
 */

/** Mirrors the `blacklist_entries.reason` check constraint (0014). */
/** 'not_interested' is DEPRECATED as of 0104 — legacy rows only, never written. */
export type BlacklistReason = 'no_solicitation' | 'not_interested';
export interface HouseRow {
  id: string;
  team_id: string;
  territory_id: string | null;
  lat: number;
  lon: number;
  status: HouseStatus;
  follow_up_at: string | null;
  /** Optional rep-authored memo (0060_houses_note.sql); null when unset. */
  note: string | null;
  /** Reverse-geocoded street address (0083); null until resolved. */
  address: string | null;
  /**
   * 0088: NULL means this row IS a building (the only shape that existed
   * before). Set means this row is a party (Partei) at that building.
   */
  parent_house_id: string | null;
  /**
   * 0088: POSITIONAL label of a party ("3. OG links") — never a name from the
   * Klingelschild. Personal data must not enter this synced column (the same
   * data-minimization stance that keeps every name field out of
   * `blacklist_entries`, 0014).
   */
  unit_label: string | null;
  /** 0088: parties on the doorbell panel. Only meaningful on a building row. */
  unit_count: number | null;
  created_by: string;
  created_at: string;
}

/**
 * Local-SQLite mirror of `blacklist_entries` (0014). Only the fields the
 * building rollup needs are consumed today (`buildingStatus.ts`); the shape
 * mirrors the table so a future reader does not have to re-derive it. There
 * is deliberately no name/email/phone field — that is a schema guarantee.
 */
export interface BlacklistRow {
  id: string;
  team_id: string;
  house_id: string | null;
  lat: number;
  lon: number;
  reason: BlacklistReason;
  created_by: string;
  created_at: string;
}

/** GeoJSON Point Feature for a house, ready for a MapLibre ShapeSource/Marker. */
export type HouseFeature = GeoJSON.Feature<GeoJSON.Point, HouseRow>;

interface RawHouseRecord {
  id: string;
  team_id: string;
  territory_id: string | null;
  lat: string;
  lon: string;
  status: string;
  follow_up_at: string | null;
  note: string | null;
  address: string | null;
  parent_house_id: string | null;
  unit_label: string | null;
  /** Numeric in Postgres, `string` out of SQLite like every other number here. */
  unit_count: string | null;
  created_by: string;
  created_at: string;
}

const HOUSE_COLUMNS =
  'id, team_id, territory_id, lat, lon, status, follow_up_at, note, address, parent_house_id, unit_label, unit_count, created_by, created_at';

/**
 * The one place `FROM houses` is written for buildings. `parent_house_id IS
 * NULL` sits here rather than at each call site so every existing consumer
 * (watchHouses, getHouses, the map, the street summary, the territory
 * overview) keeps meaning BUILDING where it says house — and a party is never
 * counted a second time as a house of its own (0088).
 */
const HOUSES_QUERY = `
  SELECT ${HOUSE_COLUMNS}
  FROM houses
  WHERE parent_house_id IS NULL
`;

/** The mirror image: parties only, in the order the rep created them. */
const UNITS_QUERY = `
  SELECT ${HOUSE_COLUMNS}
  FROM houses
  WHERE parent_house_id IS NOT NULL
  ORDER BY created_at
`;

function toHouseRow(record: RawHouseRecord): HouseRow {
  return {
    id: record.id,
    team_id: record.team_id,
    territory_id: record.territory_id,
    lat: Number(record.lat),
    lon: Number(record.lon),
    status: record.status as HouseStatus,
    follow_up_at: record.follow_up_at,
    note: record.note ?? null,
    address: record.address ?? null,
    parent_house_id: record.parent_house_id ?? null,
    unit_label: record.unit_label ?? null,
    // Null-safe on purpose: Number(null) is 0, which would claim a building
    // has zero parties when it simply has never been asked.
    unit_count: record.unit_count === null || record.unit_count === undefined ? null : Number(record.unit_count),
    created_by: record.created_by,
    created_at: record.created_at,
  };
}

function toHouseFeature(row: HouseRow): HouseFeature {
  return {
    type: 'Feature',
    id: row.id,
    geometry: { type: 'Point', coordinates: [row.lon, row.lat] },
    properties: row,
  };
}

export interface CreateHousesRepoOptions {
  db: AbstractPowerSyncDatabase;
}

export interface InsertHouseAtPointInput {
  lngLat: [number, number];
  status: HouseStatus;
  teamId: string;
  createdBy: string;
  /**
   * 0083: an address that is ALREADY known at insert time — the one the rep
   * searched for. Written straight into the row so the sheet never re-asks
   * Nominatim for a place it just geocoded. Omitted for a map tap, which has
   * no address yet and resolves one the usual way.
   */
  address?: string | null;
}

export interface AddBlacklistEntryInput {
  teamId: string;
  createdBy: string;
  lat: number;
  lon: number;
  /** Null for a blacklist point with no associated house row. */
  houseId?: string | null;
  /**
   * Defaults to 'no_solicitation' — the map's confirm has no reason picker, and
   * as of 0104 there is only one reason left to write: this table is the
   * Werbewiderspruch list. 'not_interested' stays in the union for the rows
   * written before 0104 (the table is INSERT-ONLY, so they can never be
   * rewritten), but nothing produces it any more.
   */
  reason?: BlacklistReason;
}

export interface InsertUnitInput {
  parentHouseId: string;
  teamId: string;
  createdBy: string;
  /** Inherited from the building — a party has no point of its own. */
  lat: number;
  lon: number;
  status?: HouseStatus;
}

export interface HousesRepo {
  /**
   * Reactive query over the local `houses` table. Invokes `onChange` with the
   * current row set immediately and again on every underlying SQLite change
   * (PowerSync's `db.watch`, callback form). Returns an unsubscribe function.
   */
  watchHouses(onChange: (houses: HouseRow[]) => void, onError?: (error: unknown) => void): () => void;
  /** One-shot fetch, e.g. for tests or non-reactive call sites. */
  getHouses(): Promise<HouseRow[]>;
  /**
   * Tap-to-drop-pin (MAP-02): local-only INSERT. `territory_id` is
   * deliberately absent from the INSERT column list — the server's
   * `assign_house_territory()` trigger computes it; the client never sets it.
   */
  insertHouseAtPoint(input: InsertHouseAtPointInput): Promise<string>;
  /**
   * One-tap status change / follow-up scheduling (MAP-02): local-only UPDATE.
   * `followUpAt` is only meaningful for the 'follow_up' status; pass `null`
   * to clear a previously-scheduled follow-up when changing away from it.
   */
  setStatus(houseId: string, status: HouseStatus, followUpAt?: string | null): Promise<void>;
  /**
   * Persist the house's free-text note (0060_houses_note.sql): local-only
   * UPDATE, offline-capable via the PowerSync CRUD queue (Iron Rule 1). Pass
   * `null` (or an empty note is normalized to null by the caller) to clear it.
   */
  setNote(houseId: string, note: string | null): Promise<void>;
  /** 0083: stores the reverse-geocoded street address for a pin (LWW-synced). */
  setAddress(houseId: string, address: string | null): Promise<void>;
  /**
   * Blacklist confirm (MAP-05): local-only INSERT of a GDPR-minimal row (no
   * name/email/phone/free-text — schema guarantee, 0014_houses_and_blacklist.sql).
   */
  addBlacklistEntry(input: AddBlacklistEntryInput): Promise<string>;
  /**
   * 0088: reactive query over the PARTIES (rows with a `parent_house_id`),
   * same `db.watch` callback shape as `watchHouses`. Callers pair it with
   * `groupUnitsByParent` (buildingStatus.ts) to attach parties to buildings.
   */
  watchUnits(onChange: (units: HouseRow[]) => void, onError?: (error: unknown) => void): () => void;
  /** One-shot fetch of the parties, e.g. for tests or non-reactive call sites. */
  getUnits(): Promise<HouseRow[]>;
  /**
   * 0105: remove ONE party. Never a building — the server policy only permits
   * rows with a parent, and this method is the only caller shape that makes
   * sense anyway.
   *
   * Deliberately per-row and never derived from the doorbell count: lowering 12
   * to 6 cannot know WHICH six are gone, and guessing would silently destroy
   * recorded results. The count stays additive; removal is always a named,
   * individual act.
   *
   * A party carrying a signed contract cannot be deleted (contracts.house_id is
   * ON DELETE RESTRICT, 0101). The local row disappears immediately and comes
   * BACK on the next sync when the server refuses — which is the honest
   * outcome, and why the sheet warns before removing a party that has already
   * been worked.
   */
  deleteUnit(unitId: string): Promise<void>;
  /**
   * 0088: local-only INSERT of one party under a building. `territory_id` is
   * absent from the column list for the same reason as in
   * `insertHouseAtPoint` — it is server-computed (0017) and never
   * client-authoritative. `lat`/`lon` are copied from the building because
   * both columns are NOT NULL and a party genuinely has no coordinate of its
   * own: it inherits the building's point.
   */
  insertUnit(input: InsertUnitInput): Promise<string>;
  /**
   * 0088: the party's POSITIONAL label ("3. OG links"). Never a name from the
   * Klingelschild — the column comment in 0088 and the placeholder copy in the
   * status sheet are the two halves of one guarantee.
   */
  setUnitLabel(unitId: string, label: string | null): Promise<void>;
  /** 0088: the doorbell-panel count on a BUILDING row (never on a party). */
  setUnitCount(buildingId: string, count: number | null): Promise<void>;
}

/**
 * There is deliberately NO `deleteUnit` here. `houses` has no server DELETE
 * policy (0016 grants select/insert/update only), and `connector.ts`'s
 * `applyHousesOperation` has only PATCH and PUT arms — a local DELETE would
 * fall into the PUT arm and re-INSERT the row it was meant to remove. A
 * deletion therefore has no upload path at all, so `planUnitSync`
 * (buildingStatus.ts) never produces one: lowering the doorbell-panel count
 * lowers the count and leaves every recorded party standing.
 */

/**
 * Injectable repo (options-object DI, matching the attachment queue's style —
 * never a module-level singleton) wrapping the PowerSync db handle.
 */
export function createHousesRepo(options: CreateHousesRepoOptions): HousesRepo {
  const { db } = options;

  return {
    watchHouses(onChange, onError) {
      const controller = new AbortController();
      db.watch(
        HOUSES_QUERY,
        [],
        {
          onResult: (result) => {
            const rows = (result.rows?._array ?? []) as RawHouseRecord[];
            onChange(rows.map(toHouseRow));
          },
          onError: (error) => onError?.(error),
        },
        { signal: controller.signal },
      );
      return () => controller.abort();
    },

    async getHouses() {
      const rows = await db.getAll<RawHouseRecord>(HOUSES_QUERY);
      return rows.map(toHouseRow);
    },

    async insertHouseAtPoint({ lngLat, status, teamId, createdBy, address = null }) {
      const id = Crypto.randomUUID();
      const [lon, lat] = lngLat;
      await db.execute(
        `INSERT INTO houses (id, team_id, lat, lon, status, follow_up_at, created_by, created_at, address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, teamId, lat, lon, status, null, createdBy, new Date().toISOString(), address],
      );
      return id;
    },

    async setStatus(houseId, status, followUpAt = null) {
      await db.execute('UPDATE houses SET status = ?, follow_up_at = ? WHERE id = ?', [
        status,
        followUpAt,
        houseId,
      ]);
    },

    async setNote(houseId, note) {
      await db.execute('UPDATE houses SET note = ? WHERE id = ?', [note, houseId]);
    },

    async setAddress(houseId, address) {
      await db.execute('UPDATE houses SET address = ? WHERE id = ?', [address, houseId]);
    },

    watchUnits(onChange, onError) {
      const controller = new AbortController();
      db.watch(
        UNITS_QUERY,
        [],
        {
          onResult: (result) => {
            const rows = (result.rows?._array ?? []) as RawHouseRecord[];
            onChange(rows.map(toHouseRow));
          },
          onError: (error) => onError?.(error),
        },
        { signal: controller.signal },
      );
      return () => controller.abort();
    },

    async getUnits() {
      const rows = await db.getAll<RawHouseRecord>(UNITS_QUERY);
      return rows.map(toHouseRow);
    },

    async insertUnit({ parentHouseId, teamId, createdBy, lat, lon, status = 'new' }) {
      const id = Crypto.randomUUID();
      await db.execute(
        `INSERT INTO houses (id, team_id, parent_house_id, lat, lon, status, follow_up_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, teamId, parentHouseId, lat, lon, status, null, createdBy, new Date().toISOString()],
      );
      return id;
    },

    async setUnitLabel(unitId, label) {
      await db.execute('UPDATE houses SET unit_label = ? WHERE id = ?', [label, unitId]);
    },

    async setUnitCount(buildingId, count) {
      await db.execute('UPDATE houses SET unit_count = ? WHERE id = ?', [count, buildingId]);
    },

    async deleteUnit(unitId) {
      // `parent_house_id is not null` mirrors the server policy (0105) locally,
      // so a coding mistake cannot delete a BUILDING off the map and then
      // discover the refusal one sync later.
      await db.execute('DELETE FROM houses WHERE id = ? AND parent_house_id IS NOT NULL', [unitId]);
    },

    // 0104: the default was 'not_interested' — the value WITHOUT legal effect —
    // while the button that reaches here is labelled "Keine Ansprache" and the
    // house is written as 'blacklist'. Exactly backwards, and 'no_solicitation'
    // was never written anywhere in the app. A business refusal now lives in
    // houses.status = 'no_interest' (0103); everything that still reaches this
    // table is a Werbewiderspruch.
    async addBlacklistEntry({
      teamId,
      createdBy,
      lat,
      lon,
      houseId = null,
      reason = 'no_solicitation',
    }) {
      const id = Crypto.randomUUID();
      await db.execute(
        `INSERT INTO blacklist_entries (id, team_id, house_id, lat, lon, reason, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, teamId, houseId, lat, lon, reason, createdBy, new Date().toISOString()],
      );
      return id;
    },
  };
}

export function houseRowsToFeatureCollection(
  rows: HouseRow[],
): GeoJSON.FeatureCollection<GeoJSON.Point, HouseRow> {
  return { type: 'FeatureCollection', features: rows.map(toHouseFeature) };
}
