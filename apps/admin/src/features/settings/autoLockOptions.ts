/**
 * D-18: the closed value set for `auto_lock_timeout_minutes`. This is the
 * admin app's copy of a value list declared FOUR times across the repo:
 *   1. `tenant_setting_policies_auto_lock_value_set` (supabase/migrations/0074_tenant_setting_policies.sql)
 *   2. `user_settings_auto_lock_timeout_value_set` (supabase/migrations/0075_user_settings_auto_lock_timeout.sql)
 *   3. `apps/mobile/src/features/settings/autoLockOptions.ts`
 *   4. THIS FILE
 *
 * No package is shared between `apps/admin` and `apps/mobile` (see
 * `apps/admin/src/design/tokens.ts`'s "Rule of Two not yet satisfied" note),
 * and creating one for five integers is not warranted — so this list is
 * deliberately duplicated rather than shared. Each of the four declarations
 * carries its own test asserting the exact literal array, AND all four are
 * additionally bound together by `scripts/drift-test/check-auto-lock-value-set.mjs`
 * (`pnpm test:value-sets`), which is what makes this duplication safe. A
 * change to this array without the matching change everywhere else is
 * exactly the shape of the Phase 10 CR-01 incident (two plans persisting the
 * same value with incompatible conventions, each plan's own tests green).
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
