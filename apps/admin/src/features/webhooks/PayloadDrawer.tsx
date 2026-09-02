import { CodeChip } from '@/components/CodeChip';
import { Button } from '@/components/ui/button';
import { RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { StatusBadge } from './EventLogTable';
import type { WebhookEvent } from './useWebhooks';

/** The fixed backoff ladder (webhook-dispatcher/backoff.ts) rendered for operators. */
const RETRY_LADDER = ['1 Min', '5 Min', '30 Min', '2 Std', '6 Std', '12 Std'] as const;

/**
 * PayloadDrawer — a right-side slide-in drawer (ported 1:1 from Webhooks.dc.html)
 * showing the detail for one `webhook_events` row: a Mono event-type chip + status
 * pill + stable `event_id` in the header, a meta grid (company / target URL / time /
 * status / attempts), and the THIN JSON payload in a dark JetBrains-Mono block (the
 * reserved signature element for API/webhook literals). For a dead_letter row it also
 * renders the 1min→…→12h backoff ladder (spent rungs marked), the last error, and the
 * "Erneut zustellen" redelivery action — redelivery is scoped to dead_letter ONLY
 * (05-UI-SPEC); for other statuses the action is shown disabled.
 */
export function PayloadDrawer({
  event,
  companyName,
  targetUrl,
  onClose,
  onRedeliver,
  redelivering,
}: {
  event: WebhookEvent;
  companyName: string;
  targetUrl: string | null;
  onClose: () => void;
  onRedeliver: (event: WebhookEvent) => void;
  redelivering: boolean;
}) {
  const { t } = useTranslation('webhooks');
  const isDeadLetter = event.status === 'dead_letter';

  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        aria-label={t('drawer.close')}
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default bg-ink/40 backdrop-blur-[2px] [animation:fdsFade_.2s_ease_both]"
      />

      {/* Panel */}
      <aside className="fixed inset-y-0 right-0 z-50 flex w-[460px] max-w-[calc(100vw-40px)] flex-col bg-paper shadow-[-12px_0_40px_rgba(18,32,58,0.2)] [animation:fdsFade_.28s_ease_both]">
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-md border-b border-ink/10 bg-card p-lg">
          <div className="flex min-w-0 flex-col gap-sm">
            <CodeChip className="w-fit">{event.event_type}</CodeChip>
            <div className="flex items-center gap-sm">
              <StatusBadge status={event.status} />
              <span className="truncate text-label text-muted-foreground">{event.event_id}</span>
            </div>
          </div>
          <button
            type="button"
            aria-label={t('drawer.close')}
            onClick={onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-ink/[.06] hover:text-ink"
          >
            <X aria-hidden className="size-[18px]" />
          </button>
        </div>

        {/* Body */}
        <div className="fds-scroll flex-1 overflow-y-auto p-lg">
          <dl className="mb-lg grid grid-cols-[auto_1fr] gap-x-md gap-y-sm text-body">
            <dt className="text-muted-foreground">{t('drawer.company')}</dt>
            <dd className="text-right font-medium text-foreground">{companyName}</dd>
            <dt className="text-muted-foreground">{t('drawer.targetUrl')}</dt>
            <dd className="break-all text-right font-mono text-label text-foreground">
              {targetUrl ?? '—'}
            </dd>
            <dt className="text-muted-foreground">{t('drawer.time')}</dt>
            <dd className="text-right text-foreground">
              {new Date(event.created_at).toLocaleString('de-DE')}
            </dd>
            <dt className="text-muted-foreground">{t('drawer.attempts')}</dt>
            <dd className="text-right font-mono text-label text-foreground">{event.attempts}</dd>
          </dl>

          {isDeadLetter ? (
            <div className="mb-lg flex flex-col gap-sm">
              <span className="text-label font-medium uppercase tracking-wide text-muted-foreground">
                {t('drawer.ladder')}
              </span>
              <p className="text-label text-muted-foreground">{t('drawer.ladderHint')}</p>
              <ol className="flex flex-wrap items-center gap-xs">
                {RETRY_LADDER.map((rung, index) => {
                  const spent = index < event.attempts;
                  return (
                    <li key={rung} className="flex items-center gap-xs">
                      <span
                        className={
                          spent
                            ? 'rounded-sm border border-brick/30 bg-brick/10 px-sm py-0.5 text-label font-medium text-brick'
                            : 'rounded-sm border border-ink/15 bg-ink/5 px-sm py-0.5 text-label text-muted-foreground'
                        }
                      >
                        {rung}
                      </span>
                      {index < RETRY_LADDER.length - 1 ? (
                        <span aria-hidden className="text-muted-foreground">
                          →
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}

          {isDeadLetter && event.last_error ? (
            <div className="mb-lg flex flex-col gap-xs">
              <span className="text-label font-medium uppercase tracking-wide text-muted-foreground">
                {t('drawer.lastError')}
              </span>
              <CodeChip className="w-fit text-brick">{event.last_error}</CodeChip>
            </div>
          ) : null}

          <div className="flex flex-col gap-xs">
            <span className="text-label font-medium uppercase tracking-wide text-muted-foreground">
              {t('drawer.payload')}
            </span>
            <pre className="overflow-x-auto rounded-md bg-ink p-md font-mono text-label leading-[18px] text-paper">
              {JSON.stringify(event.payload, null, 2)}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 gap-sm border-t border-ink/10 bg-card p-lg">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
            {t('drawer.close')}
          </Button>
          <Button
            type="button"
            className="flex-1"
            onClick={() => onRedeliver(event)}
            disabled={!isDeadLetter || redelivering}
            title={!isDeadLetter ? t('eventLog.redeliverHint') : undefined}
          >
            <RefreshCw aria-hidden className="size-4" />
            {redelivering ? t('eventLog.redelivering') : t('eventLog.redeliver')}
          </Button>
        </div>
      </aside>
    </>
  );
}
