/**
 * settingRowState — the pure, DB-free derivation of SET-07's three row
 * states (free / proposed / ceiling) from a rep's synced
 * `tenant_setting_policies` rows.
 *
 * D-17 / SET-06 is enforced by the TYPE DOMAIN, not merely by convention:
 * `LockableSettingKey` mirrors the closed Postgres `lockable_setting_key`
 * enum (0070_user_settings.sql) exactly — four members, `text_size` and
 * `high_contrast` are NOT among them. `deriveSettingRowState`'s first
 * parameter is typed `LockableSettingKey`, so calling it with an
 * accessibility key is a compile error, not merely an unused code path.
 * Belt and braces: the function also drops any policy row whose
 * `settingKey` fails `isLockableSettingKey` at runtime, so a forged or
 * future-shaped row can never reach a non-'free' state for an
 * accessibility setting even if the sync layer were compromised.
 *
 * This is the UI-composition-layer mirror of
 * `supabase/tests/lockable_setting_key_excludes_accessibility.sql`
 * (Phase 12) and `supabase/tests/tenant_setting_policies_ceiling_key_
 * restriction.sql` (13-01) — adding either accessibility key to
 * `LOCKABLE_SETTING_KEYS`, or widening `deriveSettingRowState` to accept
 * one, is a SET-06 violation and must never happen.
 */

/** Mirrors 0070_user_settings.sql's `lockable_setting_key` enum exactly. */
export const LOCKABLE_SETTING_KEYS = [
  'auto_lock_timeout_minutes',
  'notification_quiet_hours',
  'scanner_torch_default',
  'wifi_only_bulk_transfer',
] as const;

export type LockableSettingKey = (typeof LOCKABLE_SETTING_KEYS)[number];

/** Narrowing guard — never `any`, per CLAUDE.md (`unknown` + narrowing). */
export function isLockableSettingKey(value: unknown): value is LockableSettingKey {
  return typeof value === 'string' && (LOCKABLE_SETTING_KEYS as readonly string[]).includes(value);
}

export type PolicyKind = 'ceiling' | 'proposed_default';

/** Narrowing guard — never `any`, per CLAUDE.md (`unknown` + narrowing). */
export function isPolicyKind(value: unknown): value is PolicyKind {
  return value === 'ceiling' || value === 'proposed_default';
}

/**
 * One `tenant_setting_policies` row, already narrowed to typed fields.
 * `policyValue` stays a raw string — PowerSync materializes the underlying
 * Postgres `jsonb` column as text (schema.ts convention); callers parse it
 * per-key (e.g. `Number()` for `auto_lock_timeout_minutes`), this module
 * never assumes a shape.
 */
export interface TenantSettingPolicy {
  id: string;
  settingKey: LockableSettingKey;
  policyKind: PolicyKind;
  policyValue: string;
}

/**
 * The three row states a lockable setting can be in (D-06). Structurally
 * distinct on purpose: 'proposed' and 'ceiling' are NOT variants of the same
 * "locked" shape — a proposed default is freely overridable (the DB accepts
 * any deviating write), a ceiling permits only stricter-or-equal values.
 * Confusing the two in code would silently reintroduce the bug D-06 exists
 * to prevent.
 */
export type SettingRowState =
  | { kind: 'free' }
  | { kind: 'proposed'; value: string }
  | { kind: 'ceiling'; value: string };

/**
 * D-04/NOTIF-04 legal note: `notification_quiet_hours` can appear here only
 * as a 'proposed_default' row — the `ceilingable_setting_key` enum (0074)
 * and the `tenant_setting_policies_ceiling_only_orderable` CHECK both
 * exclude it from ever carrying `policy_kind = 'ceiling'` server-side. This
 * function does not need its own guard against that case: it trusts the two
 * independent DB-layer gates (already pgTAP-proven) rather than duplicating
 * the legal rule a third time, which is a drift risk per CLAUDE.md SSOT —
 * duplicating it here would be a second place that could silently disagree.
 */

/**
 * Picks the strictest of several simultaneous ceiling rows for one key
 * (D-06: "several ceilings apply, the strictest wins" — the client must
 * agree with the server's `setting_value_within_ceiling()`, 0076, so the UI
 * never offers an option the DB would then reject).
 */
function pickStrictestCeiling(
  key: LockableSettingKey,
  ceilings: readonly TenantSettingPolicy[],
): TenantSettingPolicy {
  const first = ceilings[0]!;
  if (ceilings.length === 1) return first;

  if (key === 'auto_lock_timeout_minutes') {
    // D-18: shorter minutes = stricter. Numeric compare, never string compare.
    return ceilings.reduce((strictest, current) =>
      Number(current.policyValue) < Number(strictest.policyValue) ? current : strictest,
    );
  }

  // No other `ceilingable_setting_key` member (0074: only
  // auto_lock_timeout_minutes and wifi_only_bulk_transfer) has a strictness
  // ordering defined yet (setting_value_within_ceiling, 0076, only handles
  // auto_lock_timeout_minutes). Rather than invent an ordering the database
  // has no arm for, keep the first row — a future plan defining
  // wifi_only_bulk_transfer's ordering must update this function alongside
  // the Postgres function, not before it.
  return first;
}

/**
 * Pure: given a lockable key and the rep's full synced policy snapshot,
 * returns exactly one of the three row states. Same inputs -> same output,
 * no React/DB imports — tested directly, no renderer/DB fake needed.
 */
export function deriveSettingRowState(
  key: LockableSettingKey,
  policies: readonly TenantSettingPolicy[],
): SettingRowState {
  const applicable = policies.filter(
    (policy) => isLockableSettingKey(policy.settingKey) && policy.settingKey === key && isPolicyKind(policy.policyKind),
  );

  const ceilings = applicable.filter((policy) => policy.policyKind === 'ceiling');
  if (ceilings.length > 0) {
    const strictest = pickStrictestCeiling(key, ceilings);
    return { kind: 'ceiling', value: strictest.policyValue };
  }

  const proposed = applicable.find((policy) => policy.policyKind === 'proposed_default');
  if (proposed) {
    return { kind: 'proposed', value: proposed.policyValue };
  }

  return { kind: 'free' };
}
