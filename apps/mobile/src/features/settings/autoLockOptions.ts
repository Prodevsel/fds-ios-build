/**
 * D-18: the closed value set for `auto_lock_timeout_minutes` (0075). ONE of
 * three consumers of the exact same list — this file, the admin app's
 * `apps/admin/src/features/settings/autoLockOptions.ts`, and TWO Postgres
 * CHECK constraints (`user_settings_auto_lock_timeout_value_set` in 0075,
 * `tenant_setting_policies_auto_lock_value_set` in 0074). Each consumer
 * carries its own test asserting the exact literal array so drift breaks a
 * build (the Phase 10 CR-01 class of bug: two independently-tested plans
 * silently disagreeing on a shared value).
 *
 * No shared package exists between `apps/mobile` and `apps/admin` (see
 * `apps/admin/src/design/tokens.ts`'s "Rule of Two not yet satisfied" note)
 * — this file deliberately does NOT reach for one; a fourth consumer would
 * be the trigger to reconsider that, not this plan.
 */
export const AUTO_LOCK_TIMEOUT_MINUTES_OPTIONS = [1, 5, 15, 30, 60] as const;

export type AutoLockTimeoutMinutes = (typeof AUTO_LOCK_TIMEOUT_MINUTES_OPTIONS)[number];

/** Narrowing guard — never `any`, per CLAUDE.md (`unknown` + narrowing). */
export function isAutoLockTimeoutMinutes(value: unknown): value is AutoLockTimeoutMinutes {
  return (
    typeof value === 'number' &&
    (AUTO_LOCK_TIMEOUT_MINUTES_OPTIONS as readonly number[]).includes(value)
  );
}
