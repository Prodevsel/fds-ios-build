import { CodeChip } from '@/components/CodeChip';
import { EmptyState } from '@/components/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, Inbox } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { PayloadDrawer } from './PayloadDrawer';
import {
  type WebhookEvent,
  type WebhookStatus,
  useRedeliver,
  useWebhookConfig,
  useWebhookEvents,
} from './useWebhooks';

/**
 * EventLogTable (API-02). A company's outbox events re-skinned 1:1 to the
 * Webhooks.dc.html Event-Log: a stats row summarising the events, an Ink-Navy
 * table header, a Mono event-type chip per row, and icon+label status pills
 * (delivered=Pine check-circle / pending=Amber clock / dead_letter=Brick
 * alert-triangle — never colour alone). dead_letter rows are drawn FIRST
 * (05-UI-SPEC focal point, handled in the query). Clicking a row opens the
 * slide-in PayloadDrawer (thin payload in a dark Mono block; for dead_letter also
 * the retry ladder + "Erneut zustellen"). Redelivery is dead_letter-scoped.
 */
const STATUS_META: Record<
  WebhookStatus,
  { variant: 'active' | 'invited' | 'removed'; icon: LucideIcon }
> = {
  delivered: { variant: 'active', icon: CheckCircle2 },
  pending: { variant: 'invited', icon: Clock },
  dead_letter: { variant: 'removed', icon: AlertTriangle },
};

export function EventLogTable({
  companyId,
  companyName,
}: {
  companyId: string;
  companyName: string;
}) {
  const { t } = useTranslation('webhooks');
  const { data: events, isLoading, isError } = useWebhookEvents(companyId);
  const { data: config } = useWebhookConfig(companyId);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const redeliver = useRedeliver();

  function handleRedeliver(event: WebhookEvent) {
    redeliver.mutate({ companyId, eventId: event.id }, { onSuccess: () => setOpenId(null) });
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-sm">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (isError) {
    return <StateCard heading={t('error.heading')} body={t('error.body')} />;
  }

  const rows = events ?? [];

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title={t('eventLog.empty.heading')}
        description={t('eventLog.empty.body')}
      />
    );
  }

  const openEvent = rows.find((e) => e.id === openId) ?? null;

  return (
    <div className="flex flex-col gap-lg">
      <StatsRow events={rows} />

      <div className="overflow-hidden rounded-[12px] border border-ink/10 bg-card">
        <Table>
          <TableHeader>
            <TableRow className="border-0 bg-ink hover:bg-ink">
              <TableHead className="text-[12px] uppercase tracking-[.02em] text-paper/85">
                {t('eventLog.table.type')}
              </TableHead>
              <TableHead className="text-[12px] uppercase tracking-[.02em] text-paper/85">
                {t('eventLog.table.created')}
              </TableHead>
              <TableHead className="text-[12px] uppercase tracking-[.02em] text-paper/85">
                {t('eventLog.table.status')}
              </TableHead>
              <TableHead className="text-[12px] uppercase tracking-[.02em] text-paper/85">
                {t('eventLog.table.attempts')}
              </TableHead>
              <TableHead className="text-paper/85" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((event) => {
              const isOpen = openId === event.id;
              return (
                <TableRow
                  key={event.id}
                  className="cursor-pointer hover:bg-[#faf7f2]"
                  onClick={() => setOpenId(isOpen ? null : event.id)}
                >
                  <TableCell>
                    <CodeChip>{event.event_type}</CodeChip>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(event.created_at).toLocaleString('de-DE')}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={event.status} />
                  </TableCell>
                  <TableCell className="font-mono text-label text-foreground">
                    {event.attempts}
                  </TableCell>
                  <TableCell className="text-right">
                    <button
                      type="button"
                      aria-label={isOpen ? t('eventLog.collapse') : t('eventLog.expand')}
                      aria-expanded={isOpen}
                      className="inline-flex text-muted-foreground transition-colors hover:text-ink"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenId(isOpen ? null : event.id);
                      }}
                    >
                      <ChevronRight aria-hidden className="size-4" />
                    </button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {openEvent ? (
        <PayloadDrawer
          event={openEvent}
          companyName={companyName}
          targetUrl={config?.target_url ?? null}
          onClose={() => setOpenId(null)}
          onRedeliver={handleRedeliver}
          redelivering={redeliver.isPending}
        />
      ) : null}
    </div>
  );
}

/** The 4-card stats summary (delivered / pending / dead_letter / total), Space-Grotesk numerals. */
function StatsRow({ events }: { events: WebhookEvent[] }) {
  const { t } = useTranslation('webhooks');
  const delivered = events.filter((e) => e.status === 'delivered').length;
  const pending = events.filter((e) => e.status === 'pending').length;
  const deadLetter = events.filter((e) => e.status === 'dead_letter').length;

  const cards = [
    { label: t('stats.delivered'), value: delivered, tone: 'text-pine' },
    { label: t('stats.pending'), value: pending, tone: 'text-porch' },
    { label: t('stats.deadLetter'), value: deadLetter, tone: 'text-brick' },
    { label: t('stats.total'), value: events.length, tone: 'text-ink' },
  ] as const;

  return (
    <div className="grid grid-cols-4 gap-md">
      {cards.map((c) => (
        <div key={c.label} className="rounded-[12px] border border-ink/10 bg-card px-[18px] py-md">
          <div className="mb-sm text-[11px] font-medium uppercase tracking-[.02em] text-muted-foreground">
            {c.label}
          </div>
          <div className={`font-display text-[26px] leading-[28px] tabular-nums ${c.tone}`}>
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Status pill — the reserved semantic set, ALWAYS icon + label (never colour
 * alone). Shared with the PayloadDrawer header (DRY / SSOT).
 */
export function StatusBadge({ status }: { status: WebhookStatus }) {
  const { t } = useTranslation('webhooks');
  const { variant, icon: Icon } = STATUS_META[status];
  return (
    <Badge
      variant={variant}
      className="gap-[6px] rounded-full border px-[9px] py-[3px] text-[11px]"
    >
      <Icon aria-hidden className="size-3" />
      {t(`eventLog.status.${status}`)}
    </Badge>
  );
}

function StateCard({ heading, body }: { heading: string; body: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-sm p-xl text-center">
        <p className="font-display text-heading text-foreground">{heading}</p>
        <p className="text-body text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}
