import { describe, expect, it } from 'vitest';
import { buildActivityFeed, countNew, type ActivityFeedSources } from './activityFeed';
import type { Appointment } from '../termine/db/appointmentsRepo';

const iso = (y: number, mo: number, d: number, h = 12, mi = 0): string =>
  new Date(y, mo - 1, d, h, mi).toISOString();
const NOW = new Date(2026, 6, 28, 12, 0).getTime(); // 2026-07-28 12:00 local

const empty: ActivityFeedSources = { contracts: [], stornos: [], territories: [], appointments: [] };

const todayAppt: Appointment = {
  id: 'ap1', houseId: null, scheduledAtIso: iso(2026, 7, 28, 18, 0), address: 'Musterstraße 10',
  floorLabel: 'EG rechts', note: null, kind: 'follow_up', customerAge: null,
  createdAtIso: iso(2026, 7, 28, 7, 30),
};

describe('buildActivityFeed', () => {
  it('merges the four real sources into one reverse-chronological feed', () => {
    const feed = buildActivityFeed(
      {
        contracts: [{ id: 'c1', dealReference: 'FDS-1', customerName: 'Thomas Berger', productName: null, signedAtIso: iso(2026, 7, 28, 11, 56), doorPriceEur: 36.5, cancelledAtIso: null }],
        stornos: [{ contractId: 'c9', occurredAtIso: iso(2026, 7, 28, 11, 0), dealReference: 'FDS-9', customerName: 'Maria Vogt' }],
        territories: [{ id: 'terr1', name: 'Nord-Ost', createdAtIso: iso(2026, 7, 27, 9, 0) }],
        appointments: [todayAppt],
      },
      NOW,
    );
    expect(feed.map((f) => f.kind)).toEqual(['contract', 'storno', 'followup', 'territory']);
    // The yesterday territory assignment is not "new".
    expect(feed.find((f) => f.kind === 'territory')?.isNew).toBe(false);
    expect(feed.find((f) => f.kind === 'contract')?.isNew).toBe(true);
  });

  it('only includes today\'s appointments as follow-up items', () => {
    const tomorrow: Appointment = { ...todayAppt, id: 'ap2', scheduledAtIso: iso(2026, 7, 29, 9, 0) };
    const feed = buildActivityFeed({ ...empty, appointments: [todayAppt, tomorrow] }, NOW);
    expect(feed.filter((f) => f.kind === 'followup')).toHaveLength(1);
    expect(feed[0]?.appointmentTimeIso).toBe(todayAppt.scheduledAtIso);
  });

  it('is empty for no sources', () => {
    expect(buildActivityFeed(empty, NOW)).toEqual([]);
  });
});

describe('countNew', () => {
  it('counts new items not yet marked read', () => {
    const feed = buildActivityFeed(
      {
        ...empty,
        contracts: [{ id: 'c1', dealReference: 'FDS-1', customerName: 'A', productName: null, signedAtIso: iso(2026, 7, 28, 11, 0), doorPriceEur: 36.5, cancelledAtIso: null }],
        territories: [{ id: 'terr1', name: 'Nord-Ost', createdAtIso: iso(2026, 7, 20, 9, 0) }], // old -> not new
      },
      NOW,
    );
    expect(countNew(feed, new Set())).toBe(1);
    expect(countNew(feed, new Set(['contract:c1']))).toBe(0);
  });
});
