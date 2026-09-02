import { CodeChip } from '@/components/CodeChip';
import { EmptyState } from '@/components/EmptyState';
import { AlertTriangle, CheckCircle2, Clock, FileText, Inbox, Loader2, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import {
  type DealPdfStatus,
  type DealRow,
  type DeliveryState,
  type DeliveryStatus,
  openDealPdf,
  useDeliveryStates,
  useRecentDeals,
} from './useDeals';

/**
 * QUICK-F99 — `/abschluesse`: the list of INDIVIDUAL closed deals, with a
 * per-row document action.
 *
 * There is NO role branching in this component, on purpose (D-3). Which deals
 * a caller sees is decided by `visible_contracts` RLS through the
 * `security_invoker` view behind `useRecentDeals`; a team lead and an operator
 * therefore land on the same screen and simply see different rows. Adding a
 * role check here would be a second, drifting copy of that rule.
 *
 * The non-ready document outcomes get their own per-row copy: "noch nicht
 * fertig" is a wait (the render dispatcher runs on a cron, roughly a minute
 * after signature) and must never look like the failure or the offline case.
 */

const PLACEHOLDER = '—';

const STATUS_PILL = {
  signed: 'border-porch/30 bg-porch/[.12] text-[#b56a1c]',
  cancelled: 'border-brick/25 bg-brick/[.08] text-brick',
} as const;
const STATUS_DOT = { signed: 'bg-porch', cancelled: 'bg-brick' } as const;

/**
 * QUICK-GTI (Befund 4): the Zustellung pill. Reuses the register
 * EventLogTable already established for exactly these three render/webhook
 * states (delivered = Pine check-circle, pending = Amber clock, dead_letter =
 * Brick alert-triangle) rather than inventing a second vocabulary for the same
 * job. Every state pairs an ICON with a LABEL — never colour alone.
 */
const DELIVERY_PILL: Record<DeliveryStatus, { className: string; icon: LucideIcon }> = {
  delivered: { className: 'border-pine/30 bg-pine/[.12] text-pine', icon: CheckCircle2 },
  pending: { className: 'border-porch/30 bg-porch/[.12] text-[#b56a1c]', icon: Clock },
  dead_letter: { className: 'border-brick/25 bg-brick/[.08] text-brick', icon: AlertTriangle },
};

/**
 * A contract with NO delivery state is not a contract with a pending one: the
 * RPC returns absence for "no render job was ever dispatched" on purpose
 * (0092). Rendering the placeholder is the honest outcome; guessing 'pending'
 * would recreate the exact ambiguity this column exists to remove.
 */
function DeliveryCell({ state }: { state: DeliveryState | undefined }) {
  const { t } = useTranslation('deals');
  if (!state) {
    return <span className="text-[13px] text-muted-foreground">{PLACEHOLDER}</span>;
  }
  const { className, icon: Icon } = DELIVERY_PILL[state.status];
  // The reason a job died belongs at the row, not on a second screen.
  const title =
    state.status === 'dead_letter'
      ? t('delivery.attemptsHint', { attempts: state.attempts, error: state.lastError ?? '' })
      : undefined;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-[6px] rounded-full border px-[9px] py-[3px] text-[11px] font-medium ${className}`}
    >
      <Icon aria-hidden className="size-[12px]" />
      {t(`delivery.${state.status}`)}
    </span>
  );
}

/** `DD.MM.YYYY`, locale-free so the rendered value is stable. Pure. */
export function formatSignedAt(iso: string | null): string {
  if (!iso) return PLACEHOLDER;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return PLACEHOLDER;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

export function DealsPage() {
  const { t } = useTranslation('deals');
  const { data: deals, isLoading, isError } = useRecentDeals();
  // A transport error here must NOT blank the deals table — the Zustellung
  // column simply falls back to the placeholder for every row.
  const { data: deliveryStates } = useDeliveryStates();

  return (
    <div className="mx-auto max-w-[980px]">
      <header className="mb-[20px]">
        <h1 className="mb-[4px] font-display text-[28px] font-medium leading-[34px] text-ink">
          {t('title')}
        </h1>
        <p className="text-[14px] leading-[20px] text-muted-foreground">{t('subtitle')}</p>
      </header>

      {isLoading ? (
        <div className="flex items-center justify-center py-[48px] text-muted-foreground">
          <Loader2 aria-hidden className="size-[20px] animate-spin" />
        </div>
      ) : isError ? (
        <EmptyState
          icon={TriangleAlert}
          tone="muted"
          title={t('error.heading')}
          description={t('error.body')}
        />
      ) : (deals?.length ?? 0) === 0 ? (
        <EmptyState icon={Inbox} title={t('empty.heading')} description={t('empty.body')} />
      ) : (
        <div className="overflow-hidden rounded-[12px] border border-ink/10 bg-card">
          <div className="grid grid-cols-[1.4fr_1.4fr_1.1fr_.9fr_.9fr_1.1fr_1.1fr] bg-ink px-[16px] text-[12px] font-medium uppercase tracking-[.02em] text-paper/85">
            <div className="py-[13px]">{t('table.reference')}</div>
            <div className="py-[13px]">{t('table.customer')}</div>
            <div className="py-[13px]">{t('table.rep')}</div>
            <div className="py-[13px]">{t('table.signedAt')}</div>
            <div className="py-[13px]">{t('table.status')}</div>
            <div className="py-[13px]">{t('delivery.header')}</div>
            <div className="py-[13px] text-right">{t('table.document')}</div>
          </div>
          {deals?.map((deal) => (
            <DealRowView
              key={deal.id}
              deal={deal}
              delivery={deliveryStates?.get(deal.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DealRowView({ deal, delivery }: { deal: DealRow; delivery: DeliveryState | undefined }) {
  const { t } = useTranslation('deals');
  const [pdfState, setPdfState] = React.useState<DealPdfStatus | null>(null);
  const [busy, setBusy] = React.useState(false);

  const handleOpen = async () => {
    setBusy(true);
    setPdfState(null);
    const status = await openDealPdf(deal.id);
    setBusy(false);
    // 'ready' already opened the document in a new tab — nothing to say.
    setPdfState(status === 'ready' ? null : status);
  };

  return (
    <div className="grid min-h-[56px] grid-cols-[1.4fr_1.4fr_1.1fr_.9fr_.9fr_1.1fr_1.1fr] items-center border-b border-ink/[.06] px-[16px] py-[10px]">
      <div className="min-w-0 pr-[10px]">
        <CodeChip className="whitespace-nowrap">
          {deal.deal_reference ?? deal.id.slice(0, 8)}
        </CodeChip>
      </div>
      <div className="truncate pr-[10px] text-[14px] font-medium text-ink">
        {deal.customer_name ?? PLACEHOLDER}
      </div>
      <div className="truncate pr-[10px] text-[13px] text-muted-foreground">
        {deal.rep_name ?? PLACEHOLDER}
      </div>
      <div className="pr-[10px] text-[13px] text-muted-foreground">
        {formatSignedAt(deal.signed_at)}
      </div>
      <div>
        {deal.latest_status ? (
          <span
            className={`inline-flex items-center gap-[6px] rounded-full border px-[9px] py-[3px] text-[11px] font-medium ${STATUS_PILL[deal.latest_status]}`}
          >
            <span className={`size-[6px] rounded-full ${STATUS_DOT[deal.latest_status]}`} />
            {t(`status.${deal.latest_status}`)}
          </span>
        ) : (
          <span className="text-[13px] text-muted-foreground">{PLACEHOLDER}</span>
        )}
      </div>
      <div>
        <DeliveryCell state={delivery} />
      </div>
      <div className="flex items-center justify-end gap-[8px]">
        {pdfState ? (
          <span className="truncate text-[12px] text-muted-foreground">{t(`pdf.${pdfState}`)}</span>
        ) : null}
        <button
          type="button"
          aria-label={t('openCta')}
          disabled={busy}
          onClick={() => void handleOpen()}
          className="inline-flex size-[32px] flex-none items-center justify-center rounded-[8px] border border-ink/[.16] bg-card text-ink transition-colors hover:bg-[#faf7f2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-porch/40 disabled:opacity-50"
        >
          <FileText aria-hidden className="size-[16px]" strokeWidth={1.9} />
        </button>
      </div>
    </div>
  );
}
