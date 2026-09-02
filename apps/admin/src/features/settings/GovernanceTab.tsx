import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import type { AdminRole } from '@/lib/auth/roles';
import { AUTO_LOCK_TIMEOUT_MINUTES_OPTIONS, type AutoLockTimeoutMinutes } from './autoLockOptions';

/**
 * The "Vorgaben" tab (D-19 — its own fourth tab, not a subsection, because
 * Phases 15/18/20/21 each add further lockable keys). Renders one row per
 * lockable key with a real column THIS phase ships — that is
 * `auto_lock_timeout_minutes` ONLY. Deliberately renders NO control for any
 * of the other three reserved `lockable_setting_key` members (0070): those
 * columns do not exist yet (D-02), and the quiet-hours key can never be a
 * ceiling at all (D-04, NOTIF-04, § 84 HGB). See
 * `useTenantSettingPolicies.ts`'s header for the full key list and the D-04
 * rationale spelled out by name.
 *
 * Role gate mirrors `LeaderboardConfigForm.tsx`'s `role !== 'operator'`
 * early return — this is UX scoping only; `tenant_setting_policies_insert`/
 * `_update` RLS (0074) is the real authority (D-14, PATTERNS § "Role gate is
 * UX-only", T-13-06-01).
 *
 * All state and the actual persistence call live in the parent
 * `SettingsPage.tsx` (mirrors `ProfilePanel`'s form/onChange prop shape) so
 * this governance change participates in the page's single shared
 * `isFormDirty`/Save contract rather than a second, independent dirty
 * mechanism.
 */

export function GovernanceTab({
  role,
  loading,
  hasAnyPolicy,
  autoLockValue,
  onAutoLockChange,
}: {
  role: AdminRole | null;
  loading: boolean;
  hasAnyPolicy: boolean;
  autoLockValue: AutoLockTimeoutMinutes | null;
  onAutoLockChange: (value: AutoLockTimeoutMinutes) => void;
}) {
  const { t } = useTranslation('settings');

  if (role !== 'operator') {
    return (
      <Card className="border-ink/10 rounded-md shadow-none">
        <CardContent className="p-lg">
          <p className="text-body text-[#5C6B85]">{t('governance.notAdmin')}</p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return <GovernanceSkeleton />;
  }

  return (
    <Card className="border-ink/10 rounded-md shadow-none">
      <CardContent className="p-lg">
        <div className="mb-lg flex flex-col gap-xs">
          <div className="font-display text-heading font-medium text-ink">{t('governance.heading')}</div>
          <p className="text-body text-[#5C6B85]">{t('governance.subtitle')}</p>
        </div>

        {!hasAnyPolicy ? (
          <div className="mb-lg rounded-md border border-ink/10 bg-muted p-md">
            <p className="text-body font-medium text-ink">{t('governance.emptyHeading')}</p>
            <p className="mt-xs text-label text-[#5C6B85]">{t('governance.emptyBody')}</p>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-md">
          <div>
            <FieldLabel htmlFor="governance-auto-lock">{t('governance.autoLockLabel')}</FieldLabel>
            <select
              id="governance-auto-lock"
              value={autoLockValue ?? ''}
              onChange={(e) => onAutoLockChange(Number(e.target.value) as AutoLockTimeoutMinutes)}
              className="h-10 w-full rounded-md border border-ink/[.16] bg-card px-md text-body text-ink"
            >
              <option value="" disabled>
                {t('governance.autoLockPlaceholder')}
              </option>
              {AUTO_LOCK_TIMEOUT_MINUTES_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {t(`governance.autoLockValue${minutes}`)}
                </option>
              ))}
            </select>
            <p className="mt-xs text-label text-[#5C6B85]">{t('governance.autoLockHint')}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Uppercase field label — matches SettingsPage.tsx's own FieldLabel token exactly. */
function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-sm block text-label font-medium uppercase tracking-[.02em] text-[#5C6B85]"
    >
      {children}
    </label>
  );
}

function GovernanceSkeleton() {
  return (
    <Card className="border-ink/10 rounded-md shadow-none">
      <CardContent className="p-lg">
        <Skeleton className="mb-lg h-[18px] w-40" />
        <div className="grid grid-cols-2 gap-md">
          <Skeleton className="h-10 w-full" />
        </div>
      </CardContent>
    </Card>
  );
}
