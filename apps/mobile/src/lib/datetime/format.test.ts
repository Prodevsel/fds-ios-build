import { describe, expect, it } from 'vitest';
import {
  formatDatePill,
  formatDateShort,
  formatRelative,
  formatTimeHHmm,
  localDayDelta,
} from './format';

// Local-time anchor: 2026-07-28 (Tuesday) at 12:00 local. Tests build target
// instants from the same local components so they are timezone-independent.
const at = (y: number, mo: number, d: number, h = 12, mi = 0): number =>
  new Date(y, mo - 1, d, h, mi).getTime();
const iso = (y: number, mo: number, d: number, h = 12, mi = 0): string =>
  new Date(y, mo - 1, d, h, mi).toISOString();

const NOW = at(2026, 7, 28, 12, 0);

describe('localDayDelta', () => {
  it('is 0 for the same calendar day regardless of time of day', () => {
    expect(localDayDelta(NOW, at(2026, 7, 28, 6, 0))).toBe(0);
    expect(localDayDelta(NOW, at(2026, 7, 28, 23, 59))).toBe(0);
  });
  it('is +1 tomorrow and -1 yesterday', () => {
    expect(localDayDelta(NOW, at(2026, 7, 29, 1, 0))).toBe(1);
    expect(localDayDelta(NOW, at(2026, 7, 27, 23, 0))).toBe(-1);
  });
});

describe('formatTimeHHmm / formatDateShort', () => {
  it('formats zero-padded local time and date', () => {
    expect(formatTimeHHmm(iso(2026, 7, 28, 18, 0))).toBe('18:00');
    expect(formatTimeHHmm(iso(2026, 7, 28, 9, 5))).toBe('09:05');
    expect(formatDateShort(iso(2026, 7, 3))).toBe('03.07.');
  });
  it('returns empty string for unparseable input', () => {
    expect(formatTimeHHmm('not-a-date')).toBe('');
    expect(formatDateShort('nope')).toBe('');
  });
});

describe('formatDatePill (Termine)', () => {
  it('labels today and tomorrow', () => {
    expect(formatDatePill(NOW, iso(2026, 7, 28, 18, 0))).toBe('Heute');
    expect(formatDatePill(NOW, iso(2026, 7, 29, 11, 30))).toBe('Morgen');
  });
  it('labels further days with the German weekday and non-padded day.month', () => {
    // 2026-07-31 is a Friday.
    expect(formatDatePill(NOW, iso(2026, 7, 31, 16, 0))).toBe('Fr, 31.7.');
  });
});

describe('formatRelative (Aktuelles)', () => {
  it('uses minutes within the hour', () => {
    expect(formatRelative(NOW, iso(2026, 7, 28, 11, 56))).toBe('4 Min.');
  });
  it('uses hours earlier the same day', () => {
    expect(formatRelative(NOW, iso(2026, 7, 28, 11, 0))).toBe('1 Std.');
  });
  it('uses "gestern" for the previous day and a short date beyond', () => {
    expect(formatRelative(NOW, iso(2026, 7, 27, 20, 0))).toBe('gestern');
    expect(formatRelative(NOW, iso(2026, 7, 20, 9, 0))).toBe('20.07.');
  });
  it('collapses future/near-now instants to "jetzt"', () => {
    expect(formatRelative(NOW, iso(2026, 7, 28, 12, 0))).toBe('jetzt');
  });
});
