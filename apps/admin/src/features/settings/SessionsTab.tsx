import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MonitorCheck } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import type { AdminSessionRow } from './useMySessions';
import { useMySessions } from './useMySessions';

/**
 * The 5th "Sitzungen" tab (SEC-06, D-23). Additional UI over the SAME
 * `useMySessions()` data layer (Task 1) — no second backend path. Composed
 * from the existing `Card`/`Table`/`Dialog`/`Badge`/`Button` primitives
 * already shipped in `apps/admin/src/components/ui/*` (14-UI-SPEC.md: "Do
 * not build a new table/list primitive for the admin Sessions tab").
 *
 * `sessions.latencyExplainer` renders under the tab heading on EVERY visit,
 * not only after a revoke (D-07 is a standing property of the surface, not
 * an after-the-fact toast).
 *
 * Both confirmation tiers use `@/components/ui/dialog.tsx` (admin has no
 * lighter inline-row-confirm idiom the way a mobile row does) — the
 * severity difference between revoking a non-current session and the
 * caller's own current session (D-22) is carried entirely by copy weight
 * and button labelling, never by mechanism.
 */

/** Pure: the caller's own current session gets the heavier confirmation
 *  tier; every other session gets the lighter one. `isCurrent` is UX-only
 *  (derived from a JWT claim comparison) — it selects a dialog tier, never
 *  an authorization outcome. */
export type ConfirmTier = 'standard' | 'current';
export function deriveConfirmTier(session: Pick<AdminSessionRow, 'isCurrent'>): ConfirmTier {
  return session.isCurrent ? 'current' : 'standard';
}

/** Pure: a row mid-revoke shows the honest "Wird beendet" state in place of
 *  its button — it never jumps straight to a completed "Widerrufen" state,
 *  and it is not removed here; it disappears only once `useMySessions()`'s
 *  own refetch stops returning it. */
export type RowState = 'idle' | 'revoking';
export function deriveRowState(
  session: Pick<AdminSessionRow, 'id'>,
  revokingIds: ReadonlySet<string>,
): RowState {
  return revokingIds.has(session.id) ? 'revoking' : 'idle';
}

/** Company-locale date+time for the "Zuletzt aktiv" column — same
 *  `Intl`/`de-DE` idiom `ApiKeysPage.tsx`'s own `formatDate` already uses in
 *  this app, extended with a time component since a session's last-active
 *  moment (unlike an API key's creation date) is meaningfully granular to
 *  the minute. Not a bespoke format — `Intl.DateTimeFormat` via
 *  `toLocaleString`, matching the existing admin-wide date-rendering idiom. */
function formatLastActive(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SessionsTab() {
  const { t } = useTranslation('settings');
  const { sessions, isLoading, isError, revokingIds, revokeError, revoke } = useMySessions();
  const [confirmTarget, setConfirmTarget] = React.useState<AdminSessionRow | null>(null);

  const confirmTier = confirmTarget ? deriveConfirmTier(confirmTarget) : null;

  function handleConfirm() {
    if (!confirmTarget) return;
    const id = confirmTarget.id;
    setConfirmTarget(null);
    void revoke(id);
  }

  return (
    <Card className="border-ink/10 rounded-md shadow-none">
      <CardContent className="p-lg">
        <div className="mb-lg flex flex-col gap-xs">
          <div className="font-display text-heading font-medium text-ink">{t('sessions.title')}</div>
          {/* Standing explainer (D-07) — shown on every visit, never only
              after a revoke happens. */}
          <p className="text-body text-[#5C6B85]">{t('sessions.latencyExplainer')}</p>
        </div>

        {revokeError ? (
          <p role="alert" className="mb-md text-body text-destructive">
            {t('sessions.revokeErrorGeneric')}
          </p>
        ) : null}

        {isLoading ? (
          <SessionsSkeleton />
        ) : isError ? (
          <p role="alert" className="text-body text-destructive">
            {t('sessions.loadErrorGeneric')}
          </p>
        ) : sessions.length === 0 ? (
          <div className="rounded-md border border-ink/10 bg-muted p-md">
            <p className="text-body font-medium text-ink">{t('sessions.emptyHeading')}</p>
            <p className="mt-xs text-label text-[#5C6B85]">{t('sessions.emptyBody')}</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('sessions.columnUserAgent')}</TableHead>
                <TableHead>{t('sessions.columnIp')}</TableHead>
                <TableHead>{t('sessions.columnLastActive')}</TableHead>
                <TableHead>{t('sessions.columnAction')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((session) => {
                const rowState = deriveRowState(session, revokingIds);
                return (
                  <TableRow key={session.id}>
                    {/* Raw user-agent string, verbatim — always allowed to
                        wrap across lines, never a parsed device name (D-14). */}
                    <TableCell className="whitespace-normal">
                      <div className="flex flex-wrap items-start gap-sm">
                        <span>{session.userAgent ?? ''}</span>
                        {session.isCurrent ? (
                          <Badge
                            variant="invited"
                            aria-label={`${t('sessions.currentDeviceBadge')} - aktuelle Sitzung`}
                            className="shrink-0"
                          >
                            <MonitorCheck aria-hidden className="size-3" />
                            {t('sessions.currentDeviceBadge')}
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-label">
                      {session.ip ?? t('sessions.ipUnavailable')}
                    </TableCell>
                    {/* `refreshedAt` is NULL until a session's first token
                        refresh — fall back to the session's own creation
                        moment, the honest "last active" for a session that has
                        not refreshed yet (never a fabricated date). */}
                    <TableCell>{formatLastActive(session.refreshedAt ?? session.createdAt)}</TableCell>
                    <TableCell>
                      {rowState === 'revoking' ? (
                        <span className="text-label text-ink/60">{t('sessions.revokingState')}</span>
                      ) : (
                        <Button variant="destructive" size="sm" onClick={() => setConfirmTarget(session)}>
                          {t('sessions.revokeCta')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog
        open={confirmTarget !== null}
        onClose={() => setConfirmTarget(null)}
        title={
          confirmTier === 'current' ? t('sessions.revokeCurrentConfirmTitle') : t('sessions.revokeConfirmInline')
        }
        description={confirmTier === 'current' ? t('sessions.revokeCurrentConfirmBody') : undefined}
        closeLabel={t('sessions.closeDialog')}
      >
        <div className="flex justify-end gap-sm">
          <Button type="button" variant="outline" onClick={() => setConfirmTarget(null)}>
            {t('sessions.cancelCta')}
          </Button>
          <Button type="button" variant="destructive" onClick={handleConfirm}>
            {confirmTier === 'current' ? t('sessions.revokeCurrentConfirmCta') : t('sessions.revokeConfirmCta')}
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}

function SessionsSkeleton() {
  return (
    <div className="flex flex-col gap-sm">
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}
