import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useMemo, useState } from 'react';
import { getSupabase } from '../../lib/auth/supabase';
import {
  type LeaderboardCache,
  type LeaderboardEntry,
  type LeaderboardPeriod,
  type LeaderboardScope,
  createLeaderboardCache,
} from './db/leaderboardCache';

export type { LeaderboardEntry, LeaderboardPeriod, LeaderboardScope };

/**
 * useLeaderboard — GAMI-01/03, revised D-01. Fetches the leaderboard for a
 * team the REP SELECTED from their own `useRoleScope().teams` list (there is
 * no engineering-chosen default team; the caller passes whichever teamId the
 * rep picked) via a plain `leaderboard_entries` RPC call, caching the result
 * in the D-05 non-PowerSync `leaderboardCache`. This file NEVER touches the
 * PowerSync db handle, the connector, or the CRUD-queue — asserted by design
 * (this module imports nothing from `lib/db/powersync` or `@powersync/common`)
 * and by a source-scan test (useLeaderboard.test.ts).
 *
 * Mirrors walletRepo.ts's pure-core-plus-thin-shell split (createWalletRepo)
 * and assignTerritory.ts's direct supabase.rpc DI — but wraps an RPC + local
 * cache instead of a PowerSync watch.
 */

/** Mirrors 0064_leaderboard_entries_rpc.sql's returned row shape exactly. */
interface RawLeaderboardEntryRecord {
  rank: number;
  rep_id: string;
  display_name: string;
  deals_count: number;
  commission_eur: number | null;
}

function toLeaderboardEntry(record: RawLeaderboardEntryRecord): LeaderboardEntry {
  return {
    rank: record.rank,
    repId: record.rep_id,
    displayName: record.display_name,
    dealsCount: record.deals_count,
    commissionEur: record.commission_eur,
  };
}

export interface LeaderboardResult {
  entries: LeaderboardEntry[];
  /** True when these rows came from a fresh RPC response this call. */
  fresh: boolean;
  /** True when these rows are the last-cached snapshot after an RPC failure
   * (offline / network error) — the UI shows them marked stale. */
  stale: boolean;
  fetchedAtIso: string | null;
}

export interface CreateLeaderboardRepoOptions {
  /** Injectable for tests (a spy client); defaults to the real getSupabase() singleton. */
  supabase?: Pick<SupabaseClient, 'rpc'>;
  /** Injectable for tests (a fake-storage-backed cache); defaults to the real MMKV cache. */
  cache?: LeaderboardCache;
}

export interface LeaderboardRepo {
  /**
   * Calls `leaderboard_entries(p_team_id, p_scope, p_period)` with exactly
   * the rep-selected teamId (bound, never string-concatenated). On success,
   * writes the fresh rows to the per-team+scope+period cache entry and
   * returns them with `fresh: true`. On a network/RPC failure, falls back to
   * the cached snapshot for that exact key (marked `stale: true`) — or
   * throws if no cached snapshot exists yet for that key.
   */
  fetchLeaderboard(
    teamId: string,
    scope: LeaderboardScope,
    period: LeaderboardPeriod,
  ): Promise<LeaderboardResult>;
}

/** Injectable options-object DI (mirrors createWalletRepo/createAssignTerritory). */
export function createLeaderboardRepo(options: CreateLeaderboardRepoOptions = {}): LeaderboardRepo {
  const supabase = options.supabase ?? getSupabase();
  const cache = options.cache ?? createLeaderboardCache();

  return {
    async fetchLeaderboard(teamId, scope, period) {
      const key = { teamId, scope, period };
      const { data, error } = await supabase.rpc('leaderboard_entries', {
        p_team_id: teamId,
        p_scope: scope,
        p_period: period,
      });

      if (error) {
        const cached = cache.get(key);
        if (cached) {
          return {
            entries: cached.entries,
            fresh: false,
            stale: true,
            fetchedAtIso: cached.fetchedAtIso,
          };
        }
        throw error;
      }

      const entries = ((data as RawLeaderboardEntryRecord[] | null) ?? []).map(toLeaderboardEntry);
      const fetchedAtIso = new Date().toISOString();
      cache.set(key, { entries, fetchedAtIso });
      return { entries, fresh: true, stale: false, fetchedAtIso };
    },
  };
}

export interface UseLeaderboardState {
  entries: LeaderboardEntry[];
  loading: boolean;
  /** True when the shown entries are a last-fetched (offline) snapshot. */
  stale: boolean;
  fetchedAtIso: string | null;
  error: unknown;
}

/**
 * Reactive shell over `createLeaderboardRepo` (mirrors useRoleScope's
 * shell-wraps-a-pure-core convention). `teamId` is REP-SELECTED (revised
 * D-01) — pass `null` while no team is selected yet (e.g. `teams` not loaded)
 * to skip the fetch entirely.
 *
 * `refreshToken` (09-07, GAMI-04): an opaque value included in the fetch
 * effect's dependency array purely to force a re-fetch on demand — bump it
 * (e.g. a counter) when an external event (a live `useDealClosedBroadcast`
 * deal-closed notification) means the currently-shown ranking is stale.
 * Never used for anything but retriggering the effect.
 */
export function useLeaderboard(
  teamId: string | null,
  scope: LeaderboardScope,
  period: LeaderboardPeriod,
  refreshToken: number = 0,
): UseLeaderboardState {
  const repo = useMemo(() => createLeaderboardRepo(), []);
  const [state, setState] = useState<UseLeaderboardState>({
    entries: [],
    loading: teamId !== null,
    stale: false,
    fetchedAtIso: null,
    error: null,
  });

  useEffect(() => {
    if (teamId === null) {
      setState({ entries: [], loading: false, stale: false, fetchedAtIso: null, error: null });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    void repo
      .fetchLeaderboard(teamId, scope, period)
      .then((result) => {
        if (cancelled) return;
        setState({
          entries: result.entries,
          loading: false,
          stale: result.stale,
          fetchedAtIso: result.fetchedAtIso,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ entries: [], loading: false, stale: false, fetchedAtIso: null, error });
      });

    return () => {
      cancelled = true;
    };
  }, [repo, teamId, scope, period, refreshToken]);

  return state;
}
