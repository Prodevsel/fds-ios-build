import type { AbstractPowerSyncDatabase } from '@powersync/common';

/**
 * Profile KPI read model — a thin reactive projection over the already-synced
 * `contracts` table for the Profil tab's "Abschlüsse" and "Volumen mtl." tiles
 * (design SSOT screen 13). Copies the walletRepo pattern (options-object DI,
 * module-const SQL, pure mapper, AbortController unsubscribe). Read-only.
 *
 * The KPI math (this-month count, monthly recurring volume) lives in the pure
 * `profileView.buildProfileKpis` so it is unit-testable without a DB — this repo
 * only fetches + parses the synced TEXT rows (tester deals kept here and
 * excluded in the pure layer, mirroring the wallet's is_test handling).
 *
 * `update` (D-01/D-02, Phase 12, 0072_app_users_profile_columns.sql) is a
 * SEPARATE, SPLIT write path against `app_users`, single call from the
 * caller's perspective but two different transports underneath — a real
 * architectural constraint, not a stylistic choice:
 *
 * - `fullName`/`avatarUrl` ARE declared on the local `appUsers` Table
 *   (schema.ts) and DO ride the `app_users` sync stream, so they go through
 *   the normal offline-first PowerSync path: a local `UPDATE ... WHERE id = ?`
 *   (mirrors settingsRepo.updateSettings's shape), captured by the CRUD queue
 *   and drained by connector.ts's applyAppUserOperation whenever PowerSync is
 *   up.
 * - `contactPhone`/`contactEmail` are DELIBERATELY NOT declared on the local
 *   `appUsers` Table and NOT in the stream projection (T-12-13-03, privacy).
 *   The local SQLite view PowerSync generates only exposes the columns
 *   declared in schema.ts — a local `UPDATE app_users SET contact_phone = ?`
 *   would fail ("no such column") because that column does not exist on the
 *   view. These two fields therefore bypass PowerSync entirely and write
 *   DIRECTLY to Supabase (own-row, RLS-checked by app_users_update_own,
 *   0072) — an explicit, narrow exception to Iron Rule 1's "never read/write
 *   synced data through the raw client" posture, justified because these two
 *   columns are BY DESIGN never synced data at all. Requires connectivity;
 *   there is no offline queue for these two fields.
 *
 * Only the fixed profile-column whitelist may ever be touched here — the
 * connector enforces the same whitelist again server-side for the
 * PowerSync-routed half (defence in depth, D-02).
 */

/** Structural subset of the Supabase client this repo needs for the direct-write half (own-row PATCH). */
export interface ProfileSupabaseLike {
  from(table: string): {
    update(values: Record<string, unknown>): {
      eq(column: string, value: unknown): PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

/** One contract reduced to the fields the profile KPIs need. */
export interface ContractStat {
  signedAtIso: string;
  /** Frozen monthly door price in EUR, or null when unset/unparseable. */
  doorPriceEur: number | null;
  /** D-06 tester flag — excluded from real KPI figures in the pure layer. */
  isTest: boolean;
}

interface RawContractStatRecord {
  signed_at: string;
  door_price: string | null;
  is_test: string | null;
}

const CONTRACT_STATS_QUERY = `
  SELECT c.signed_at AS signed_at,
         c.snapshot_door_price AS door_price,
         c.is_test AS is_test
  FROM contracts c
  WHERE c.rep_id = ?
`;

function parseNumericText(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Synced boolean TEXT is mixed across serializers ('1' vs 'true'); accept both. */
function parseBoolText(value: string | null): boolean {
  return value === '1' || value === 'true';
}

export function toContractStat(record: RawContractStatRecord): ContractStat {
  return {
    signedAtIso: record.signed_at,
    doorPriceEur: parseNumericText(record.door_price),
    isTest: parseBoolText(record.is_test),
  };
}

/** Patch accepted by `update` — only the whitelisted profile columns, ever. */
export interface ProfileUpdatePatch {
  fullName?: string;
  avatarUrl?: string;
  contactPhone?: string;
  contactEmail?: string;
}

/**
 * Column-ordered SET-clause builder for the LOCAL (PowerSync-routed) half of
 * `profileRepo.update` — fullName/avatarUrl ONLY, the two columns declared on
 * the local `appUsers` Table (schema.ts). Exported so it is unit-testable
 * without a database (mirrors settingsRepo's `settingsInsertParams`
 * pure-builder seam). Returns `null` when neither field is touched.
 */
export function buildProfileUpdateSql(
  userId: string,
  patch: ProfileUpdatePatch,
): { sql: string; params: unknown[] } | null {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.fullName !== undefined) {
    sets.push('full_name = ?');
    params.push(patch.fullName);
  }
  if (patch.avatarUrl !== undefined) {
    sets.push('avatar_url = ?');
    params.push(patch.avatarUrl);
  }
  if (sets.length === 0) return null;
  params.push(userId);
  return { sql: `UPDATE app_users SET ${sets.join(', ')} WHERE id = ?`, params };
}

/**
 * Pure object builder for the DIRECT-Supabase half of `profileRepo.update` —
 * contactPhone/contactEmail ONLY, the two columns deliberately absent from
 * the local schema (T-12-13-03). Returns `null` when neither field is
 * touched.
 */
export function buildContactUpdatePayload(patch: ProfileUpdatePatch): Record<string, unknown> | null {
  const payload: Record<string, unknown> = {};
  if (patch.contactPhone !== undefined) payload.contact_phone = patch.contactPhone;
  if (patch.contactEmail !== undefined) payload.contact_email = patch.contactEmail;
  return Object.keys(payload).length === 0 ? null : payload;
}

export interface CreateProfileRepoOptions {
  db: AbstractPowerSyncDatabase;
  /** Only required when the caller ever touches contactPhone/contactEmail (the direct-write half). */
  supabase?: ProfileSupabaseLike;
}

export interface ProfileRepo {
  watchContractStats(
    repId: string,
    onChange: (stats: ContractStat[]) => void,
    onError?: (error: unknown) => void,
  ): () => void;
  /**
   * Own-row profile update, split under the hood (see the module doc comment
   * above): fullName/avatarUrl route through the local PowerSync-synced
   * table; contactPhone/contactEmail write directly to Supabase. A single
   * call from the caller's perspective.
   */
  update(userId: string, patch: ProfileUpdatePatch): Promise<void>;
}

export function createProfileRepo(options: CreateProfileRepoOptions): ProfileRepo {
  const { db, supabase } = options;
  return {
    watchContractStats(repId, onChange, onError) {
      const controller = new AbortController();
      db.watch(
        CONTRACT_STATS_QUERY,
        [repId],
        {
          onResult: (result) => {
            const rows = (result.rows?._array ?? []) as RawContractStatRecord[];
            onChange(rows.map(toContractStat));
          },
          onError: (error) => onError?.(error),
        },
        { signal: controller.signal },
      );
      return () => controller.abort();
    },

    async update(userId, patch) {
      const local = buildProfileUpdateSql(userId, patch);
      if (local) {
        await db.execute(local.sql, local.params);
      }
      const direct = buildContactUpdatePayload(patch);
      if (direct) {
        if (!supabase) {
          throw new Error(
            'profileRepo.update: contactPhone/contactEmail require a supabase client (createProfileRepo({ supabase }))',
          );
        }
        const { error } = await supabase.from('app_users').update(direct).eq('id', userId);
        if (error) {
          throw new Error(`app_users contact update failed for id=${userId}: ${error.message}`);
        }
      }
    },
  };
}
