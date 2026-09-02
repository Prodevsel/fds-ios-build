/**
 * Pure German date/time formatting helpers — the SSOT for the daily-use screens
 * (Termine date pills, Aktuelles relative timestamps, Suche short dates). No
 * `Intl`/locale-data dependency (Hermes ships without full ICU — mirrors
 * ContractListScreen.formatSignedAt / StatusSheet.formatFollowUpDate) and no
 * `react-native` import, so this module stays test-safe under vitest/node.
 *
 * All functions are deterministic in their explicit `nowMs`/ISO inputs — never
 * read the device clock internally — so they are unit-testable without mocking
 * the global clock.
 */

/** German weekday abbreviations, indexed by `Date.getDay()` (0 = Sunday). */
const WEEKDAYS_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] as const;

/** German month names, indexed by `Date.getMonth()` (0 = January). */
const MONTHS_DE = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
] as const;

/** Full German month name for the local month containing `ms` (e.g. "Juli"). */
export function monthNameDe(ms: number): string {
  return MONTHS_DE[new Date(ms).getMonth()] ?? '';
}

/** True when `iso` falls in the same local calendar month+year as `nowMs`. */
export function isSameLocalMonth(nowMs: number, iso: string): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date(nowMs);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** Local-midnight epoch ms for the day containing `ms`. */
function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Whole-calendar-day difference (local time) between the day of `targetMs` and
 * the day of `nowMs`. 0 = same day, 1 = tomorrow, -1 = yesterday.
 */
export function localDayDelta(nowMs: number, targetMs: number): number {
  const dayMs = 86_400_000;
  return Math.round((startOfLocalDay(targetMs) - startOfLocalDay(nowMs)) / dayMs);
}

/** `HH:MM` (local, 24h) for an ISO instant. Returns '' for an unparseable input. */
export function formatTimeHHmm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `DD.MM.` (local) for an ISO instant. Returns '' for an unparseable input. */
export function formatDateShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
}

/**
 * The Termine date-pill label (design screen 12): "Heute" / "Morgen" for the
 * two nearest days, otherwise the German weekday + non-padded day.month, e.g.
 * "Di, 31.7.".
 */
export function formatDatePill(nowMs: number, iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const delta = localDayDelta(nowMs, d.getTime());
  if (delta === 0) return 'Heute';
  if (delta === 1) return 'Morgen';
  return `${WEEKDAYS_DE[d.getDay()]}, ${d.getDate()}.${d.getMonth() + 1}.`;
}

/**
 * Compact relative timestamp for the Aktuelles feed (design screen 16):
 * "{n} Min." within the hour, "{n} Std." earlier the same day, "gestern" the
 * previous day, otherwise the short "DD.MM." date. Future instants collapse to
 * "jetzt" (a feed only shows things that already happened). Deterministic in
 * `nowMs`.
 */
export function formatRelative(nowMs: number, iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const targetMs = d.getTime();
  const diffMs = nowMs - targetMs;
  if (diffMs < 60_000) return 'jetzt';
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return `${diffMin} Min.`;
  const delta = localDayDelta(nowMs, targetMs);
  if (delta === 0) return `${Math.floor(diffMin / 60)} Std.`;
  if (delta === -1) return 'gestern';
  return formatDateShort(iso);
}
