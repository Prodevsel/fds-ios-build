import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Node test environment: useLeaderboard.ts imports getSupabase() (module-level
// import) and, transitively via leaderboardCache.ts, react-native-mmkv — both
// pull in native/RN chains that don't parse under vitest/node. Mirrors
// assignTerritory.test.ts / useRoleScope.test.ts's supabase-module mock and
// leaderboardCache.test.ts's mmkv mock. Every test here injects a fake
// supabase + cache, so neither mock is ever actually invoked.
vi.mock('../../lib/auth/supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('react-native-mmkv', () => ({
  createMMKV: vi.fn(() => {
    throw new Error('MMKV native module must never be constructed in unit tests');
  }),
}));

import { createLeaderboardRepo } from './useLeaderboard';
import type { CacheStorage } from './db/leaderboardCache';
import { createLeaderboardCache } from './db/leaderboardCache';

function fakeCacheStorage(): CacheStorage & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getString: vi.fn((key: string) => store.get(key)),
    set: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
  };
}

function fakeSupabase(rows: unknown[] | null, error: unknown = null) {
  return { rpc: vi.fn(async () => ({ data: rows, error })) };
}

describe('createLeaderboardRepo (GAMI-01/03, revised D-01 rep-selected team)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls leaderboard_entries RPC with exactly { p_team_id, p_scope, p_period } (bound, never concatenated)', async () => {
    const supabase = fakeSupabase([]);
    const cache = createLeaderboardCache({ storage: fakeCacheStorage() });
    const repo = createLeaderboardRepo({ supabase: supabase as never, cache });

    await repo.fetchLeaderboard('team-1', 'team', 'week');

    expect(supabase.rpc).toHaveBeenCalledWith('leaderboard_entries', {
      p_team_id: 'team-1',
      p_scope: 'team',
      p_period: 'week',
    });
  });

  it('maps RPC rows to LeaderboardEntry[] and marks the result fresh', async () => {
    const supabase = fakeSupabase([
      { rank: 1, rep_id: 'rep-1', display_name: 'Erika Muster', deals_count: 5, commission_eur: 250 },
      { rank: 2, rep_id: 'rep-2', display_name: 'Max Mustermann', deals_count: 3, commission_eur: null },
    ]);
    const cache = createLeaderboardCache({ storage: fakeCacheStorage() });
    const repo = createLeaderboardRepo({ supabase: supabase as never, cache });

    const result = await repo.fetchLeaderboard('team-1', 'team', 'week');

    expect(result.fresh).toBe(true);
    expect(result.stale).toBe(false);
    expect(result.entries).toEqual([
      { rank: 1, repId: 'rep-1', displayName: 'Erika Muster', dealsCount: 5, commissionEur: 250 },
      { rank: 2, repId: 'rep-2', displayName: 'Max Mustermann', dealsCount: 3, commissionEur: null },
    ]);
  });

  it('null commission_eur maps to null (renders as absent, never coerced to 0)', async () => {
    const supabase = fakeSupabase([
      { rank: 1, rep_id: 'rep-1', display_name: 'Erika Muster', deals_count: 5, commission_eur: null },
    ]);
    const cache = createLeaderboardCache({ storage: fakeCacheStorage() });
    const repo = createLeaderboardRepo({ supabase: supabase as never, cache });

    const result = await repo.fetchLeaderboard('team-1', 'team', 'week');

    expect(result.entries[0]?.commissionEur).toBeNull();
  });

  it('writes the fresh result to the cache under this team+scope+period key', async () => {
    const supabase = fakeSupabase([
      { rank: 1, rep_id: 'rep-1', display_name: 'Erika Muster', deals_count: 5, commission_eur: 250 },
    ]);
    const storage = fakeCacheStorage();
    const cache = createLeaderboardCache({ storage });
    const repo = createLeaderboardRepo({ supabase: supabase as never, cache });

    await repo.fetchLeaderboard('team-1', 'team', 'week');

    const cached = cache.get({ teamId: 'team-1', scope: 'team', period: 'week' });
    expect(cached?.entries[0]?.repId).toBe('rep-1');
  });

  it('on RPC failure, falls back to the cached snapshot for that key marked stale', async () => {
    const cache = createLeaderboardCache({ storage: fakeCacheStorage() });
    const warmRepo = createLeaderboardRepo({
      supabase: fakeSupabase([
        { rank: 1, rep_id: 'rep-1', display_name: 'Erika Muster', deals_count: 5, commission_eur: 250 },
      ]) as never,
      cache,
    });
    await warmRepo.fetchLeaderboard('team-1', 'team', 'week');

    const failingRepo = createLeaderboardRepo({
      supabase: fakeSupabase(null, new Error('network down')) as never,
      cache,
    });
    const result = await failingRepo.fetchLeaderboard('team-1', 'team', 'week');

    expect(result.fresh).toBe(false);
    expect(result.stale).toBe(true);
    expect(result.entries[0]?.repId).toBe('rep-1');
  });

  it('on RPC failure with no prior cache for that key, throws (nothing to fall back to)', async () => {
    const cache = createLeaderboardCache({ storage: fakeCacheStorage() });
    const repo = createLeaderboardRepo({
      supabase: fakeSupabase(null, new Error('network down')) as never,
      cache,
    });

    await expect(repo.fetchLeaderboard('team-1', 'team', 'week')).rejects.toThrow('network down');
  });

  it('two different team ids keep separate cache entries — team B failure never leaks team A rows', async () => {
    const cache = createLeaderboardCache({ storage: fakeCacheStorage() });
    const teamARepo = createLeaderboardRepo({
      supabase: fakeSupabase([
        { rank: 1, rep_id: 'rep-a', display_name: 'Team A Rep', deals_count: 4, commission_eur: null },
      ]) as never,
      cache,
    });
    await teamARepo.fetchLeaderboard('team-a', 'team', 'week');

    const teamBFailingRepo = createLeaderboardRepo({
      supabase: fakeSupabase(null, new Error('network down')) as never,
      cache,
    });

    await expect(teamBFailingRepo.fetchLeaderboard('team-b', 'team', 'week')).rejects.toThrow();
  });
});

describe('useLeaderboard.ts source (GAMI-03: never touches PowerSync db.execute/connector/CRUD queue)', () => {
  it('never imports the PowerSync db handle, connector, or calls db.execute', () => {
    const filePath = fileURLToPath(new URL('./useLeaderboard.ts', import.meta.url));
    const source = readFileSync(filePath, 'utf-8');
    // Scan only actual import statements — not doc-comment prose — so this
    // stays a real GAMI-03 gate rather than banning the words in explanatory
    // comments.
    const importLines = source
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line))
      .join('\n');

    expect(importLines).not.toMatch(/lib\/db\/powersync/);
    expect(importLines).not.toMatch(/@powersync\/common/);
    expect(source).not.toMatch(/db\.execute/);
    expect(source).not.toMatch(/AbstractPowerSyncDatabase/);
  });
});
