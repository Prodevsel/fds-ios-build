import { describe, expect, it } from 'vitest';
import { buildTermineView } from './termineView';
import type { Appointment } from './db/appointmentsRepo';

const iso = (y: number, mo: number, d: number, h = 12, mi = 0): string =>
  new Date(y, mo - 1, d, h, mi).toISOString();

const NOW = new Date(2026, 6, 28, 8, 12).getTime(); // 2026-07-28 08:12 local (Tue)

const base: Appointment = {
  id: 'a1',
  houseId: null,
  scheduledAtIso: iso(2026, 7, 28, 18, 0),
  address: 'Musterstraße 10',
  floorLabel: 'EG rechts',
  note: 'Abends da.',
  kind: 'follow_up',
  customerAge: null,
  createdAtIso: iso(2026, 7, 20, 9, 0),
};

describe('buildTermineView', () => {
  it('projects each appointment to a card with pill + time + address', () => {
    const view = buildTermineView([base], NOW);
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0]).toMatchObject({
      pill: 'Heute',
      time: '18:00',
      address: 'Musterstraße 10',
      floorLabel: 'EG rechts',
      isToday: true,
      callbackLabel: null,
    });
  });

  it('counts total and today', () => {
    const tomorrow: Appointment = { ...base, id: 'a2', scheduledAtIso: iso(2026, 7, 29, 11, 30) };
    const view = buildTermineView([base, tomorrow], NOW);
    expect(view.total).toBe(2);
    expect(view.todayCount).toBe(1);
    expect(view.rows[1]?.pill).toBe('Morgen');
    expect(view.rows[1]?.isToday).toBe(false);
  });

  it('renders the callback-verification chip with the age suffix', () => {
    const callback: Appointment = {
      ...base,
      id: 'a3',
      scheduledAtIso: iso(2026, 7, 31, 16, 0),
      kind: 'callback_verification',
      customerAge: 74,
    };
    const view = buildTermineView([callback], NOW);
    expect(view.rows[0]?.callbackLabel).toBe('Rückruf-Verifizierung (74 J.)');
    expect(view.rows[0]?.pill).toBe('Fr, 31.7.');
  });

  it('omits the age suffix when the age is unknown', () => {
    const callback: Appointment = { ...base, id: 'a4', kind: 'callback_verification', customerAge: null };
    expect(buildTermineView([callback], NOW).rows[0]?.callbackLabel).toBe('Rückruf-Verifizierung');
  });

  it('returns an empty model for no appointments', () => {
    const view = buildTermineView([], NOW);
    expect(view.rows).toHaveLength(0);
    expect(view.total).toBe(0);
    expect(view.todayCount).toBe(0);
  });
});
