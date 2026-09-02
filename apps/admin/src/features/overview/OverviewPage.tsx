import { EmptyState } from '@/components/EmptyState';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { tokens } from '@/design/tokens';
import { useSession } from '@/lib/auth/useSession';
import type { TFunction } from 'i18next';
import { ArrowDown, ArrowUp, Building2, CheckCircle2, Plus, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { ActivityKind } from './overviewModel';
import { buildActivity, buildFunnel, buildPaths, buildTeamBars, buildTrend } from './overviewModel';
import { type OverviewData, type RangeDays, useOverview } from './useOverview';

/**
 * Übersicht (operator dashboard) — ported 1:1 from `Uebersicht.dc.html`:
 * a greeting + 7/30/90-Tage range toggle, four KPI tiles (tabular-nums + delta),
 * the amber area+line signed-contracts trend, the onboarding funnel, the
 * "Verträge nach Unternehmen" team bars and the "Letzte Aktivität" feed.
 *
 * Live data (Supabase, via useOverview): active-companies count, onboarding
 * funnel, signed-contracts trend/KPI/delta, contracts-per-company bars, the
 * activity feed, the Provision-(MTD) KPI (reporting_commission_mtd, 0053) and the
 * Webhook-Zustellrate KPI (operator_webhook_delivery_rate, 0056). The webhook
 * rate keeps an honest "—" only when there are no webhook events yet.
 *
 * Every list/chart region carries a first-class empty state; with zero companies
 * the whole screen collapses to a centered empty-state card + amber CTA to
 * /unternehmen. All copy comes from the overview namespace; colours are tokens.
 */

const RANGES: readonly RangeDays[] = [7, 30, 90];
const SLATE = '#8792a6'; // design chart/axis grey — not a semantic token (allowed).
const GRID = 'rgba(18,32,58,.06)'; // recessive chart grid line (design value).

export function OverviewPage() {
  const { t } = useTranslation('overview');
  const { session } = useSession();
  const [range, setRange] = React.useState<RangeDays>(30);
  const { data, isLoading, isError } = useOverview(range);

  const greeting = buildGreeting(t, session?.user.email ?? '');

  return (
    <div className="mx-auto max-w-[1080px]">
      {/* HEADER: greeting + range toggle */}
      <div className="mb-[22px] flex items-end justify-between gap-lg">
        <div>
          <h1 className="mb-1 font-display text-[28px] font-medium leading-[34px] text-ink">
            {greeting}
          </h1>
          <p className="text-body text-[#5C6B85]">{t('subtitle')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-[2px] rounded-[9px] bg-ink/[.06] p-[3px]">
          {RANGES.map((r) => {
            const active = r === range;
            return (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`rounded-[7px] px-[14px] py-[7px] text-[13px] font-medium transition-colors ${
                  active
                    ? 'bg-white text-ink shadow-[0_1px_3px_rgba(18,32,58,.12)]'
                    : 'text-[#5C6B85] hover:text-ink'
                }`}
              >
                {t(`range.${r}`)}
              </button>
            );
          })}
        </div>
      </div>

      {isLoading ? (
        <OverviewSkeleton />
      ) : isError || !data ? (
        <StateCard heading={t('error.heading')} body={t('error.body')} />
      ) : data.companies.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={t('empty.heading')}
          description={t('empty.body')}
          action={
            <Link to="/unternehmen" className={buttonVariants()}>
              <Plus aria-hidden className="size-4" />
              {t('empty.cta')}
            </Link>
          }
        />
      ) : (
        <Dashboard data={data} range={range} t={t} />
      )}
    </div>
  );
}

function Dashboard({ data, range, t }: { data: OverviewData; range: RangeDays; t: TFunction }) {
  const now = Date.now();
  const trend = buildTrend(data.events, range, now);
  const funnel = buildFunnel(data.companies);
  const teamBars = buildTeamBars(data.companies, data.contractCompanyIds);
  const activity = buildActivity(data.events, data.companies);

  const activeCount = data.companies.filter((c) => c.onboarding_status === 'active').length;
  const signedDelta =
    data.previousSignedCount > 0
      ? ((trend.total - data.previousSignedCount) / data.previousSignedCount) * 100
      : null;

  const webhookRate = data.webhookDeliveryRate;
  const kpis: KpiTileProps[] = [
    { label: t('kpi.contracts'), value: trend.total.toLocaleString('de-DE'), delta: signedDelta },
    { label: t('kpi.companies'), value: activeCount.toLocaleString('de-DE'), delta: null },
    {
      // Provision (MTD): confirmed commission is the headline (Widerrufsfrist
      // passed); pending (still in the 14-day window) is the secondary note (0053).
      label: t('kpi.commission'),
      value: formatEur(data.commissionConfirmedEur),
      delta: null,
      note:
        data.commissionPendingEur > 0
          ? t('kpi.commissionPending', { amount: formatEur(data.commissionPendingEur) })
          : undefined,
    },
    {
      label: t('kpi.webhookRate'),
      value: webhookRate === null ? '—' : formatPercent(webhookRate),
      delta: null,
    },
  ];

  const paths = buildPaths(trend.points);

  return (
    <>
      {/* KPIs */}
      <div className="mb-[20px] grid grid-cols-2 gap-[16px] md:grid-cols-4">
        {kpis.map((k) => (
          <KpiTile key={k.label} {...k} />
        ))}
      </div>

      {/* TREND + ONBOARDING */}
      <div className="mb-[16px] grid grid-cols-1 gap-[16px] lg:grid-cols-[1.7fr_1fr]">
        <Card>
          <div className="mb-[6px] flex items-center justify-between">
            <div className="font-display text-[16px] font-medium text-ink">{t('trend.title')}</div>
            <div className="flex items-center gap-[6px] text-[12px] text-[#8792a6]">
              <span
                className="inline-block h-[2px] w-[10px] rounded-[2px]"
                style={{ background: tokens.chart.trend }}
              />
              {t(`range.${range}`)}
            </div>
          </div>
          <div className="mb-[14px] font-display text-[30px] font-medium tabular-nums text-ink">
            {trend.total.toLocaleString('de-DE')}
          </div>
          {trend.total === 0 ? (
            <InlineEmpty>{t('trend.empty')}</InlineEmpty>
          ) : (
            <>
              <svg
                viewBox="0 0 640 200"
                preserveAspectRatio="none"
                className="block h-[180px] w-full"
                role="img"
                aria-label={t('trend.title')}
              >
                <defs>
                  <linearGradient id="fdsArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={tokens.chart.trend} stopOpacity="0.22" />
                    <stop offset="100%" stopColor={tokens.chart.trend} stopOpacity="0" />
                  </linearGradient>
                </defs>
                <line x1="0" y1="50" x2="640" y2="50" stroke={GRID} strokeWidth="1" />
                <line x1="0" y1="100" x2="640" y2="100" stroke={GRID} strokeWidth="1" />
                <line x1="0" y1="150" x2="640" y2="150" stroke={GRID} strokeWidth="1" />
                <path d={paths.area} fill="url(#fdsArea)" />
                <path
                  d={paths.line}
                  fill="none"
                  stroke={tokens.chart.trend}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <div className="mt-[8px] flex justify-between">
                {trend.axis.map((x, i) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: axis labels are positional, no stable id
                    key={`${x}-${i}`}
                    className="font-mono text-[11px] text-[#8792a6]"
                  >
                    {x}
                  </span>
                ))}
              </div>
            </>
          )}
        </Card>

        <Card>
          <div className="mb-[18px] font-display text-[16px] font-medium text-ink">
            {t('onboarding.title')}
          </div>
          <div className="flex flex-col gap-[16px]">
            {funnel.map((f) => (
              <div key={f.key}>
                <div className="mb-[7px] flex items-center justify-between">
                  <span className="inline-flex items-center gap-[7px] text-[13px] font-medium text-ink">
                    <span className={`size-[9px] rounded-full ${FUNNEL_DOT[f.key]}`} />
                    {t(`funnel.${f.key}`)}
                  </span>
                  <span className="font-mono text-[13px] text-[#5C6B85]">{f.count}</span>
                </div>
                <div className="h-[8px] overflow-hidden rounded-full bg-ink/[.07]">
                  <div
                    className={`h-full rounded-full ${FUNNEL_DOT[f.key]}`}
                    style={{ width: f.pct }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-[20px] mb-[16px] h-px bg-ink/[.08]" />
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-[#5C6B85]">{t('onboarding.totalLabel')}</span>
            <span className="font-display text-[20px] font-medium text-ink tabular-nums">
              {data.companies.length}
            </span>
          </div>
        </Card>
      </div>

      {/* TEAM + ACTIVITY */}
      <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-[1.7fr_1fr]">
        <Card>
          <div className="mb-[20px] font-display text-[16px] font-medium text-ink">
            {t('team.title')}
          </div>
          {teamBars.length === 0 ? (
            <InlineEmpty>{t('team.empty')}</InlineEmpty>
          ) : (
            <div className="flex flex-col gap-[14px]">
              {teamBars.map((row, i) => {
                const color =
                  tokens.chart.categorical[i % tokens.chart.categorical.length] ?? SLATE;
                return (
                  <div key={row.id} className="flex items-center gap-[12px]">
                    <div className="flex w-[130px] shrink-0 items-center gap-[9px]">
                      <div
                        className="flex size-[22px] shrink-0 items-center justify-center rounded-[6px] font-display text-[10px] font-medium text-white"
                        style={{ background: color }}
                      >
                        {initials(row.name)}
                      </div>
                      <span className="truncate text-[13px] text-ink">
                        {row.name || t('unnamed')}
                      </span>
                    </div>
                    <div className="h-[22px] flex-1 overflow-hidden rounded-[6px] bg-ink/[.05]">
                      <div
                        className="h-full rounded-[6px]"
                        style={{ background: color, width: row.pct }}
                      />
                    </div>
                    <div className="w-[56px] shrink-0 text-right font-mono text-[13px] font-medium text-ink">
                      {row.value.toLocaleString('de-DE')}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <div className="mb-[18px] font-display text-[16px] font-medium text-ink">
            {t('activity.title')}
          </div>
          {activity.length === 0 ? (
            <InlineEmpty>{t('activity.empty')}</InlineEmpty>
          ) : (
            <div className="flex flex-col gap-[2px]">
              {activity.map((item) => {
                const { Icon, cls } = ACTIVITY_STYLE[item.kind];
                return (
                  <div key={item.id} className="flex gap-[12px] py-[9px]">
                    <span
                      className={`flex size-[28px] shrink-0 items-center justify-center rounded-[8px] ${cls}`}
                    >
                      <Icon aria-hidden className="size-[15px]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] leading-[18px] text-ink">
                        {t(`activity.${item.kind}`, { company: item.company || t('unnamed') })}
                      </div>
                      <div className="mt-[1px] text-[11px] text-[#8792a6]">
                        {formatRel(item.at, now, t)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

/* ---------- small presentational pieces ---------- */

/** White surveyor-card surface (12px radius, ink/10 hairline) — the design's card. */
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[12px] border border-ink/10 bg-card px-[24px] py-[22px]">
      {children}
    </div>
  );
}

interface KpiTileProps {
  label: string;
  value: string;
  delta: number | null;
  /** Optional secondary figure under the value (e.g. pending commission). */
  note?: string;
}

function KpiTile({ label, value, delta, note }: KpiTileProps) {
  return (
    <div className="rounded-[12px] border border-ink/10 bg-card px-[20px] py-[18px]">
      <div className="mb-[10px] text-[11px] font-medium uppercase tracking-[.02em] text-[#5C6B85]">
        {label}
      </div>
      <div className="flex items-end gap-[8px]">
        <div className="font-display text-[28px] font-medium leading-[28px] tabular-nums text-ink">
          {value}
        </div>
        <div className="mb-[2px]">
          <DeltaChip delta={delta} />
        </div>
      </div>
      {note ? <div className="mt-[6px] text-[11px] text-[#8792a6]">{note}</div> : null}
    </div>
  );
}

/** de-DE EUR, no decimals (matches the design's "2.480 €" style). */
function formatEur(value: number): string {
  return value.toLocaleString('de-DE', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  });
}

/** A 0..1 delivery fraction as a de-DE percentage (one decimal). */
function formatPercent(fraction: number): string {
  return `${(fraction * 100).toLocaleString('de-DE', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} %`;
}

function DeltaChip({ delta }: { delta: number | null }) {
  if (delta === null) {
    return <span className="text-[12px] font-medium text-[#8792a6]">—</span>;
  }
  const up = delta >= 0;
  const magnitude = Math.abs(delta).toLocaleString('de-DE', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return (
    <span
      className={`inline-flex items-center gap-[2px] text-[12px] font-medium ${up ? 'text-pine' : 'text-brick'}`}
    >
      {up ? (
        <ArrowUp aria-hidden className="size-[15px]" />
      ) : (
        <ArrowDown aria-hidden className="size-[15px]" />
      )}
      {`${up ? '+' : '-'}${magnitude} %`}
    </span>
  );
}

function InlineEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[120px] items-center justify-center px-md py-lg text-center text-[13px] text-[#8792a6]">
      {children}
    </div>
  );
}

function StateCard({ heading, body }: { heading: string; body: string }) {
  return (
    <div className="rounded-[12px] border border-ink/10 bg-card px-[24px] py-[48px] text-center">
      <p className="font-display text-heading text-ink">{heading}</p>
      <p className="mt-sm text-body text-[#5C6B85]">{body}</p>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid grid-cols-2 gap-[16px] md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[88px] w-full rounded-[12px]" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-[1.7fr_1fr]">
        <Skeleton className="h-[280px] w-full rounded-[12px]" />
        <Skeleton className="h-[280px] w-full rounded-[12px]" />
      </div>
      <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-[1.7fr_1fr]">
        <Skeleton className="h-[220px] w-full rounded-[12px]" />
        <Skeleton className="h-[220px] w-full rounded-[12px]" />
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */

const FUNNEL_DOT: Record<'active' | 'onboarding' | 'draft', string> = {
  active: 'bg-pine',
  onboarding: 'bg-porch',
  draft: 'bg-[#8792a6]',
};

const ACTIVITY_STYLE: Record<ActivityKind, { Icon: LucideIcon; cls: string }> = {
  signed: { Icon: CheckCircle2, cls: 'bg-pine/10 text-pine' },
  cancelled: { Icon: XCircle, cls: 'bg-brick/10 text-brick' },
  companyCreated: { Icon: Plus, cls: 'bg-porch/10 text-porch' },
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '—';
  }
  return parts
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');
}

function buildGreeting(t: TFunction, email: string): string {
  const hour = new Date().getHours();
  const key = hour < 11 ? 'morning' : hour < 18 ? 'day' : 'evening';
  const base = t(`greeting.${key}`);
  const local = email ? (email.split('@')[0] ?? '') : '';
  const rawFirst = local ? (local.split(/[._-]/)[0] ?? '') : '';
  const first = rawFirst ? rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1) : '';
  return first ? `${base}, ${first}` : base;
}

function formatRel(iso: string, now: number, t: TFunction): string {
  const diff = now - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) {
    return t('time.now');
  }
  if (min < 60) {
    return t('time.min', { count: min });
  }
  const hrs = Math.floor(min / 60);
  if (hrs < 24) {
    return t('time.hour', { count: hrs });
  }
  const days = Math.floor(hrs / 24);
  if (days === 1) {
    return t('time.yesterday');
  }
  return t('time.day', { count: days });
}
