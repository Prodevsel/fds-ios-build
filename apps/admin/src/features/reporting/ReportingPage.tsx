import { Card, CardContent } from '@/components/ui/card';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { DealsTrendChart } from './DealsTrendChart';
import { KpiTiles } from './KpiTiles';
import { PerRepTable } from './PerRepTable';
import { TeamComparisonChart } from './TeamComparisonChart';
import { RangeToggle, type ReportingRange } from './chartPrimitives';
import { useDealsPerRep, useDealsPerWeek, useReportingKpis } from './useReporting';

/**
 * Reporting dashboard (ADMN-03) — ported 1:1 from the Reporting.dc.html: a title
 * row with the period segmented control, a 4-up KPI band, a two-panel row
 * (team-comparison horizontal bars · weekly-trend column chart), and the Ink-Navy
 * sortable per-rep table. Data is read from the RLS-scoped 0048 aggregate views
 * over the contract_status_events SSOT, with per-rep Provision + Ø Deal joined
 * from the 0053 reporting_commission_per_rep view. Every
 * panel carries loading, empty (+ invite CTA for a repless team), and error
 * states. All copy comes from the reporting i18n namespace; chart color from the
 * design-token SSOT.
 */
export function ReportingPage() {
  const { t } = useTranslation('reporting');
  const [range, setRange] = React.useState<ReportingRange>('30');
  const kpis = useReportingKpis();
  const week = useDealsPerWeek();
  const rep = useDealsPerRep();

  const isError = kpis.isError || week.isError || rep.isError;
  const rangeLabel: Record<ReportingRange, string> = {
    '7': t('range.d7'),
    '30': t('range.d30'),
    '90': t('range.d90'),
  };

  // Top-Performer KPI is derived from the per-rep view (most signed deals).
  const topPerformer = rep.data
    ? rep.data
        .slice()
        .sort((a, b) => b.deals - a.deals)[0]
        ?.repName?.split(' ')[0]
    : undefined;

  return (
    <div className="mx-auto flex max-w-[1080px] flex-col gap-lg">
      <header className="flex flex-wrap items-end justify-between gap-md">
        <div className="flex flex-col gap-xs">
          <h1 className="font-display text-display text-foreground">{t('title')}</h1>
          <p className="text-body text-muted-foreground">{t('subtitle')}</p>
        </div>
        <RangeToggle range={range} onChange={setRange} />
      </header>

      {isError ? (
        <Card>
          <CardContent className="flex flex-col gap-sm p-xl text-center">
            <p className="font-display text-heading text-foreground">{t('error.heading')}</p>
            <p className="text-body text-muted-foreground">{t('error.body')}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPI band — first read, above the charts (Focal points). */}
          <KpiTiles
            kpis={kpis.data}
            topPerformer={topPerformer ?? undefined}
            isLoading={kpis.isLoading || rep.isLoading}
          />

          <div className="grid grid-cols-1 gap-md lg:grid-cols-2">
            <TeamComparisonChart data={rep.data} isLoading={rep.isLoading} />
            <DealsTrendChart
              data={week.data}
              isLoading={week.isLoading}
              range={range}
              rangeLabel={rangeLabel[range]}
            />
          </div>

          <PerRepTable data={rep.data} isLoading={rep.isLoading} />
        </>
      )}
    </div>
  );
}
