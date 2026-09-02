import { Skeleton } from '@/components/ui/skeleton';
import { useTranslation } from 'react-i18next';
import type { ReportingKpis } from './useReporting';

/**
 * KPI tile row (ADMN-03, Data Visualization Contract) — ported 1:1 from the
 * Reporting.dc.html: a 4-up grid of white bordered tiles, an uppercase slate
 * label over a Space-Grotesk figure in tabular-nums (so digits align). Stat
 * tiles, NOT chart marks: a number is a number, no sparkline. NO commission
 * amounts (Phase 6). The design's 4th tile ("Ø Abschlussquote") has no backing
 * data in the 0048 views, so it is filled by the real "Aktive Mitarbeiter" KPI
 * (see deviations); the "Top-Performer" tile is derived from deals-per-rep.
 */
export function KpiTiles({
  kpis,
  topPerformer,
  isLoading,
}: {
  kpis?: ReportingKpis;
  topPerformer?: string;
  isLoading: boolean;
}) {
  const { t } = useTranslation('reporting');

  const tiles: { label: string; value: string }[] = [
    { label: t('kpi.activeContracts'), value: formatInt(kpis?.activeContracts) },
    { label: t('kpi.avgPerRep'), value: formatDecimal(kpis?.avgContractsPerRep) },
    { label: t('kpi.topPerformer'), value: topPerformer ?? t('kpi.topPerformerEmpty') },
    { label: t('kpi.activeReps'), value: formatInt(kpis?.activeReps) },
  ];

  return (
    <div className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="rounded-[12px] border border-ink/10 bg-white px-[20px] py-[18px]"
        >
          <div className="mb-[10px] text-[11px] font-medium uppercase tracking-[0.02em] text-[#5C6B85]">
            {tile.label}
          </div>
          {isLoading ? (
            <Skeleton className="h-[28px] w-16" />
          ) : (
            <div className="truncate font-display text-[26px] font-medium leading-[28px] tabular-nums text-ink">
              {tile.value}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function formatInt(value: number | undefined): string {
  return new Intl.NumberFormat('de-DE').format(value ?? 0);
}

function formatDecimal(value: number | undefined): string {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value ?? 0);
}
