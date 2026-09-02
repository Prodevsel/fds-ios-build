import { describe, expect, it, vi } from 'vitest';

import { buildContactUpdatePayload, buildProfileUpdateSql, createProfileRepo, toContractStat } from './profileRepo';

describe('toContractStat (pure TEXT-record mapper)', () => {
  it('parses door price and the tester flag', () => {
    const stat = toContractStat({ signed_at: '2026-08-01T10:00:00Z', door_price: '39.99', is_test: '1' });
    expect(stat.doorPriceEur).toBeCloseTo(39.99);
    expect(stat.isTest).toBe(true);
  });
});

describe('buildProfileUpdateSql (pure SET-clause builder, LOCAL/PowerSync half only — D-01/D-02)', () => {
  it('returns null for an empty patch (nothing to write)', () => {
    expect(buildProfileUpdateSql('rep-1', {})).toBeNull();
  });

  it('returns null when only contact fields are touched (those never reach the local table)', () => {
    expect(
      buildProfileUpdateSql('rep-1', { contactPhone: '+49 170 1234567', contactEmail: 'erika@example.com' }),
    ).toBeNull();
  });

  it('sets only full_name when just the display name is touched', () => {
    const built = buildProfileUpdateSql('rep-1', { fullName: 'Erika Musterfrau' });
    expect(built?.sql).toContain('full_name = ?');
    expect(built?.sql).not.toContain('avatar_url = ?');
    expect(built?.sql).not.toContain('contact_phone = ?');
    expect(built?.sql).not.toContain('contact_email = ?');
    expect(built?.sql).toContain('UPDATE app_users');
    expect(built?.sql).toContain('WHERE id = ?');
    expect(built?.sql.toLowerCase()).not.toContain('on conflict');
    expect(built?.params).toEqual(['Erika Musterfrau', 'rep-1']);
  });

  it('never emits contact_phone/contact_email — those columns do not exist on the local view (T-12-13-03)', () => {
    const built = buildProfileUpdateSql('rep-1', {
      fullName: 'Erika Musterfrau',
      contactPhone: '+49 170 1234567',
      contactEmail: 'erika@example.com',
    });
    expect(built?.sql).not.toContain('contact_phone');
    expect(built?.sql).not.toContain('contact_email');
    expect(built?.params).toEqual(['Erika Musterfrau', 'rep-1']);
  });
});

describe('buildContactUpdatePayload (pure object builder, DIRECT-Supabase half only — T-12-13-03)', () => {
  it('returns null for an empty patch', () => {
    expect(buildContactUpdatePayload({})).toBeNull();
  });

  it('returns null when only fullName/avatarUrl are touched (those never go direct)', () => {
    expect(buildContactUpdatePayload({ fullName: 'x', avatarUrl: 'y' })).toBeNull();
  });

  it('builds only contact_phone/contact_email, never full_name/avatar_url', () => {
    const payload = buildContactUpdatePayload({
      fullName: 'ignored here',
      contactPhone: '+49 170 1234567',
      contactEmail: 'erika@example.com',
    });
    expect(payload).toEqual({ contact_phone: '+49 170 1234567', contact_email: 'erika@example.com' });
  });
});

describe('createProfileRepo.update (split write path, D-01/D-02)', () => {
  it('routes fullName through a real local UPDATE ... WHERE id = ? — never an upsert', async () => {
    const execute = vi.fn(async () => ({}));
    const repo = createProfileRepo({ db: { execute } as never });

    await repo.update('rep-1', { fullName: 'Erika Musterfrau' });

    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('UPDATE app_users');
    expect(sql).toContain('WHERE id = ?');
    expect(sql.toLowerCase()).not.toContain('on conflict');
    expect(params[params.length - 1]).toBe('rep-1');
  });

  it('is a no-op (no execute, no supabase call) for an empty patch', async () => {
    const execute = vi.fn(async () => ({}));
    const repo = createProfileRepo({ db: { execute } as never });

    await repo.update('rep-1', {});

    expect(execute).not.toHaveBeenCalled();
  });

  it('routes contactPhone/contactEmail through a direct Supabase update, never the local db', async () => {
    const execute = vi.fn(async () => ({}));
    const eq = vi.fn(async () => ({ error: null }));
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    const repo = createProfileRepo({ db: { execute } as never, supabase: { from } as never });

    await repo.update('rep-1', { contactPhone: '+49 170 1234567', contactEmail: 'erika@example.com' });

    expect(execute).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledWith('app_users');
    expect(update).toHaveBeenCalledExactlyOnceWith({
      contact_phone: '+49 170 1234567',
      contact_email: 'erika@example.com',
    });
    expect(eq).toHaveBeenCalledExactlyOnceWith('id', 'rep-1');
  });

  it('a single call touching full_name, contact_phone and contact_email drives BOTH transports', async () => {
    const execute = vi.fn(async () => ({}));
    const eq = vi.fn(async () => ({ error: null }));
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    const repo = createProfileRepo({ db: { execute } as never, supabase: { from } as never });

    await repo.update('rep-1', {
      fullName: 'Erika Musterfrau',
      contactPhone: '+49 170 1234567',
      contactEmail: 'erika@example.com',
    });

    expect(execute).toHaveBeenCalledTimes(1);
    const [localSql] = execute.mock.calls[0] as unknown as [string];
    expect(localSql).toContain('full_name = ?');
    expect(localSql).not.toContain('contact_phone');
    expect(update).toHaveBeenCalledExactlyOnceWith({
      contact_phone: '+49 170 1234567',
      contact_email: 'erika@example.com',
    });
  });

  it('throws when contact fields are touched but no supabase client was injected', async () => {
    const execute = vi.fn(async () => ({}));
    const repo = createProfileRepo({ db: { execute } as never });

    await expect(repo.update('rep-1', { contactEmail: 'erika@example.com' })).rejects.toThrow(
      /require a supabase client/i,
    );
  });

  it('rethrows a Supabase update error', async () => {
    const execute = vi.fn(async () => ({}));
    const eq = vi.fn(async () => ({ error: { message: 'permission denied' } }));
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    const repo = createProfileRepo({ db: { execute } as never, supabase: { from } as never });

    await expect(repo.update('rep-1', { contactEmail: 'bad' })).rejects.toThrow(/contact update failed/i);
  });
});
