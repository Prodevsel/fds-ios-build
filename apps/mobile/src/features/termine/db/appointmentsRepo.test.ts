import { beforeEach, describe, expect, it, vi } from 'vitest';

// Node test environment (vitest.config.ts): never load the native expo-crypto
// module — only its randomUUID export is used, stubbed deterministically here
// (mirrors housesRepo.test.ts's pattern).
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'fixed-appointment-id') }));

import {
  appointmentInsertParams,
  buildFollowUpAppointment,
  createAppointmentsRepo,
} from './appointmentsRepo';

describe('buildFollowUpAppointment (pure Folgetermin builder — "Follow-up setzt einen Folgetermin")', () => {
  it('fixes kind to follow_up and carries rep/team/house + the picked time', () => {
    const row = buildFollowUpAppointment({
      id: 'appt-1',
      repId: 'rep-1',
      teamId: 'team-1',
      houseId: 'house-1',
      scheduledAt: new Date('2026-07-21T17:30:00.000Z'),
      nowIso: '2026-07-20T09:00:00.000Z',
    });

    expect(row).toEqual({
      id: 'appt-1',
      rep_id: 'rep-1',
      team_id: 'team-1',
      house_id: 'house-1',
      scheduled_at: '2026-07-21T17:30:00.000Z',
      address: null,
      floor_label: null,
      note: null,
      kind: 'follow_up',
      customer_age: null,
      created_at: '2026-07-20T09:00:00.000Z',
      updated_at: '2026-07-20T09:00:00.000Z',
    });
  });

  it('defaults optional address/floor/note/age to null (houses carries none — never faked)', () => {
    const row = buildFollowUpAppointment({
      id: 'appt-2',
      repId: 'rep-1',
      teamId: 'team-1',
      houseId: null,
      scheduledAt: new Date('2026-07-21T08:00:00.000Z'),
      nowIso: '2026-07-20T09:00:00.000Z',
    });

    expect(row.house_id).toBeNull();
    expect(row.address).toBeNull();
    expect(row.floor_label).toBeNull();
    expect(row.note).toBeNull();
    expect(row.customer_age).toBeNull();
  });

  it('appointmentInsertParams emits the SQL column order exactly', () => {
    const row = buildFollowUpAppointment({
      id: 'appt-3',
      repId: 'rep-1',
      teamId: 'team-1',
      houseId: 'house-1',
      scheduledAt: new Date('2026-07-21T17:30:00.000Z'),
      nowIso: '2026-07-20T09:00:00.000Z',
    });

    expect(appointmentInsertParams(row)).toEqual([
      'appt-3',
      'rep-1',
      'team-1',
      'house-1',
      '2026-07-21T17:30:00.000Z',
      null,
      null,
      null,
      'follow_up',
      null,
      '2026-07-20T09:00:00.000Z',
      '2026-07-20T09:00:00.000Z',
    ]);
  });
});

describe('createAppointmentsRepo().createFollowUpAppointment (local-only INSERT, never a direct Supabase call)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes one local INSERT into appointments and returns the generated id', async () => {
    const execute = vi.fn(async () => ({}));
    const repo = createAppointmentsRepo({ db: { execute } as never });

    const id = await repo.createFollowUpAppointment({
      repId: 'rep-1',
      teamId: 'team-1',
      houseId: 'house-1',
      scheduledAt: new Date('2026-07-21T17:30:00.000Z'),
    });

    expect(id).toBe('fixed-appointment-id');
    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('INSERT INTO appointments');
    expect(params[0]).toBe('fixed-appointment-id');
    expect(params[1]).toBe('rep-1');
    expect(params[2]).toBe('team-1');
    expect(params[3]).toBe('house-1');
    expect(params[4]).toBe('2026-07-21T17:30:00.000Z');
    expect(params[8]).toBe('follow_up');
  });
});
