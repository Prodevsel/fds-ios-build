import type { AbstractPowerSyncDatabase } from '@powersync/common';

import { isLockableSettingKey, isPolicyKind, type TenantSettingPolicy } from '../settingRowState';

export type { TenantSettingPolicy } from '../settingRowState';

/**
 * Local-SQLite mirror of `tenant_setting_policies` (0074_tenant_setting_
 * policies.sql, 13-01). READ-ONLY end to end, on THREE independent layers:
 *
 *   1. Postgres RLS — org-admin-only write policy (13-01).
 *   2. connector.ts's `applyTenantSettingPoliciesReadOnly` — rejects any
 *      client-originated write before it ever reaches the CRUD upload queue.
 *   3. THIS repo — has no `insert`/`update`/`upsert`/`delete` method to call
 *      at all. Not "write methods that throw" — no write surface exists.
 *
 * Copies `settingsRepo.ts`'s read half exactly (options-object DI,
 * module-const SQL, `db.getAll`/`db.watch` + `AbortController` cleanup).
 */

/**
 * Module-const SQL, deliberately WITHOUT a `WHERE` clause. The
 * `tenant_setting_policies` PowerSync stream (13-01,
 * powersync/sync-streams.yaml) is ALREADY row-filtered to exactly the rows
 * RLS would allow this rep to read (all four `visible_companies()`/
 * `visible_sales_org()` OR-branches re-derived server-side). Re-filtering
 * client-side here would duplicate that authorization rule in a second
 * place — a CLAUDE.md SSOT violation — and risks drifting from the stream's
 * predicate the same way a client-side re-filter always eventually does.
 */
const TENANT_SETTING_POLICIES_SELECT_SQL =
  'SELECT id, company_id, sales_org_id, setting_key, policy_kind, policy_value FROM tenant_setting_policies';

/** Raw synced row shape — every column on the client Table is TEXT (schema.ts). */
interface RawTenantSettingPolicyRecord {
  id: string;
  company_id: string | null;
  sales_org_id: string | null;
  setting_key: string;
  policy_kind: string;
  policy_value: string;
}

/**
 * Pure parser: narrows a raw synced row into a `TenantSettingPolicy`, or
 * `null` if it fails either narrowing guard. A row whose `setting_key` is
 * not one of the four `LOCKABLE_SETTING_KEYS` (a forged or future value —
 * `text_size`/`high_contrast` included) or whose `policy_kind` is neither
 * `'ceiling'` nor `'proposed_default'` is DROPPED silently, never passed
 * through with a best-effort guess. This is the client-side half of the
 * D-17 defence in depth (`settingRowState.ts` owns the type-domain half;
 * `deriveSettingRowState` also re-checks at the derivation layer — belt and
 * braces, not redundant, since either guard alone would still hold).
 */
function parsePolicyRow(record: RawTenantSettingPolicyRecord): TenantSettingPolicy | null {
  if (!isLockableSettingKey(record.setting_key)) return null;
  if (!isPolicyKind(record.policy_kind)) return null;
  return {
    id: record.id,
    settingKey: record.setting_key,
    policyKind: record.policy_kind,
    policyValue: record.policy_value,
  };
}

function parsePolicyRows(records: readonly RawTenantSettingPolicyRecord[]): TenantSettingPolicy[] {
  const parsed: TenantSettingPolicy[] = [];
  for (const record of records) {
    const policy = parsePolicyRow(record);
    if (policy) parsed.push(policy);
  }
  return parsed;
}

export interface CreateSettingsPolicyRepoOptions {
  db: AbstractPowerSyncDatabase;
}

/**
 * Deliberately has ONLY `getPolicies`/`watchPolicies` — no `insert`,
 * `update`, `upsert` or `delete` member exists on this type at all (layer 3
 * of the read-only posture documented above).
 */
export interface SettingsPolicyRepo {
  /** One-shot read of every policy row visible to this rep's tenant(s). */
  getPolicies(): Promise<TenantSettingPolicy[]>;
  /** Reactive read; re-emits on every sync landing. Returns unsubscribe. */
  watchPolicies(
    onChange: (policies: TenantSettingPolicy[]) => void,
    onError?: (error: unknown) => void,
  ): () => void;
}

/** Injectable repo (options-object DI, matches createSettingsRepo). */
export function createSettingsPolicyRepo(options: CreateSettingsPolicyRepoOptions): SettingsPolicyRepo {
  const { db } = options;

  return {
    async getPolicies() {
      const rows = await db.getAll<RawTenantSettingPolicyRecord>(TENANT_SETTING_POLICIES_SELECT_SQL, []);
      return parsePolicyRows(rows);
    },

    watchPolicies(onChange, onError) {
      const controller = new AbortController();
      db.watch(
        TENANT_SETTING_POLICIES_SELECT_SQL,
        [],
        {
          onResult: (result) => {
            const rows = (result.rows?._array ?? []) as RawTenantSettingPolicyRecord[];
            onChange(parsePolicyRows(rows));
          },
          onError: (error) => onError?.(error),
        },
        { signal: controller.signal },
      );
      return () => controller.abort();
    },
  };
}
