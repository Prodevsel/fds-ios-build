import { EmptyState } from '@/components/EmptyState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LineChart } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChartToggle,
  RANGE_WEEK_COUNT,
  type ReportingRange,
  usePrefersReducedMotion,
} from './chartPrimitives';
import type { DealsPerWeek } from './useReporting';

const MAX_BAR_H = 130;

/**
 * Deals-per-week trend chart (ADMN-03) — ported 1:1 from the Reporting.dc.html:
 * a column chart of amber (Porch-Light accent) bars, each with its value above
 * (JetBrains Mono) and its ISO-week label below, on a 170px band. The selected
 * period scopes the series client-side to the trailing N ISO weeks (the 0048
 * views are all-time, see deviations). A `<table>`-view toggle exposes the same
 * series to screen readers / CVD users; the grow-in animation is skipped under
 * `prefers-reduced-motion`.
 */
export function DealsTrendChart({
  data,
  isLoading,
  range,
  rangeLabel,
}: {
  data?: DealsPerWeek[];
  isLoading: boolean;
  range: ReportingRange;
  rangeLabel: string;
}) {
  const { t } = useTranslation('reporting');
  const [showTable, setShowTable] = React.useState(false);
  const reducedMotion = usePrefersReducedMotion();

  // The 0048 weekly view only emits weeks that HAVE signed deals, ordered
  // ascending — scope to the trailing N weeks for the chosen period.
  const weeks = (data ?? []).slice(-RANGE_WEEK_COUNT[range]);
  const maxDeals = Math.max(1, ...weeks.map((w) => w.deals));

  return (
    <Card className="rounded-[12px] border-ink/10 px-[24px] py-[22px]">
      <CardHeader className="flex-row items-center justify-between gap-md p-0 pb-[18px]">
        <CardTitle className="font-display text-[16px] font-medium">{t('trend.title')}</CardTitle>
        {weeks.length > 0 ? (
          <div className="flex items-center gap-sm">
            <span className="text-[12px] text-[#8792a6]">
              {t('trend.caption', { range: rangeLabel })}
            </span>
            <ChartToggle showTable={showTable} onToggle={() => setShowTable((s) => !s)} />
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <Skeleton className="h-[170px] w-full" />
        ) : weeks.length === 0 ? (
          <EmptyState
            icon={LineChart}
            title={t('empty.heading')}
            description={t('empty.inPeriod')}
          />
        ) : showTable ? (
          <TrendTable weeks={weeks} />
        ) : (
          <div
            className="flex h-[170px] items-end gap-sm pt-sm"
            role="img"
            aria-label={t('trend.title')}
          >
            {weeks.map((w) => {
              const barH = Math.round((w.deals / maxDeals) * MAX_BAR_H);
              return (
                <div
                  key={w.weekStart}
                  className="flex h-full flex-1 flex-col items-center justify-end gap-sm"
                >
                  <div className="font-mono text-[11px] text-[#5C6B85]">{w.deals}</div>
                  <div
                    className={`w-full max-w-[34px] rounded-t-[6px] bg-porch ${
                      reducedMotion ? '' : 'fds-bar-rise'
                    }`}
                    style={{ height: `${barH}px`, transformOrigin: 'bottom' }}
                    title={`${t('trend.weekShort')} ${w.isoWeek}: ${w.deals} ${t('trend.axisDeals')}`}
                  />
                  <div className="font-mono text-[11px] text-[#8792a6]">
                    {`${t('trend.weekShort')} ${w.isoWeek}`}
                  </div>
                </div>
              );
            })}
            {reducedMotion ? null : (
              <style>{`
                .fds-bar-rise { animation: fds-bar-rise 600ms ease-out both; }
                @keyframes fds-bar-rise { from { transform: scaleY(0); } to { transform: scaleY(1); } }
              `}</style>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TrendTable({ weeks }: { weeks: DealsPerWeek[] }) {
  const { t } = useTranslation('reporting');
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-transparent hover:bg-transparent">
          <TableHead className="text-paper">{t('table.week')}</TableHead>
          <TableHead className="text-paper">{t('table.deals')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {weeks.map((w) => (
          <TableRow key={w.weekStart}>
            <TableCell className="text-foreground">{`${t('trend.weekShort')} ${w.isoWeek} / ${w.isoYear}`}</TableCell>
            <TableCell className="tabular-nums text-foreground">{w.deals}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
