import { EmptyState } from '@/components/EmptyState';
import { Button, buttonVariants } from '@/components/ui/button';
import { tokens } from '@/design/tokens';
import { cn } from '@/lib/utils';
import { BarChart3, Table2, UserPlus } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

/**
 * Shared reporting primitives (Data Visualization Contract floor + design SSOT).
 * The trend chart, the team-comparison chart and the per-rep table all reuse
 * these so color, initials, motion and the empty/CTA affordances stay identical:
 *   - usePrefersReducedMotion(): skip draw-in animation when the OS asks.
 *   - ChartToggle: the `<table>`-view toggle (screen-reader / CVD escape hatch).
 *   - categoricalColor(): the CVD-safe categorical hue for a rep, by their fixed
 *     (alphabetical) index so a color follows the entity, never the rank.
 *   - repInitials(): 1–2 letter avatar initials from a rep name.
 *   - RangeToggle: the header period segmented control (7 / 30 / 90 Tage).
 *   - InviteEmptyState: the no-reps empty state with the invite CTA.
 */

export type ReportingRange = '7' | '30' | '90';

export const REPORTING_RANGES: readonly ReportingRange[] = ['7', '30', '90'] as const;

/** How many trailing ISO-week bars the weekly-trend series shows per range. */
export const RANGE_WEEK_COUNT: Record<ReportingRange, number> = { '7': 1, '30': 4, '90': 13 };

export function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }
    const mq = window.matchMedia(query);
    setReduced(mq.matches);
    const handler = (event: MediaQueryListEvent) => setReduced(event.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return reduced;
}

/** Categorical hue for a rep by their fixed index (color follows entity, cyclic past 5). */
export function categoricalColor(index: number): string {
  const palette = tokens.chart.categorical;
  const safe = ((index % palette.length) + palette.length) % palette.length;
  return palette[safe] ?? palette[0];
}

/** 1–2 letter avatar initials from a rep name (uppercased). */
export function repInitials(name: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '–';
  }
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function ChartToggle({
  showTable,
  onToggle,
}: {
  showTable: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation('reporting');
  return (
    <Button type="button" variant="outline" size="sm" onClick={onToggle} aria-pressed={showTable}>
      <Table2 aria-hidden className="size-3.5" />
      {showTable ? t('table.toggleHide') : t('table.toggleShow')}
    </Button>
  );
}

/**
 * Header period segmented control — 1:1 with the design: a recessive Ink-tinted
 * pill track, the active range a raised white pill. Range scopes the weekly-trend
 * series client-side (the 0048 views are all-time / not range-parameterized).
 */
export function RangeToggle({
  range,
  onChange,
}: {
  range: ReportingRange;
  onChange: (range: ReportingRange) => void;
}) {
  const { t } = useTranslation('reporting');
  const label: Record<ReportingRange, string> = {
    '7': t('range.d7'),
    '30': t('range.d30'),
    '90': t('range.d90'),
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a segmented toggle-button group is correctly a role="group" container, not a <fieldset> (no form field / legend).
    <div
      role="group"
      aria-label={t('range.label')}
      className="flex shrink-0 items-center gap-[2px] rounded-[9px] bg-ink/[0.06] p-[3px]"
    >
      {REPORTING_RANGES.map((r) => {
        const active = r === range;
        return (
          <button
            key={r}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(r)}
            className={cn(
              'rounded-[7px] px-[14px] py-[7px] text-[13px] font-medium transition-colors',
              active
                ? 'bg-white text-ink shadow-[0_1px_3px_rgba(18,32,58,0.12)]'
                : 'bg-transparent text-[#5C6B85] hover:text-ink',
            )}
          >
            {label[r]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * No-reps empty state + invite CTA (Data Visualization Contract — empty state is
 * first-class). Shown by the team-comparison chart and the per-rep table when the
 * team has no reps yet; guides the team lead to the invite flow (/mitarbeiter).
 */
export function InviteEmptyState() {
  const { t } = useTranslation('reporting');
  return (
    <EmptyState
      icon={BarChart3}
      title={t('empty.noRepsHeading')}
      description={t('empty.noRepsBody')}
      action={
        <Link to="/mitarbeiter" className={buttonVariants({ variant: 'default', size: 'sm' })}>
          <UserPlus aria-hidden className="size-3.5" />
          {t('empty.invite')}
        </Link>
      }
    />
  );
}
