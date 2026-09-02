import type { AbstractPowerSyncDatabase } from '@powersync/common';

import { type AutoLockTimeoutMinutes, isAutoLockTimeoutMinutes } from '../autoLockOptions';

/**
 * Local-SQLite mirror of `user_settings` (0070_user_settings.sql / schema.ts,
 * 12-02). One row per rep, id = the rep's own auth.uid() — NOT a freshly
 * generated uuid like every other synced table's writer in this app
 * (deviation flagged explicitly, see `buildDefaultSettingsRow` below and
 * `connector.ts`'s `applyUserSettingsOperation` comment). Device-local,
 * single-writer, LWW-ACCEPTABLE — plain local `INSERT`/`UPDATE`, never a
 * speculative-insertion write against this RLS-checked table (the standing
 * project-wide 02-08 42501 trap, D-18).
 *
 * All writes here are local-only (Iron Rule 1) — the CRUD upload queue is
 * drained by connector.ts's `applyUserSettingsOperation` whenever the
 * PowerSync connection is up. The connector tolerates a duplicate-key error
 * on the INSERT arm, so a race between two devices creating the first row
 * for the same rep resolves harmlessly.
 *
 * Copies profileRepo.ts's read shape (options-object DI, module-const SQL,
 * `db.watch` + AbortController cleanup) and appointmentsRepo.ts's write shape
 * (module-const INSERT SQL + a pure `build*` row builder + a `*InsertParams`
 * column-ordered params function, both unit-tested without a database).
 */

/** Theme options — mirrors 0070_user_settings.sql's CHECK constraint. */
export type Theme = 'light' | 'dark' | 'system';
/** Text-size options — mirrors 0070_user_settings.sql's CHECK constraint. */
export type TextSize = 'default' | 'large' | 'extra_large';

/** One `user_settings` row, already reduced to typed fields (D-16 truth source). */
export interface UserSettings {
  id: string;
  language: string;
  theme: Theme;
  textSize: TextSize;
  highContrast: boolean;
  /** D-01/0075: null means "the rep has not chosen yet". Phase 15 resolves the effective value. */
  autoLockTimeoutMinutes: AutoLockTimeoutMinutes | null;
  updatedAt: string;
}

/** Every column on the client `user_settings` Table is TEXT (schema.ts, 12-02/13-02). */
interface RawUserSettingsRecord {
  id: string;
  language: string;
  theme: string;
  text_size: string;
  high_contrast: string;
  /** Nullable synced TEXT — `null`/`undefined` when the rep has not chosen (D-01). */
  auto_lock_timeout_minutes: string | null | undefined;
  updated_at: string;
}

/** Synced boolean TEXT is mixed across serializers ('1' vs 'true'); accept both. */
function parseBoolText(value: string): boolean {
  return value === '1' || value === 'true';
}

function parseTheme(value: string): Theme {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

function parseTextSize(value: string): TextSize {
  return value === 'default' || value === 'large' || value === 'extra_large' ? value : 'default';
}

/**
 * Nullable synced TEXT -> typed value, never `any` (unknown + narrowing,
 * CLAUDE.md). An unrecognized non-null value (a value outside D-18's closed
 * set, e.g. a future looser DB CHECK) maps to `null`, matching the
 * "rep has not chosen" state rather than propagating garbage (T-12-04-01
 * class of guard, extended to this column).
 */
function parseAutoLockTimeoutMinutes(value: string | null | undefined): AutoLockTimeoutMinutes | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return isAutoLockTimeoutMinutes(parsed) ? parsed : null;
}

/**
 * Pure mapper: parses the synced TEXT record into a UserSettings. Never
 * throws — an unrecognized `theme`/`text_size` string falls back to the
 * documented default rather than propagating garbage into rendering logic
 * (T-12-04-01), layered on top of the 12-02 DB CHECK constraints.
 */
export function toUserSettings(record: RawUserSettingsRecord): UserSettings {
  return {
    id: record.id,
    language: record.language,
    theme: parseTheme(record.theme),
    textSize: parseTextSize(record.text_size),
    highContrast: parseBoolText(record.high_contrast),
    autoLockTimeoutMinutes: parseAutoLockTimeoutMinutes(record.auto_lock_timeout_minutes),
    updatedAt: record.updated_at,
  };
}

const USER_SETTINGS_COLUMNS =
  'id, language, theme, text_size, high_contrast, auto_lock_timeout_minutes, updated_at';

const USER_SETTINGS_SELECT_SQL = `SELECT ${USER_SETTINGS_COLUMNS} FROM user_settings WHERE id = ?`;

/** Column order kept beside the params builder below. */
const USER_SETTINGS_INSERT_SQL = `
  INSERT INTO user_settings (id, language, theme, text_size, high_contrast, auto_lock_timeout_minutes, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`;

/** The insertable `user_settings` row (SQLite/PowerSync column shape). */
export interface UserSettingsRow {
  id: string;
  language: string;
  theme: Theme;
  text_size: TextSize;
  high_contrast: boolean;
  /** D-01/0075: null default on first row creation ("rep has not chosen yet"). */
  auto_lock_timeout_minutes: AutoLockTimeoutMinutes | null;
  updated_at: string;
}

export interface BuildDefaultSettingsRowInput {
  /** The rep's own auth.uid() — becomes this row's PRIMARY KEY verbatim. */
  userId: string;
  /** Seeds `language` ONLY on first row creation (Pitfall 4) — once a row
   * exists, the persisted value is authoritative and the device locale is
   * never consulted again. Defaults to 'de' (the app's primary market). */
  language?: string;
  /** Defaults to `new Date().toISOString()` (injected for deterministic tests). */
  nowIso?: string;
}

/**
 * Pure builder for the first-login default row — deterministic in its
 * inputs, unit-tested directly. `id` equals `userId` VERBATIM: this is the
 * one table in the app whose primary key is NOT a generated uuid, because
 * the primary key IS the rep identity — the same identity-binding posture as
 * `territories.locked_by`.
 */
export function buildDefaultSettingsRow(input: BuildDefaultSettingsRowInput): UserSettingsRow {
  const nowIso = input.nowIso ?? new Date().toISOString();
  return {
    id: input.userId,
    language: input.language ?? 'de',
    theme: 'system',
    text_size: 'default',
    high_contrast: false,
    // D-01/0075: NULL on first row creation — "the rep has not chosen yet",
    // NEVER a non-null default (the ceiling trigger evaluates this column on
    // every INSERT and could reject a fresh row under a strict tenant
    // ceiling — a self-inflicted lockout).
    auto_lock_timeout_minutes: null,
    updated_at: nowIso,
  };
}

/** Column-ordered params for `USER_SETTINGS_INSERT_SQL` from a built row. */
export function settingsInsertParams(row: UserSettingsRow): unknown[] {
  return [
    row.id,
    row.language,
    row.theme,
    row.text_size,
    row.high_contrast ? '1' : '0',
    row.auto_lock_timeout_minutes,
    row.updated_at,
  ];
}

/** Patch accepted by `updateSettings` — only touched columns are ever set. */
export interface UpdateSettingsPatch {
  language?: string;
  theme?: Theme;
  textSize?: TextSize;
  highContrast?: boolean;
  /** D-01: `null` clears the rep's choice — accepted even under a ceiling (the trigger's early-return case). */
  autoLockTimeoutMinutes?: AutoLockTimeoutMinutes | null;
}

export interface CreateSettingsRepoOptions {
  db: AbstractPowerSyncDatabase;
}

export interface EnsureSettingsRowInput {
  userId: string;
  /** Caller-supplied device-locale seed, used ONLY when no row exists yet. */
  deviceLanguage?: string;
}

export interface SettingsRepo {
  /** One-shot own-row read, or null if no row exists yet. */
  getSettings(userId: string): Promise<UserSettings | null>;
  /** Reactive own-row read; re-emits on every sync landing. Returns unsubscribe. */
  watchSettings(userId: string, onChange: (settings: UserSettings | null) => void, onError?: (error: unknown) => void): () => void;
  /** Creates the first-login row (id = userId) only if none exists yet. */
  ensureSettingsRow(input: EnsureSettingsRowInput): Promise<void>;
  /** Local-only `UPDATE ... WHERE id = ?` of only the touched columns — real update, never a speculative-insertion write (D-18). */
  updateSettings(userId: string, patch: UpdateSettingsPatch): Promise<void>;
}

/** Injectable repo (options-object DI, matches createProfileRepo/createAppointmentsRepo). */
export function createSettingsRepo(options: CreateSettingsRepoOptions): SettingsRepo {
  const { db } = options;

  return {
    async getSettings(userId) {
      const rows = await db.getAll<RawUserSettingsRecord>(USER_SETTINGS_SELECT_SQL, [userId]);
      const row = rows[0];
      return row ? toUserSettings(row) : null;
    },

    watchSettings(userId, onChange, onError) {
      const controller = new AbortController();
      db.watch(
        USER_SETTINGS_SELECT_SQL,
        [userId],
        {
          onResult: (result) => {
            const rows = (result.rows?._array ?? []) as RawUserSettingsRecord[];
            onChange(rows[0] ? toUserSettings(rows[0]) : null);
          },
          onError: (error) => onError?.(error),
        },
        { signal: controller.signal },
      );
      return () => controller.abort();
    },

    async ensureSettingsRow({ userId, deviceLanguage }) {
      const existing = await db.getAll<RawUserSettingsRecord>(USER_SETTINGS_SELECT_SQL, [userId]);
      if (existing.length > 0) return;
      // Deviation from every other table in this connector: user_settings.id
      // MUST bind to the rep's own auth.uid() (not Crypto.randomUUID()) —
      // the primary key IS the rep identity (mirrors territories.locked_by's
      // identity-binding posture). The connector's applyUserSettingsOperation
      // tolerates a duplicate-key error, so a race between two devices
      // creating the first row resolves harmlessly.
      const row = buildDefaultSettingsRow({ userId, language: deviceLanguage });
      await db.execute(USER_SETTINGS_INSERT_SQL, settingsInsertParams(row));
    },

    async updateSettings(userId, patch) {
      // Local-only real UPDATE — never a speculative-insertion write (D-18,
      // the standing 02-08 42501 trap against this RLS-checked table).
      // Drains through the PowerSync CRUD queue (Iron Rule 1), never a
      // direct Supabase call.
      const sets: string[] = [];
      const params: unknown[] = [];
      if (patch.language !== undefined) {
        sets.push('language = ?');
        params.push(patch.language);
      }
      if (patch.theme !== undefined) {
        sets.push('theme = ?');
        params.push(patch.theme);
      }
      if (patch.textSize !== undefined) {
        sets.push('text_size = ?');
        params.push(patch.textSize);
      }
      if (patch.highContrast !== undefined) {
        sets.push('high_contrast = ?');
        params.push(patch.highContrast ? '1' : '0');
      }
      if (patch.autoLockTimeoutMinutes !== undefined) {
        sets.push('auto_lock_timeout_minutes = ?');
        params.push(patch.autoLockTimeoutMinutes);
      }
      if (sets.length === 0) return;
      sets.push('updated_at = ?');
      params.push(new Date().toISOString());
      params.push(userId);
      await db.execute(`UPDATE user_settings SET ${sets.join(', ')} WHERE id = ?`, params);
    },
  };
}
