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
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { ChartToggle, InviteEmptyState, categoricalColor } from './chartPrimitives';
import type { DealsPerRep } from './useReporting';

/**
 * Team-comparison chart (ADMN-03) — ported 1:1 from the Reporting.dc.html: a
 * horizontal bar per rep (color dot + name, a recessive Ink-tinted track with a
 * colored fill, the count right-aligned in JetBrains Mono). Each rep keeps one
 * fixed categorical hue by their alphabetical index (color follows the entity,
 * never the rank) from the CVD-validated palette (reds/greens excluded so a bar
 * never reads as a status "problem"); bars are ordered by deals desc. A no-reps
 * team shows the invite CTA; a `<table>`-view toggle exposes the same series.
 */
export function TeamComparisonChart({
  data,
  isLoading,
}: {
  data?: DealsPerRep[];
  isLoading: boolean;
}) {
  const { t } = useTranslation('reporting');
  const [showTable, setShowTable] = React.useState(false);

  // `data` arrives alphabetically (useReporting) — that fixed index picks the
  // hue; a copy sorted by deals desc drives the visual order.
  const reps = data ?? [];
  const colorByRep = new Map(reps.map((rep, i) => [rep.repId, categoricalColor(i)]));
  const ordered = reps.slice().sort((a, b) => b.deals - a.deals);
  const maxDeals = Math.max(1, ...reps.map((r) => r.deals));

  return (
    <Card className="rounded-[12px] border-ink/10 px-[24px] py-[22px]">
      <CardHeader className="flex-row items-center justify-between gap-md p-0 pb-[18px]">
        <CardTitle className="font-display text-[16px] font-medium">{t('team.title')}</CardTitle>
        {reps.length > 0 ? (
          <ChartToggle showTable={showTable} onToggle={() => setShowTable((s) => !s)} />
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <Skeleton className="h-[220px] w-full" />
        ) : reps.length === 0 ? (
          <InviteEmptyState />
        ) : showTable ? (
          <RepTable reps={ordered} colorByRep={colorByRep} />
        ) : (
          <ul className="flex flex-col gap-[14px]" aria-label={t('team.title')}>
            {ordered.map((rep) => {
              const color = colorByRep.get(rep.repId) ?? categoricalColor(0);
              const name = rep.repName ?? t('table.unnamed');
              const pct = Math.round((rep.deals / maxDeals) * 100);
              return (
                <li key={rep.repId} className="flex items-center gap-[12px]">
                  <div className="flex w-[120px] min-w-0 shrink-0 items-center gap-[9px]">
                    <span
                      aria-hidden
                      className="size-[9px] shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="truncate text-[13px] text-ink">{name}</span>
                  </div>
                  <div className="h-[20px] flex-1 overflow-hidden rounded-[6px] bg-ink/5">
                    <div
                      className="h-full rounded-[6px]"
                      style={{ width: `${pct}%`, backgroundColor: color }}
                      role="img"
                      aria-label={`${name}: ${rep.deals} ${t('team.axisDeals')}`}
                    />
                  </div>
                  <div className="w-[36px] shrink-0 text-right font-mono text-[13px] font-medium tabular-nums text-ink">
                    {rep.deals}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RepTable({
  reps,
  colorByRep,
}: {
  reps: DealsPerRep[];
  colorByRep: Map<string, string>;
}) {
  const { t } = useTranslation('reporting');
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-transparent hover:bg-transparent">
          <TableHead className="text-paper">{t('table.rep')}</TableHead>
          <TableHead className="text-paper">{t('table.deals')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {reps.map((rep) => (
          <TableRow key={rep.repId}>
            <TableCell className="text-foreground">
              <span className="flex items-center gap-sm">
                <span
                  aria-hidden
                  className="size-[9px] shrink-0 rounded-full"
                  style={{ backgroundColor: colorByRep.get(rep.repId) ?? categoricalColor(0) }}
                />
                {rep.repName ?? t('table.unnamed')}
              </span>
            </TableCell>
            <TableCell className="tabular-nums text-foreground">{rep.deals}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
