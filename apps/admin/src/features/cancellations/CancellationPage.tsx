import { CodeChip } from '@/components/CodeChip';
import { EmptyState } from '@/components/EmptyState';
import {
  AlertTriangle,
  Ban,
  Check,
  ChevronLeft,
  FileSearch,
  FileX,
  Search,
  SearchX,
  Webhook,
  X,
} from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import {
  type ContractRow,
  type ContractStatusEvent,
  deriveStatus,
  useContractEvents,
  useContractSearch,
  useRecordCancellation,
} from './useCancellation';

/**
 * Widerruf screen (D-18), re-skinned strictly 1:1 to `Widerruf.dc.html`. Two
 * views inside the AppShell `<main>`: a SEARCH view (look a contract up by
 * deal_reference) and, once a row is picked, a DETAIL view (contract summary +
 * append-only status timeline + a brick-accent "Widerruf erfassen" card behind a
 * destructive confirm dialog).
 *
 * Recording INSERTs one immutable `cancelled` contract_status_events row (no
 * edit/delete affordance anywhere — T-05-38); it then appears in the timeline,
 * driving the derived status to "Widerrufen" and swapping the action card for the
 * already-revoked banner. A bottom-right toast confirms the append.
 *
 * Customer, company, product, commission amount, rep, withdrawal deadline and the
 * per-row status are wired from cancellation_contract_detail (0055). customer_name
 * is nullable until the mobile checkout populates it, so it keeps an honest "—"
 * when absent (all other cells now resolve to real values). Off-token shades
 * (#8792a6, #b56a1c) resolve to their nearest token.
 */

const PLACEHOLDER = '—';

/* status pill (mock statusMap) — only the two derived states can actually occur */
const STATUS_PILL = {
  signed: 'border-porch/30 bg-porch/[.12] text-[#b56a1c]',
  cancelled: 'border-brick/25 bg-brick/[.08] text-brick',
} as const;
const STATUS_DOT = { signed: 'bg-porch', cancelled: 'bg-brick' } as const;

export function CancellationPage() {
  const [selected, setSelected] = React.useState<ContractRow | null>(null);
  const [toast, setToast] = React.useState('');
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const fireToast = React.useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  }, []);

  React.useEffect(() => () => clearTimeout(toastTimer.current), []);

  return (
    <>
      {selected ? (
        <DetailView contract={selected} onBack={() => setSelected(null)} onRecorded={fireToast} />
      ) : (
        <SearchView onSelect={setSelected} />
      )}
      <Toast message={toast} />
    </>
  );
}

/* ------------------------------------------------------------------ SEARCH */

function SearchView({ onSelect }: { onSelect: (c: ContractRow) => void }) {
  const { t } = useTranslation('cancellations');
  const [query, setQuery] = React.useState('');
  const trimmed = query.trim();
  const { data: results, isLoading, isError } = useContractSearch(query);

  return (
    <div className="mx-auto max-w-[820px]">
      <header className="mb-[20px]">
        <h1 className="mb-[4px] font-display text-[28px] font-medium leading-[34px] text-ink">
          {t('title')}
        </h1>
        <p className="text-[14px] leading-[20px] text-muted-foreground">{t('subtitle')}</p>
      </header>

      <div className="relative mb-[20px]">
        <Search
          aria-hidden
          strokeWidth={2}
          className="pointer-events-none absolute left-[14px] top-[14px] size-[18px] text-muted-foreground"
        />
        <input
          aria-label={t('search.label')}
          placeholder={t('search.placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-[48px] w-full rounded-[11px] border border-ink/[.16] bg-card pl-[42px] pr-[14px] text-[15px] text-ink transition-colors placeholder:text-muted-foreground focus-visible:border-porch focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-porch/20"
        />
      </div>

      {trimmed.length === 0 ? (
        <EmptyState
          icon={FileSearch}
          title={t('searchEmpty.heading')}
          description={t('searchEmpty.body')}
        />
      ) : isLoading ? null : isError ? (
        <StateCard heading={t('error.heading')} body={t('error.body')} />
      ) : (
        <div className="overflow-hidden rounded-[12px] border border-ink/10 bg-card">
          <div className="grid grid-cols-[1.5fr_1.6fr_1.4fr_1fr] bg-ink px-[16px] text-[12px] font-medium uppercase tracking-[.02em] text-paper/85">
            <div className="py-[13px]">{t('table.reference')}</div>
            <div className="py-[13px]">{t('table.customer')}</div>
            <div className="py-[13px]">{t('table.company')}</div>
            <div className="py-[13px] text-right">{t('table.status')}</div>
          </div>

          {(results?.length ?? 0) === 0 ? (
            <EmptyState
              icon={SearchX}
              title={t('noResults.heading')}
              description={t('noResults.body', { query: trimmed })}
            />
          ) : (
            results?.map((contract) => (
              <SearchRow key={contract.id} contract={contract} onSelect={onSelect} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function SearchRow({
  contract,
  onSelect,
}: {
  contract: ContractRow;
  onSelect: (c: ContractRow) => void;
}) {
  const { t } = useTranslation('cancellations');
  const ref = contract.deal_reference ?? contract.id.slice(0, 8);
  return (
    // Mock rows are click-only; kept 1:1 visually but exposed as a native,
    // keyboard-operable button ("Auswählen") for AT and the select test.
    <button
      type="button"
      aria-label={t('select')}
      onClick={() => onSelect(contract)}
      className="grid min-h-[56px] w-full cursor-pointer grid-cols-[1.5fr_1.6fr_1.4fr_1fr] items-center border-b border-ink/[.06] px-[16px] py-[10px] text-left hover:bg-[#faf7f2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-porch/40"
    >
      <div className="min-w-0 pr-[10px]">
        <CodeChip className="whitespace-nowrap">{ref}</CodeChip>
      </div>
      {/* Kunde — customer_name (0055); nullable until the mobile checkout sets it. */}
      <div className="truncate pr-[10px] text-[14px] font-medium text-ink">
        {contract.customer_name ?? PLACEHOLDER}
      </div>
      {/* Unternehmen — company_name (0055). */}
      <div className="flex min-w-0 items-center gap-[9px]">
        <div className="flex size-[22px] flex-none items-center justify-center rounded-[6px] bg-ink/10 font-display text-[10px] font-medium text-ink">
          {companyInitials(contract.company_name)}
        </div>
        <span className="truncate text-[13px] text-muted-foreground">
          {contract.company_name ?? PLACEHOLDER}
        </span>
      </div>
      {/* Status — latest_status from the view (no per-row N+1 anymore). */}
      <div className="text-right">
        {contract.latest_status ? (
          <StatusPill status={contract.latest_status} />
        ) : (
          <span className="inline-flex items-center gap-[6px] rounded-full border border-ink/10 bg-ink/[.03] px-[9px] py-[3px] text-[11px] font-medium text-muted-foreground">
            <span className="size-[6px] rounded-full bg-muted-foreground" />
            {PLACEHOLDER}
          </span>
        )}
      </div>
    </button>
  );
}

/** Two-letter initials from a company name (falls back to the em-dash). */
function companyInitials(name: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const chars = parts
    .slice(0, 2)
    .map((p) => p.charAt(0))
    .join('')
    .toUpperCase();
  return chars || PLACEHOLDER;
}

/* ------------------------------------------------------------------ DETAIL */

function DetailView({
  contract,
  onBack,
  onRecorded,
}: {
  contract: ContractRow;
  onBack: () => void;
  onRecorded: (msg: string) => void;
}) {
  const { t } = useTranslation('cancellations');
  const { data: events } = useContractEvents(contract.id);
  const record = useRecordCancellation();

  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [errored, setErrored] = React.useState(false);

  const timeline = events ?? [];
  const status = deriveStatus(timeline);
  const alreadyCancelled = status === 'cancelled';
  const ref = contract.deal_reference ?? contract.id.slice(0, 8);

  function confirmRecord() {
    setErrored(false);
    record.mutate(
      { contractId: contract.id, companyId: contract.company_id, reason: null },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          onRecorded(t('toast.recorded'));
        },
        onError: () => setErrored(true),
      },
    );
  }

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-[16px] [animation:fdsFade_.3s_ease_both]">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-[6px] self-start text-[13px] text-muted-foreground transition-colors hover:text-ink"
      >
        <ChevronLeft aria-hidden strokeWidth={2} className="size-4" />
        {t('back')}
      </button>

      {/* Contract summary */}
      <section className="rounded-[12px] border border-ink/10 bg-card p-[26px]">
        <div className="flex items-start justify-between gap-[20px]">
          <div className="min-w-0">
            <div className="mb-[8px] flex items-center gap-[10px]">
              <CodeChip>{ref}</CodeChip>
              <StatusPill status={status} />
            </div>
            {/* Kunde name — customer_name (0055); nullable until the checkout sets it. */}
            <div className="font-display text-[22px] font-medium leading-[26px] text-ink">
              {contract.customer_name ?? PLACEHOLDER}
            </div>
          </div>
          <div className="flex-none text-right">
            {/* Provision amount — commission_amount_eur (0055/0053). */}
            <div className="font-display text-[22px] font-medium tabular-nums text-ink">
              {contract.commission_amount_eur == null
                ? PLACEHOLDER
                : formatEur(contract.commission_amount_eur)}
            </div>
            <div className="mt-[2px] text-[12px] text-muted-foreground">
              {t('detail.commission')}
            </div>
          </div>
        </div>
        <dl className="mt-[22px] grid grid-cols-2 gap-x-[20px] gap-y-[14px] border-t border-ink/[.08] pt-[20px] text-[13px]">
          <MetaRow label={t('detail.company')} value={contract.company_name ?? PLACEHOLDER} />
          <MetaRow label={t('detail.product')} value={contract.product_name ?? PLACEHOLDER} />
          <MetaRow label={t('detail.rep')} value={contract.rep_name ?? PLACEHOLDER} />
          <MetaRow
            label={t('detail.deadline')}
            value={contract.withdrawal_deadline ? fmtDate(contract.withdrawal_deadline) : PLACEHOLDER}
          />
        </dl>
      </section>

      {/* Append-only timeline */}
      <section className="rounded-[12px] border border-ink/10 bg-card p-[26px]">
        <div className="mb-[4px] font-display text-[16px] font-medium text-ink">
          {t('timeline.heading')}
        </div>
        <div className="mb-[20px] text-[12px] text-muted-foreground">
          {t('timeline.appendOnly')}
        </div>
        {timeline.length === 0 ? (
          <p className="text-[14px] text-muted-foreground">{t('timeline.empty')}</p>
        ) : (
          <ol className="flex flex-col">
            {timeline.map((event, i) => (
              <TimelineItem key={event.id} event={event} last={i === timeline.length - 1} />
            ))}
          </ol>
        )}
      </section>

      {/* Record action / already-revoked banner */}
      {alreadyCancelled ? (
        <div className="flex items-center gap-[10px] rounded-[12px] border border-brick/20 bg-brick/5 px-[26px] py-[18px] text-[14px] font-medium text-brick">
          <Ban aria-hidden strokeWidth={2.2} className="size-[18px] shrink-0" />
          {t('selected.alreadyCancelled')}
        </div>
      ) : (
        <div className="rounded-[12px] border border-brick/30 bg-card px-[26px] py-[22px]">
          <div className="flex items-center justify-between gap-[16px]">
            <div className="max-w-[440px]">
              <div className="mb-[3px] font-display text-[15px] font-medium text-brick">
                {t('selected.recordTitle')}
              </div>
              <div className="text-[13px] text-muted-foreground">{t('selected.recordBody')}</div>
            </div>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="inline-flex h-[42px] flex-none items-center gap-[8px] rounded-[9px] bg-brick px-[18px] text-[14px] font-medium text-paper transition-colors hover:bg-[#a82e25]"
            >
              <FileX aria-hidden strokeWidth={2} className="size-4" />
              {t('selected.record')}
            </button>
          </div>
        </div>
      )}

      {errored ? (
        <p role="alert" className="text-[14px] text-destructive">
          {t('errors.generic')}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        contractRef={ref}
        pending={record.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={confirmRecord}
      />
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </div>
  );
}

function TimelineItem({ event, last }: { event: ContractStatusEvent; last: boolean }) {
  const { t } = useTranslation('cancellations');
  const cancelled = event.event_type === 'cancelled';
  return (
    <li className="flex gap-[14px]">
      <div className="flex flex-none flex-col items-center">
        <span
          className={
            cancelled
              ? 'flex size-[30px] items-center justify-center rounded-full border-2 border-brick/30 bg-brick/10 text-brick'
              : 'flex size-[30px] items-center justify-center rounded-full border-2 border-pine/30 bg-pine/[.12] text-pine'
          }
        >
          {cancelled ? (
            <X aria-hidden className="size-3.5" strokeWidth={2.6} />
          ) : (
            <Check aria-hidden className="size-3.5" strokeWidth={2.6} />
          )}
        </span>
        {last ? null : <span className="my-[2px] min-h-[22px] w-0.5 flex-1 bg-ink/[.12]" />}
      </div>
      <div className={last ? 'pb-0' : 'pb-[10px]'}>
        <div
          className={
            cancelled ? 'text-[14px] font-medium text-brick' : 'text-[14px] font-medium text-ink'
          }
        >
          {t(`event.${event.event_type}`)}
        </div>
        <div className="mt-[2px] font-mono text-[12px] text-muted-foreground">
          {fmtDateTime(event.occurred_at)}
          {event.reason ? ` · ${event.reason}` : ''}
        </div>
      </div>
    </li>
  );
}

/* ------------------------------------------------------- confirm + toast */

function ConfirmDialog({
  open,
  contractRef,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  contractRef: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation('cancellations');
  const titleId = React.useId();
  const descId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/40 backdrop-blur-[2px] [animation:fdsFade_.2s_ease_both]"
      onMouseDown={onCancel}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: native <dialog> can't take the
          custom backdrop-click + centered-panel layout this destructive confirm needs. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="w-[460px] max-w-[calc(100vw-32px)] overflow-hidden rounded-[14px] bg-card shadow-[0_20px_60px_rgba(18,32,58,.3)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex gap-[16px] p-[26px] pb-0">
          <div className="flex size-[44px] flex-none items-center justify-center rounded-[11px] bg-brick/10 text-brick">
            <AlertTriangle aria-hidden strokeWidth={2.2} className="size-[22px]" />
          </div>
          <div>
            <h2
              id={titleId}
              className="mb-[8px] font-display text-[19px] font-medium leading-[24px] text-ink"
            >
              {t('confirm.title', { ref: contractRef })}
            </h2>
            <p id={descId} className="text-[14px] leading-[20px] text-muted-foreground">
              {t('confirm.bodyLead')}{' '}
              <b className="font-medium text-brick">{t('confirm.irreversible')}</b>
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-[10px] p-[26px] py-[24px]">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="h-[42px] rounded-[9px] border border-ink/[.16] bg-card px-[18px] text-[14px] font-medium text-ink transition-colors hover:bg-[#f0f1f4] disabled:pointer-events-none disabled:opacity-50"
          >
            {t('confirm.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="inline-flex h-[42px] items-center gap-[8px] rounded-[9px] bg-brick px-[18px] text-[14px] font-medium text-paper transition-colors hover:bg-[#a82e25] disabled:pointer-events-none disabled:opacity-50"
          >
            <Check aria-hidden strokeWidth={2} className="size-4" />
            {t('confirm.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Toast({ message }: { message: string }) {
  if (!message) return null;
  return (
    <output className="fixed bottom-[24px] right-[24px] z-[70] flex items-center gap-[10px] rounded-[10px] bg-ink px-[18px] py-[13px] text-paper shadow-[0_8px_28px_rgba(18,32,58,.25)] [animation:fdsFade_.3s_ease_both]">
      <Webhook aria-hidden strokeWidth={2.4} className="size-[18px] text-porch" />
      <span className="text-[14px] font-medium">{message}</span>
    </output>
  );
}

/* ---------------------------------------------------------------- shared */

function StatusPill({ status }: { status: 'signed' | 'cancelled' }) {
  const { t } = useTranslation('cancellations');
  return (
    <span
      className={`inline-flex items-center gap-[6px] rounded-full border px-[10px] py-[3px] text-[11px] font-medium ${STATUS_PILL[status]}`}
    >
      <span className={`size-[6px] rounded-full ${STATUS_DOT[status]}`} />
      {t(`derived.${status}`)}
    </span>
  );
}

function StateCard({ heading, body }: { heading: string; body: string }) {
  return (
    <div className="rounded-[12px] border border-ink/10 bg-card p-[48px] text-center">
      <p className="font-display text-[16px] font-medium text-ink">{heading}</p>
      <p className="mt-[8px] text-[14px] text-muted-foreground">{body}</p>
    </div>
  );
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('de-DE');
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('de-DE');
}

/** de-DE EUR, no decimals — matches the commission formatting elsewhere. */
function formatEur(value: number): string {
  return value.toLocaleString('de-DE', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  });
}
