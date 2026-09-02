import type { OnboardingStatus } from '@/features/companies/useCompanies';
import type { OverviewCompany, RangeDays, StatusEvent } from './useOverview';

/**
 * Pure view-model transforms for the Übersicht dashboard — kept framework-free
 * so the bucketing/aggregation logic is unit-testable without React/Supabase.
 * All colour/icon/i18n presentation stays in the page; this module only shapes
 * numbers (trend buckets, funnel counts, team-bar ranking, activity ordering).
 */

const DAY_MS = 86_400_000;
const deWeekday = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
const deMonth = new Intl.DateTimeFormat('de-DE', { month: 'short' });

/** SVG line + area path from a point series — ported 1:1 from the .dc.html. */
export function buildPaths(pts: readonly number[]): { line: string; area: string } {
  const W = 640;
  const H = 200;
  const pad = 12;
  if (pts.length === 0) {
    return { line: '', area: '' };
  }
  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const span = max - min || 1;
  const step = pts.length > 1 ? W / (pts.length - 1) : 0;
  const coords = pts.map((v, i) => ({
    x: Math.round(i * step),
    y: Math.round(pad + (H - pad * 2) * (1 - (v - min) / span)),
  }));
  const line = coords.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
  const lastX = Math.round((pts.length - 1) * step);
  const area = `M0 ${H} ${coords.map((p) => `L${p.x} ${p.y}`).join(' ')} L${lastX} ${H} Z`;
  return { line, area };
}

export interface Trend {
  points: number[];
  axis: string[];
  total: number;
}

/** Bucket signed events across the range into a point series + axis labels. */
export function buildTrend(events: readonly StatusEvent[], days: RangeDays, now: number): Trend {
  const start = now - days * DAY_MS;
  const signedAt = events
    .filter((e) => e.event_type === 'signed')
    .map((e) => new Date(e.occurred_at).getTime());

  const bucketMs = days === 90 ? 7 * DAY_MS : DAY_MS;
  const count = days === 7 ? 7 : days === 30 ? 30 : 13;
  const points = new Array<number>(count).fill(0);
  for (const t of signedAt) {
    const idx = Math.floor((t - start) / bucketMs);
    if (idx >= 0 && idx < count) {
      points[idx] = (points[idx] ?? 0) + 1;
    }
  }

  const at = (i: number) => new Date(start + i * bucketMs);
  let axis: string[];
  if (days === 7) {
    axis = points.map((_, i) => deWeekday.format(at(i)).replace('.', ''));
  } else if (days === 30) {
    axis = [0, 7, 14, 21, 29].map((i) => `${at(i).getDate()}.`);
  } else {
    axis = [0, 6, 12].map((i) => deMonth.format(at(i)));
  }

  return { points, axis, total: signedAt.length };
}

export interface FunnelSlice {
  key: OnboardingStatus;
  count: number;
  pct: string;
}

const FUNNEL_ORDER: readonly OnboardingStatus[] = ['active', 'onboarding', 'draft'];

/** Onboarding funnel counts (active/onboarding/draft) as a share of all companies. */
export function buildFunnel(companies: readonly OverviewCompany[]): FunnelSlice[] {
  const total = companies.length || 1;
  return FUNNEL_ORDER.map((key) => {
    const count = companies.filter((c) => c.onboarding_status === key).length;
    return { key, count, pct: `${Math.round((count / total) * 100)}%` };
  });
}

export interface TeamBar {
  id: string;
  name: string;
  value: number;
  pct: string;
}

/** Contracts-per-company, ranked desc, top `limit` — bar width relative to the leader. */
export function buildTeamBars(
  companies: readonly OverviewCompany[],
  contractCompanyIds: readonly string[],
  limit = 5,
): TeamBar[] {
  const counts = new Map<string, number>();
  for (const id of contractCompanyIds) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const ranked = companies
    .map((c) => ({ id: c.id, name: c.name, value: counts.get(c.id) ?? 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
  const maxV = ranked[0]?.value ?? 1;
  return ranked.map((r) => ({ ...r, pct: `${Math.round((r.value / maxV) * 100)}%` }));
}

export type ActivityKind = 'signed' | 'cancelled' | 'companyCreated';

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  company: string;
  at: string;
}

/** Merge recent status events + newly-created companies into one time-ordered feed. */
export function buildActivity(
  events: readonly StatusEvent[],
  companies: readonly OverviewCompany[],
  limit = 5,
): ActivityItem[] {
  const nameById = new Map(companies.map((c) => [c.id, c.name] as const));
  const items: ActivityItem[] = [
    ...events.map((e) => ({
      id: `e-${e.id}`,
      kind: e.event_type,
      company: nameById.get(e.company_id) ?? '',
      at: e.occurred_at,
    })),
    ...companies.map((c) => ({
      id: `c-${c.id}`,
      kind: 'companyCreated' as const,
      company: c.name,
      at: c.created_at,
    })),
  ];
  return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, limit);
}
