import { beforeEach, describe, expect, it, vi } from 'vitest';

// Node test environment (vitest.config.ts): never load the native
// expo-crypto module — only its randomUUID export is used, and it's stubbed
// deterministically here (mirrors useSkeletonFlow.test.ts's pattern).
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'fixed-uuid') }));

import { createHousesRepo } from './housesRepo';

interface FakeDb {
  execute: ReturnType<typeof vi.fn>;
  watch: ReturnType<typeof vi.fn>;
  getAll: ReturnType<typeof vi.fn>;
}

function fakeDb(): FakeDb {
  return {
    execute: vi.fn(async () => ({})),
    watch: vi.fn(),
    getAll: vi.fn(async () => []),
  };
}

describe('housesRepo write methods (local-first, never a direct Supabase call)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('insertHouseAtPoint writes a local INSERT and never touches territory_id', async () => {
    const db = fakeDb();
    const repo = createHousesRepo({ db: db as never });

    const id = await repo.insertHouseAtPoint({
      lngLat: [13.4, 52.5],
      status: 'new',
      teamId: 'team-1',
      createdBy: 'user-1',
    });

    expect(id).toBe('fixed-uuid');
    expect(db.execute).toHaveBeenCalledTimes(1);
    const [sql, params] = db.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO houses');
    expect(sql).not.toContain('territory_id');
    // Trailing null: `address` is written on insert now, and a map tap has
    // none — the sheet resolves one afterwards, as it always did.
    expect(params).toEqual([
      'fixed-uuid', 'team-1', 52.5, 13.4, 'new', null, 'user-1', expect.any(String), null,
    ]);
  });

  it('insertHouseAtPoint stores an address the caller already knows (address search)', async () => {
    const db = fakeDb();
    const repo = createHousesRepo({ db: db as never });

    await repo.insertHouseAtPoint({
      lngLat: [13.4, 52.5],
      status: 'new',
      teamId: 'team-1',
      createdBy: 'user-1',
      address: 'Poststraße 12, 71229 Leonberg',
    });

    const [sql, params] = db.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('address');
    expect(params[8]).toBe('Poststraße 12, 71229 Leonberg');
  });

  it('setStatus updates only status/follow_up_at for the given house id', async () => {
    const db = fakeDb();
    const repo = createHousesRepo({ db: db as never });

    await repo.setStatus('house-1', 'follow_up', '2026-07-21T17:30:00.000Z');

    expect(db.execute).toHaveBeenCalledWith('UPDATE houses SET status = ?, follow_up_at = ? WHERE id = ?', [
      'follow_up',
      '2026-07-21T17:30:00.000Z',
      'house-1',
    ]);
  });

  it('setStatus defaults follow_up_at to null when not provided (clearing a prior follow-up)', async () => {
    const db = fakeDb();
    const repo = createHousesRepo({ db: db as never });

    await repo.setStatus('house-1', 'success');

    expect(db.execute).toHaveBeenCalledWith('UPDATE houses SET status = ?, follow_up_at = ? WHERE id = ?', [
      'success',
      null,
      'house-1',
    ]);
  });

  it('setNote writes only the note column for the given house id', async () => {
    const db = fakeDb();
    const repo = createHousesRepo({ db: db as never });

    await repo.setNote('house-1', 'Nachbar abends nochmal fragen');

    expect(db.execute).toHaveBeenCalledWith('UPDATE houses SET note = ? WHERE id = ?', [
      'Nachbar abends nochmal fragen',
      'house-1',
    ]);
  });

  it('setNote passes null through to clear a note', async () => {
    const db = fakeDb();
    const repo = createHousesRepo({ db: db as never });

    await repo.setNote('house-1', null);

    expect(db.execute).toHaveBeenCalledWith('UPDATE houses SET note = ? WHERE id = ?', [
      null,
      'house-1',
    ]);
  });

  it('addBlacklistEntry writes only the GDPR-minimal columns (no name/email/phone/free-text)', async () => {
    const db = fakeDb();
    const repo = createHousesRepo({ db: db as never });

    const id = await repo.addBlacklistEntry({
      teamId: 'team-1',
      createdBy: 'user-1',
      lat: 52.5,
      lon: 13.4,
      houseId: 'house-1',
    });

    expect(id).toBe('fixed-uuid');
    const [sql, params] = db.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO blacklist_entries');
    expect(sql).not.toMatch(/name|email|phone/i);
    expect(params).toEqual([
      'fixed-uuid',
      'team-1',
      'house-1',
      52.5,
      13.4,
      // 0104: the default reason is the one WITH legal effect. Before, this
      // wrote 'not_interested' while the button said "Keine Ansprache".
      'no_solicitation',
      'user-1',
      expect.any(String),
    ]);
  });
});

describe('housesRepo building/party separation (0088_houses_units.sql)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getHouses means BUILDINGS: the one FROM houses query filters parent_house_id IS NULL', async () => {
    const db = fakeDb();
    const repo = createHousesRepo({ db: db as never });

    await repo.getHouses();

    const [sql] = db.getAll.mock.calls[0] as [string];
    expect(sql).toMatch(/parent_house_id IS NULL/);
  });

  it('watchHouses uses the same building filter, so the map never counts a party twice', () => {
    const db = fakeDb();
    const repo = createHousesRepo({ db: db as never });

    repo.watchHouses(() => {});

    const [sql] = db.watch.mock.calls[0] as [string];
    expect(sql).toMatch(/parent_house_id IS NULL/);
  });

  it('getUnits returns only rows WITH a parent, ordered by created_at', async () => {
    const db = fakeDb();
    const repo = createHousesRepo({ db: db as never });

    await repo.getUnits();

    const [sql] = db.getAll.mock.calls[0] as [string];
    expect(sql).toMatch(/parent_house_id IS NOT NULL/);
    expect(sql).toMatch(/ORDER BY created_at/);
  });

  it('watchUnits subscribes to the party query and returns an unsubscribe', () => {
    const db = fakeDb();
    const repo = createHousesRepo({ db: db as never });

    const unsubscribe = repo.watchUnits(() => {});

    const [sql] = db.watch.mock.calls[0] as [string];
    expect(sql).toMatch(/parent_house_id IS NOT NULL/);
    expect(typeof unsubscribe).toBe('function');
  });

  it('insertUnit writes parent_house_id and team_id and never territory_id', async () => {
    const db = fakeDb();
    const repo = createHousesRepo({ db: db as never });

    const id = await repo.insertUnit({
      parentHouseId: 'building-1',
      teamId: 'team-1',
      createdBy: 'user-1',
      lat: 52.5,
      lon: 13.4,
    });

    expect(id).toBe('fixed-uuid');
    const [sql, params] = db.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO houses');
    expect(sql).toContain('parent_house_id');
    expect(sql).not.toContain('territory_id');
    expect(sql).not.toContain('unit_count');
    expect(params).toEqual([
      'fixed-uuid',
      'team-1',
      'building-1',
      52.5,
      13.4,
      'new',
      null,
      'user-1',
      expect.any(String),
    ]);
  });

  it('setUnitLabel writes only the positional label for the given party id', async () => {
    const db = fakeDb();
    const repo = createHousesRepo({ db: db as never });

    await repo.setUnitLabel('unit-1', '3. OG links');

    expect(db.execute).toHaveBeenCalledWith('UPDATE houses SET unit_label = ? WHERE id = ?', [
      '3. OG links',
      'unit-1',
    ]);
  });

  it('setUnitCount writes only the doorbell-panel count on the building id', async () => {
    const db = fakeDb();
    const repo = createHousesRepo({ db: db as never });

    await repo.setUnitCount('building-1', 12);

    expect(db.execute).toHaveBeenCalledWith('UPDATE houses SET unit_count = ? WHERE id = ?', [
      12,
      'building-1',
    ]);
  });

  it('deletes a party, and scopes the statement so it can never hit a BUILDING', async () => {
    // 0105 added the server DELETE policy and the connector arm this test used
    // to assert the absence of. The local statement carries the same
    // `parent_house_id is not null` guard as the policy, so a coding mistake
    // cannot take a pin off the map and only discover the refusal one sync
    // later.
    const db = fakeDb();
    const repo = createHousesRepo({ db: db as never });
    await repo.deleteUnit('unit-1');
    const [sql, params] = db.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('DELETE FROM houses');
    expect(sql).toContain('parent_house_id IS NOT NULL');
    expect(params).toEqual(['unit-1']);
  });
});
