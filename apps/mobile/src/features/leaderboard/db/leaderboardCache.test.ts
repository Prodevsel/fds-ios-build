import { beforeEach, describe, expect, it, vi } from 'vitest';

// Node test environment: react-native-mmkv is a native Nitro module — never
// loaded in this test, since every test injects a fake storage (mirrors
// walletRepo.test.ts's fake-db pattern). If a test accidentally hits the
// default storage path this mock keeps the suite from crashing while still
// making the miss obvious (constructor throws would fail loudly instead).
vi.mock('react-native-mmkv', () => ({
  createMMKV: vi.fn(() => {
    throw new Error('MMKV native module must never be constructed in unit tests');
  }),
}));

import { createLeaderboardCache, type CacheStorage } from './leaderboardCache';

function fakeStorage(): CacheStorage & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getString: vi.fn((key: string) => store.get(key)),
    set: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
  };
}

describe('leaderboardCache (non-PowerSync local store, D-05)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('round-trips a ranked LeaderboardEntry[] + fetchedAt through the injected storage', () => {
    const storage = fakeStorage();
    const cache = createLeaderboardCache({ storage });
    const envelope = {
      entries: [
        { rank: 1, repId: 'rep-1', displayName: 'Erika Muster', dealsCount: 5, commissionEur: 250 },
      ],
      fetchedAtIso: '2026-08-03T10:00:00.000Z',
    };

    cache.set({ teamId: 'team-1', scope: 'team' as const, period: 'week' as const }, envelope);
    const result = cache.get({ teamId: 'team-1', scope: 'team' as const, period: 'week' as const });

    expect(result).toEqual(envelope);
  });

  it('returns null for a cache miss', () => {
    const storage = fakeStorage();
    const cache = createLeaderboardCache({ storage });

    const result = cache.get({ teamId: 'team-1', scope: 'team' as const, period: 'week' as const });

    expect(result).toBeNull();
  });

  it('keys separately per team+scope+period — two team ids never share a cache entry', () => {
    const storage = fakeStorage();
    const cache = createLeaderboardCache({ storage });
    const envelopeA = {
      entries: [{ rank: 1, repId: 'rep-a', displayName: 'Team A Rep', dealsCount: 3, commissionEur: null }],
      fetchedAtIso: '2026-08-03T10:00:00.000Z',
    };
    const envelopeB = {
      entries: [{ rank: 1, repId: 'rep-b', displayName: 'Team B Rep', dealsCount: 9, commissionEur: null }],
      fetchedAtIso: '2026-08-03T11:00:00.000Z',
    };

    cache.set({ teamId: 'team-a', scope: 'team' as const, period: 'week' as const }, envelopeA);
    cache.set({ teamId: 'team-b', scope: 'team' as const, period: 'week' as const }, envelopeB);

    expect(cache.get({ teamId: 'team-a', scope: 'team' as const, period: 'week' as const })).toEqual(
      envelopeA,
    );
    expect(cache.get({ teamId: 'team-b', scope: 'team' as const, period: 'week' as const })).toEqual(
      envelopeB,
    );
    expect(storage.store.size).toBe(2);
  });

  it('keys separately per scope and per period for the SAME team id', () => {
    const storage = fakeStorage();
    const cache = createLeaderboardCache({ storage });
    const teamScopeWeek = {
      entries: [{ rank: 1, repId: 'rep-1', displayName: 'Rep', dealsCount: 1, commissionEur: null }],
      fetchedAtIso: '2026-08-03T10:00:00.000Z',
    };
    const orgScopeWeek = {
      entries: [{ rank: 1, repId: 'rep-2', displayName: 'Rep 2', dealsCount: 7, commissionEur: null }],
      fetchedAtIso: '2026-08-03T10:05:00.000Z',
    };

    cache.set({ teamId: 'team-1', scope: 'team' as const, period: 'week' as const }, teamScopeWeek);
    cache.set({ teamId: 'team-1', scope: 'org' as const, period: 'week' as const }, orgScopeWeek);

    expect(cache.get({ teamId: 'team-1', scope: 'team' as const, period: 'week' as const })).toEqual(
      teamScopeWeek,
    );
    expect(cache.get({ teamId: 'team-1', scope: 'org' as const, period: 'week' as const })).toEqual(
      orgScopeWeek,
    );
  });

  it('never throws on malformed stored JSON — falls back to a cache miss', () => {
    const storage = fakeStorage();
    storage.store.set('team-1:team:week', 'not-json{{');
    const cache = createLeaderboardCache({ storage });

    const result = cache.get({ teamId: 'team-1', scope: 'team' as const, period: 'week' as const });

    expect(result).toBeNull();
  });
});
