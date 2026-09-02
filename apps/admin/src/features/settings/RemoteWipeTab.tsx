import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useReps } from '@/features/reps/useReps';
import { useSession } from '@/lib/auth/useSession';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import type { DeviceWipeOrderRow } from './useDeviceWipeOrders';
import { canForcePurge, deriveWipeBadge, useDeviceWipeOrders } from './useDeviceWipeOrders';

/**
 * The "Fernlöschung" tab (SEC-08, D-01/D-02/D-03). Composed entirely from
 * existing `Card`/`Table`/`Badge`/`Dialog`/`Button` primitives
 * (`@/components/ui/*`) — no new primitive, no fifth badge variant.
 *
 * D-02: the status column is never a green/red pill. `deriveWipeBadge`
 * (Task 1) drives both the badge variant and the copy key; `statusDraining`/
 * `statusStalled` interpolate `{{n}}` from the row's LIVE
 * `pendingArtifactCount` on every render, so the number tracks the latest
 * fetched value rather than a snapshot captured at mount.
 * `statusStalledUnverifiedPath` takes NO count — the purge never reached the
 * queue in that case, so quoting a number there would falsely imply the
 * queue is involved.
 *
 * D-03: the destructive escape hatch is gated three ways — role (`operator`
 * only; mirrors `GovernanceTab.tsx`'s `role !== 'operator'` early-return for
 * the WHOLE tab, not merely a disabled button), status (`canForcePurge`
 * refuses `queued`/`purged_complete`), and a count-bearing confirmation
 * whose rendered number is the exact value passed to `forcePurge` — the
 * stored audit count must match what the admin was shown at the moment of
 * commitment.
 */

/** Company-locale date+time — same `Intl`/`de-DE` idiom `SessionsTab.tsx`'s
 *  `formatLastActive` already uses in this app. Not a bespoke format. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function RemoteWipeTab() {
  const { t } = useTranslation('settings');
  const { role } = useSession();
  const { rows, loading, error, issue, forcePurge } = useDeviceWipeOrders();
  const { data: reps } = useReps();

  const [selectedRepId, setSelectedRepId] = React.useState('');
  const [triggerOpen, setTriggerOpen] = React.useState(false);
  const [issueError, setIssueError] = React.useState(false);
  const [forceTarget, setForceTarget] = React.useState<DeviceWipeOrderRow | null>(null);

  const eligibleReps = React.useMemo(
    () => (reps ?? []).filter((r): r is typeof r & { userId: string } => Boolean(r.userId)),
    [reps],
  );

  if (role !== 'operator') {
    return (
      <Card className="border-ink/10 rounded-md shadow-none">
        <CardContent className="p-lg">
          <p className="text-body text-muted-foreground">{t('wipe.notAdmin')}</p>
        </CardContent>
      </Card>
    );
  }

  async function handleTriggerConfirm() {
    setTriggerOpen(false);
    setIssueError(false);
    const outcome = await issue(selectedRepId);
    if (outcome !== 'queued') {
      setIssueError(true);
    }
  }

  async function handleForceConfirm() {
    if (!forceTarget) return;
    const count = forceTarget.pendingArtifactCount;
    const orderId = forceTarget.id;
    setForceTarget(null);
    await forcePurge(orderId, count);
  }

  return (
    <Card className="border-ink/10 rounded-md shadow-none">
      <CardContent className="p-lg">
        <div className="mb-lg flex flex-col gap-xs">
          <div className="font-display text-heading font-medium text-ink">{t('wipe.tabLabel')}</div>
        </div>

        <div className="mb-lg flex flex-wrap items-end gap-sm">
          <div>
            <label
              htmlFor="wipe-rep-select"
              className="mb-sm block text-label font-medium uppercase tracking-[.02em] text-muted-foreground"
            >
              {t('wipe.repSelectLabel')}
            </label>
            <select
              id="wipe-rep-select"
              value={selectedRepId}
              onChange={(e) => setSelectedRepId(e.target.value)}
              className="h-10 min-w-[14rem] rounded-md border border-ink/[.16] bg-card px-md text-body text-ink"
            >
              <option value="" disabled>
                {t('wipe.repSelectPlaceholder')}
              </option>
              {eligibleReps.map((rep) => (
                <option key={rep.userId} value={rep.userId}>
                  {rep.name ?? rep.userId}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!selectedRepId}
            onClick={() => setTriggerOpen(true)}
          >
            {t('wipe.triggerCta')}
          </Button>
        </div>

        {issueError ? (
          <p role="alert" className="mb-md text-body text-destructive">
            {t('errors.saveGeneric')}
          </p>
        ) : null}

        {loading ? (
          <RemoteWipeSkeleton />
        ) : error ? (
          <p role="alert" className="text-body text-destructive">
            {t('errors.saveGeneric')}
          </p>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-ink/10 bg-muted p-md">
            <p className="text-body font-medium text-ink">{t('wipe.emptyHeading')}</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('wipe.columnRep')}</TableHead>
                <TableHead>{t('wipe.columnDevice')}</TableHead>
                <TableHead>{t('wipe.columnStatus')}</TableHead>
                <TableHead>{t('wipe.columnAction')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const badge = deriveWipeBadge(row);
                const showForce = canForcePurge(row, role);
                const count = row.pendingArtifactCount;
                return (
                  <TableRow key={row.id}>
                    <TableCell>{row.repName}</TableCell>
                    <TableCell className="font-mono text-label">{row.deviceId ?? '—'}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-xs">
                        <Badge variant={badge.variant}>
                          {badge.copyKey === 'wipe.statusStalledUnverifiedPath'
                            ? t(badge.copyKey)
                            : badge.copyKey === 'wipe.statusComplete'
                              ? t(badge.copyKey, { date: row.completedAt ? formatDate(row.completedAt) : '' })
                              : t(badge.copyKey, { n: count })}
                        </Badge>
                        {row.forcedAt ? (
                          <p className="text-label text-muted-foreground">
                            {t('wipe.forcedNote', {
                              adminName: row.forcedByName ?? '',
                              date: formatDate(row.forcedAt),
                              n: row.forcedDiscardedCount ?? 0,
                            })}
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      {showForce ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="border-brick/40 text-brick hover:bg-brick/10"
                          onClick={() => setForceTarget(row)}
                        >
                          {t('wipe.forceCta')}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog
        open={triggerOpen}
        onClose={() => setTriggerOpen(false)}
        title={t('wipe.triggerConfirmTitle')}
        description={t('wipe.triggerConfirmBody')}
        closeLabel={t('wipe.closeDialog')}
      >
        <div className="flex justify-end gap-sm">
          <Button type="button" variant="outline" onClick={() => setTriggerOpen(false)}>
            {t('wipe.cancelCta')}
          </Button>
          <Button type="button" variant="outline" onClick={() => void handleTriggerConfirm()}>
            {t('wipe.triggerCta')}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={forceTarget !== null}
        onClose={() => setForceTarget(null)}
        title={t('wipe.forceConfirmTitle', { n: forceTarget?.pendingArtifactCount ?? 0 })}
        description={t('wipe.forceConfirmBody', { n: forceTarget?.pendingArtifactCount ?? 0 })}
        closeLabel={t('wipe.closeDialog')}
      >
        <div className="flex justify-end gap-sm">
          <Button type="button" variant="outline" onClick={() => setForceTarget(null)}>
            {t('wipe.cancelCta')}
          </Button>
          <Button type="button" variant="destructive" onClick={() => void handleForceConfirm()}>
            {t('wipe.forceConfirmCta', { n: forceTarget?.pendingArtifactCount ?? 0 })}
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}

function RemoteWipeSkeleton() {
  return (
    <div className="flex flex-col gap-sm">
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}
