import type { AbstractPowerSyncDatabase } from '@powersync/common';
import * as Crypto from 'expo-crypto';

/**
 * Local-SQLite model for the Termine tab (design SSOT screen 12) over the
 * synced `appointments` table (0058_appointments.sql / schema.ts). Copies the
 * walletRepo/contractsRepo pattern exactly: options-object DI, module-const SQL,
 * pure mapper, AbortController unsubscribe. The read side displays the rep's own
 * follow-up calendar (own-rows-only via RLS + the sync stream, T-04-05: never a
 * client-side rep filter as the security boundary).
 *
 * The write side (`createFollowUpAppointment`) is the REAL producer for this
 * table (design SSOT: "Follow-up setzt einen Folgetermin"): when a rep sets a
 * house to Follow-up in the StatusSheet flow, a matching appointments row is
 * created so the daily-use screens (Termine, Aktuelles "Folgetermin heute",
 * Suche's Häuser group, Profil "Offene Follow-ups") fill from real activity,
 * not seed fixtures. Like every write in the app it is local-only (Iron Rule 1)
 * — the row lands in the PowerSync CRUD upload queue and is drained by
 * `connector.ts`'s `applyAppointmentOperation` (LWW upsert), mirroring how
 * `housesRepo` writes `follow_up_at`.
 *
 * PowerSync serializes Postgres timestamptz/int as SQLite TEXT, so the mapper
 * parses `customer_age` before any numeric use and never does arithmetic on the
 * raw text.
 */

/** Appointment kind — mirrors the appointments.kind CHECK (0058). */
export type AppointmentKind = 'follow_up' | 'callback_verification';

/** One appointment row, already reduced to typed display fields. */
export interface Appointment {
  id: string;
  houseId: string | null;
  scheduledAtIso: string;
  address: string | null;
  floorLabel: string | null;
  note: string | null;
  kind: AppointmentKind;
  /** Customer age in years, or null (drives the callback-verification chip). */
  customerAge: number | null;
  /** When the appointment was created (real event time for the Aktuelles feed). */
  createdAtIso: string;
}

interface RawAppointmentRecord {
  id: string;
  house_id: string | null;
  scheduled_at: string;
  address: string | null;
  floor_label: string | null;
  note: string | null;
  kind: string;
  customer_age: string | null;
  created_at: string;
}

/**
 * Own-rep appointments, earliest first (the Termine list reads top-to-bottom
 * from the next due follow-up). `WHERE rep_id = ?` is a UI narrowing over the
 * already-RLS-/sync-scoped local rows, not the security boundary (mirrors
 * walletRepo's note).
 */
const APPOINTMENTS_QUERY = `
  SELECT id, house_id, scheduled_at, address, floor_label, note, kind, customer_age, created_at
  FROM appointments
  WHERE rep_id = ?
  ORDER BY scheduled_at ASC
`;

/** Parse a synced numeric TEXT to a number, or null for null/unparseable input. */
function parseIntText(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Pure mapper: parses the synced TEXT record into an Appointment. Never throws. */
export function toAppointment(record: RawAppointmentRecord): Appointment {
  return {
    id: record.id,
    houseId: record.house_id ?? null,
    scheduledAtIso: record.scheduled_at,
    address: record.address ?? null,
    floorLabel: record.floor_label ?? null,
    note: record.note ?? null,
    kind: record.kind === 'callback_verification' ? 'callback_verification' : 'follow_up',
    customerAge: parseIntText(record.customer_age),
    createdAtIso: record.created_at,
  };
}

/** The insertable `appointments` row (SQLite/PowerSync column shape). */
export interface AppointmentInsert {
  id: string;
  rep_id: string;
  team_id: string;
  house_id: string | null;
  scheduled_at: string;
  address: string | null;
  floor_label: string | null;
  note: string | null;
  kind: AppointmentKind;
  customer_age: number | null;
  created_at: string;
  updated_at: string;
}

/** Inputs for building a follow-up appointment row (`kind = 'follow_up'`). */
export interface BuildFollowUpAppointmentInput {
  id: string;
  repId: string;
  teamId: string;
  houseId: string | null;
  /** The exact follow-up time the rep picked in the StatusSheet. */
  scheduledAt: Date;
  /** Defaults to `new Date().toISOString()` (injected for deterministic tests). */
  nowIso?: string;
  address?: string | null;
  floorLabel?: string | null;
  note?: string | null;
  customerAge?: number | null;
}

/** SQLite column order for the INSERT — kept beside the params builder below. */
const APPOINTMENT_INSERT_SQL = `
  INSERT INTO appointments
    (id, rep_id, team_id, house_id, scheduled_at, address, floor_label, note, kind, customer_age, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/**
 * Pure builder for a follow-up appointment row — deterministic in its inputs
 * (no `Crypto`/`Date.now` inside), unit-tested directly. `kind` is fixed to
 * 'follow_up' (the Folgetermin the StatusSheet produces); the optional
 * address/floor/note/age default to null — the GDPR-minimal `houses` table
 * carries none of them, so a follow-up set from the map has no address to
 * copy (see mobile-map.md, the documented remaining gap). Never faked.
 */
export function buildFollowUpAppointment(input: BuildFollowUpAppointmentInput): AppointmentInsert {
  const createdAtIso = input.nowIso ?? new Date().toISOString();
  return {
    id: input.id,
    rep_id: input.repId,
    team_id: input.teamId,
    house_id: input.houseId,
    scheduled_at: input.scheduledAt.toISOString(),
    address: input.address ?? null,
    floor_label: input.floorLabel ?? null,
    note: input.note ?? null,
    kind: 'follow_up',
    customer_age: input.customerAge ?? null,
    created_at: createdAtIso,
    updated_at: createdAtIso,
  };
}

/** Column-ordered params for `APPOINTMENT_INSERT_SQL` from a built row. */
export function appointmentInsertParams(row: AppointmentInsert): unknown[] {
  return [
    row.id,
    row.rep_id,
    row.team_id,
    row.house_id,
    row.scheduled_at,
    row.address,
    row.floor_label,
    row.note,
    row.kind,
    row.customer_age,
    row.created_at,
    row.updated_at,
  ];
}

/** Inputs the caller (StatusSheet) supplies; `id`/`nowIso` are filled in here. */
export type CreateFollowUpAppointmentInput = Omit<BuildFollowUpAppointmentInput, 'id' | 'nowIso'>;

export interface CreateAppointmentsRepoOptions {
  db: AbstractPowerSyncDatabase;
}

export interface AppointmentsRepo {
  /** One-shot rep-scoped read (earliest first). */
  getAppointments(repId: string): Promise<Appointment[]>;
  /** Reactive rep-scoped read; re-emits on every sync landing. Returns unsubscribe. */
  watchAppointments(
    repId: string,
    onChange: (appointments: Appointment[]) => void,
    onError?: (error: unknown) => void,
  ): () => void;
  /**
   * Local-only INSERT of a follow-up appointment (design SSOT: "Follow-up setzt
   * einen Folgetermin"). Returns the new row id. Offline-capable via the
   * PowerSync CRUD queue — never a direct Supabase call (Iron Rule 1).
   */
  createFollowUpAppointment(input: CreateFollowUpAppointmentInput): Promise<string>;
}

/** Injectable read model (options-object DI, matches createWalletRepo). */
export function createAppointmentsRepo(options: CreateAppointmentsRepoOptions): AppointmentsRepo {
  const { db } = options;

  return {
    async getAppointments(repId) {
      const rows = await db.getAll<RawAppointmentRecord>(APPOINTMENTS_QUERY, [repId]);
      return rows.map(toAppointment);
    },

    watchAppointments(repId, onChange, onError) {
      const controller = new AbortController();
      db.watch(
        APPOINTMENTS_QUERY,
        [repId],
        {
          onResult: (result) => {
            const rows = (result.rows?._array ?? []) as RawAppointmentRecord[];
            onChange(rows.map(toAppointment));
          },
          onError: (error) => onError?.(error),
        },
        { signal: controller.signal },
      );
      return () => controller.abort();
    },

    async createFollowUpAppointment(input) {
      const id = Crypto.randomUUID();
      const row = buildFollowUpAppointment({ id, ...input });
      await db.execute(APPOINTMENT_INSERT_SQL, appointmentInsertParams(row));
      return id;
    },
  };
}
