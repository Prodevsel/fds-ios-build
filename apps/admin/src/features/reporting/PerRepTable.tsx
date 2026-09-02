import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { InviteEmptyState, categoricalColor, repInitials } from './chartPrimitives';
import type { DealsPerRep } from './useReporting';

type SortKey = 'name' | 'closes' | 'commission' | 'avgDeal';
type SortDir = 'asc' | 'desc';

/** de-DE EUR, no decimals — matches the KPI/commission formatting elsewhere. */
function formatEur(value: number): string {
  return value.toLocaleString('de-DE', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  });
}

/** grid-template-columns from the design: 2fr 1fr 1.2fr 1fr 1fr (total 6.2 units). */
const COL_WIDTHS = ['32.258%', '16.129%', '19.355%', '16.129%', '16.129%'] as const;

/**
 * Per-rep table (ADMN-03) — ported 1:1 from the Reporting.dc.html: the five-column
 * Ink-Navy sortable header (Sales Rep · Abschlüsse · Provision · Quote · Ø Deal),
 * an avatar (categorical hue + initials) + company sub-label beside each rep name,
 * counts in JetBrains Mono / tabular-nums, the #faf7f2 row hover, and a "Team
 * gesamt" total footer. Provision + Ø Deal are wired from reporting_commission_per_rep
 * (0053, joined by rep_id) and their headers are sortable, as is the total row.
 * Quote/Abschlussquote and the company sub-label still have NO backing (4.4 is
 * undecided; company is not modeled on the view) — those keep the honest in-place
 * "—" placeholder. A no-reps team shows the invite CTA. Sortable columns are the
 * four backed by real data (name, deals, commission, avgDeal).
 */
export function PerRepTable({ data, isLoading }: { data?: DealsPerRep[]; isLoading: boolean }) {
  const { t } = useTranslation('reporting');
  const [sortKey, setSortKey] = React.useState<SortKey>('closes');
  const [sortDir, setSortDir] = React.useState<SortDir>('desc');
  const noData = t('table.noData');

  const reps = data ?? [];
  // Alphabetical arrival index fixes each rep's avatar hue (color follows entity).
  const colorByRep = new Map(reps.map((rep, i) => [rep.repId, categoricalColor(i)]));

  const sorted = reps.slice().sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortKey === 'name') {
      return (a.repName ?? '').localeCompare(b.repName ?? '', 'de', { sensitivity: 'base' }) * dir;
    }
    if (sortKey === 'commission') {
      return ((a.commissionSumEur ?? -1) - (b.commissionSumEur ?? -1)) * dir;
    }
    if (sortKey === 'avgDeal') {
      return ((a.avgDealEur ?? -1) - (b.avgDealEur ?? -1)) * dir;
    }
    return (a.deals - b.deals) * dir;
  });
  const totalDeals = reps.reduce((sum, r) => sum + r.deals, 0);
  // Team totals: Provision = Σ commission; Ø Deal = Σ commission / Σ commissionDeals.
  // The denominator is the 0053 closed-set count (not the 0048 `deals`, which
  // includes later-cancelled signings) so numerator and denominator share one
  // closed set — otherwise the footer Ø Deal disagrees with the per-row values
  // and drifts after every Widerruf.
  const hasCommission = reps.some((r) => r.commissionSumEur !== null);
  const totalCommission = reps.reduce((sum, r) => sum + (r.commissionSumEur ?? 0), 0);
  const totalCommissionDeals = reps.reduce((sum, r) => sum + (r.commissionDeals ?? 0), 0);
  const teamAvgDeal = totalCommissionDeals > 0 ? totalCommission / totalCommissionDeals : null;

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };
  const arrow = (key: SortKey) => (key === sortKey ? (sortDir === 'asc' ? '▲' : '▼') : '');
  const sortHint = sortDir === 'asc' ? t('table.sortAsc') : t('table.sortDesc');

  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-[12px] border border-ink/10 bg-white">
        <div className="flex flex-col gap-sm p-md">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      </div>
    );
  }

  if (reps.length === 0) {
    return (
      <div className="overflow-hidden rounded-[12px] border border-ink/10 bg-white">
        <InviteEmptyState />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[12px] border border-ink/10 bg-white">
      <table className="w-full caption-bottom border-collapse text-body">
        <caption className="sr-only">{t('perRep.title')}</caption>
        <colgroup>
          {COL_WIDTHS.map((w) => (
            <col key={w} style={{ width: w }} />
          ))}
        </colgroup>
        <thead className="bg-ink">
          <tr>
            <SortHeader
              label={t('table.rep')}
              arrow={arrow('name')}
              active={sortKey === 'name'}
              sortHint={sortHint}
              align="left"
              onClick={() => toggleSort('name')}
            />
            <SortHeader
              label={t('table.deals')}
              arrow={arrow('closes')}
              active={sortKey === 'closes'}
              sortHint={sortHint}
              align="right"
              onClick={() => toggleSort('closes')}
            />
            <SortHeader
              label={t('table.commission')}
              arrow={arrow('commission')}
              active={sortKey === 'commission'}
              sortHint={sortHint}
              align="right"
              onClick={() => toggleSort('commission')}
            />
            <StaticHeader label={t('table.quote')} />
            <SortHeader
              label={t('table.avgDeal')}
              arrow={arrow('avgDeal')}
              active={sortKey === 'avgDeal'}
              sortHint={sortHint}
              align="right"
              onClick={() => toggleSort('avgDeal')}
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((rep) => (
            <tr
              key={rep.repId}
              className="border-b border-ink/[0.06] transition-colors hover:bg-[#faf7f2]"
            >
              <td className="px-md py-sm align-middle">
                <div className="flex min-h-[38px] items-center gap-[11px]">
                  <span
                    aria-hidden
                    className="flex size-[30px] shrink-0 items-center justify-center rounded-full font-display text-[12px] font-medium text-white"
                    style={{ backgroundColor: colorByRep.get(rep.repId) ?? categoricalColor(0) }}
                  >
                    {repInitials(rep.repName)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium text-ink">
                      {rep.repName ?? t('table.unnamed')}
                    </div>
                    <div className="text-[11px] text-[#8792a6]">{noData}</div>
                  </div>
                </div>
              </td>
              <td className="px-md py-sm text-right align-middle font-mono text-[13px] font-medium tabular-nums text-ink">
                {rep.deals}
              </td>
              <td
                className={cn(
                  'px-md py-sm text-right align-middle font-mono text-[13px] tabular-nums',
                  rep.commissionSumEur === null ? 'text-[#8792a6]' : 'font-medium text-ink',
                )}
              >
                {rep.commissionSumEur === null ? noData : formatEur(rep.commissionSumEur)}
              </td>
              {/* Quote/Abschlussquote — no attempts/lost denominator exists (4.4, undecided). */}
              <td className="px-md py-sm text-right align-middle font-mono text-[13px] tabular-nums text-[#8792a6]">
                {noData}
              </td>
              <td
                className={cn(
                  'px-md py-sm text-right align-middle font-mono text-[13px] tabular-nums',
                  rep.avgDealEur === null ? 'text-[#8792a6]' : 'text-ink',
                )}
              >
                {rep.avgDealEur === null ? noData : formatEur(rep.avgDealEur)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-[#fafbfc]">
            <td className="px-md py-sm align-middle text-[13px] font-medium text-[#5C6B85]">
              {t('table.teamTotal')}
            </td>
            <td className="px-md py-sm text-right align-middle font-mono text-[13px] font-medium tabular-nums text-ink">
              {totalDeals}
            </td>
            <td
              className={cn(
                'px-md py-sm text-right align-middle font-mono text-[13px] font-medium tabular-nums',
                hasCommission ? 'text-ink' : 'text-[#8792a6]',
              )}
            >
              {hasCommission ? formatEur(totalCommission) : noData}
            </td>
            {/* Quote total — same undecided 4.4 gap as the per-rep column. */}
            <td className="px-md py-sm text-right align-middle font-mono text-[13px] tabular-nums text-[#5C6B85]">
              {noData}
            </td>
            <td
              className={cn(
                'px-md py-sm text-right align-middle font-mono text-[13px] font-medium tabular-nums',
                teamAvgDeal === null ? 'text-[#8792a6]' : 'text-ink',
              )}
            >
              {teamAvgDeal === null ? noData : formatEur(teamAvgDeal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function SortHeader({
  label,
  arrow,
  active,
  sortHint,
  align,
  onClick,
}: {
  label: string;
  arrow: string;
  active: boolean;
  sortHint: string;
  align: 'left' | 'right';
  onClick: () => void;
}) {
  return (
    <th
      scope="col"
      aria-sort={active ? (arrow === '▲' ? 'ascending' : 'descending') : 'none'}
      className="px-md"
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex w-full items-center gap-[5px] py-[13px] text-[12px] font-medium uppercase tracking-[0.02em]',
          align === 'right' ? 'justify-end' : 'justify-start',
          active ? 'text-paper' : 'text-paper/[0.85]',
        )}
      >
        {label}
        <span aria-hidden className="w-2 text-[9px]">
          {arrow}
        </span>
        {active ? <span className="sr-only">{sortHint}</span> : null}
      </button>
    </th>
  );
}

/**
 * A non-interactive column header for the placeholder (data-impossible) columns —
 * styled identically to the sortable header at rest so the Ink-Navy header row
 * matches the design 1:1, but carries no dead sort control for a column that has
 * no backing data to sort by.
 */
function StaticHeader({ label }: { label: string }) {
  return (
    <th
      scope="col"
      className="px-md py-[13px] text-right text-[12px] font-medium uppercase tracking-[0.02em] text-paper/[0.85]"
    >
      {label}
    </th>
  );
}
