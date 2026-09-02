import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveRepStatus } from './useReps';

/**
 * Unit coverage for the ONBD-02 3-state roster derivation (D-06 root-cause
 * fix). Each of the three states must be independently producible from
 * fixture inputs — Pitfall 3 warns against silently collapsing this back to
 * two states (e.g. reusing 'active' for both activated and synced).
 */
describe('deriveRepStatus', () => {
  it("returns 'invited' when the rep has not confirmed their invite, regardless of first_synced_at", () => {
    expect(deriveRepStatus(false, null)).toBe('invited');
  });

  it("returns 'invited' even if first_synced_at is somehow set on an unconfirmed row (confirmed is authoritative)", () => {
    expect(deriveRepStatus(false, '2026-08-01T00:00:00Z')).toBe('invited');
  });

  it("returns 'activated' when confirmed but first_synced_at is still null", () => {
    expect(deriveRepStatus(true, null)).toBe('activated');
  });

  it("returns 'synced' when confirmed AND first_synced_at is set", () => {
    expect(deriveRepStatus(true, '2026-08-01T00:00:00Z')).toBe('synced');
  });

  it('never returns the old collapsed 2-state values', () => {
    const results = [
      deriveRepStatus(false, null),
      deriveRepStatus(true, null),
      deriveRepStatus(true, '2026-08-01T00:00:00Z'),
    ];
    expect(new Set(results)).toEqual(new Set(['invited', 'activated', 'synced']));
  });
});

/**
 * Query-builder coverage for the COMPANY-TEAM TRAP (T-gti-08).
 *
 * `operator_create_company` (0057:83-84) sets `teams.lead_id = auth.uid()` on
 * the COMPANY team it bootstraps, purely so the operator can see the company
 * they just created. Neither team resolver filtered by team type, so for any
 * operator who had ever run the company wizard `useLeadTeamId` resolved to
 * that company team — and the rep invite then SUCCEEDED into a team with no
 * territories and no sales organisation. No error, no message, a broken
 * account that looks like a success.
 *
 * The guard is a `sales_org_id is not null` filter on BOTH resolvers, asserted
 * here against a stubbed Supabase client. It has to be asserted on the QUERY
 * (a client-side `.filter()` over already-fetched rows would be a different,
 * weaker thing, and would still let the rows cross the wire).
 */

interface RecordedOp {
  op: string;
  args: unknown[];
}
interface RecordedQuery {
  table: string;
  ops: RecordedOp[];
}

function makeFakeSupabase(rowsByTable: Record<string, unknown[]> = {}) {
  const queries: RecordedQuery[] = [];

  function from(table: string) {
    const record: RecordedQuery = { table, ops: [] };
    queries.push(record);
    const rows = rowsByTable[table] ?? [];
    const result = { data: rows, error: null };

    const builder: Record<string, unknown> = {
      maybeSingle: () => {
        record.ops.push({ op: 'maybeSingle', args: [] });
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(onFulfilled, onRejected),
    };
    for (const method of ['select', 'eq', 'order', 'limit', 'not', 'in', 'is']) {
      builder[method] = (...args: unknown[]) => {
        record.ops.push({ op: method, args });
        return builder;
      };
    }
    return builder;
  }

  return { supabase: { from }, queries };
}

let currentFake = makeFakeSupabase();

vi.mock('@/lib/auth/useSession', () => ({
  useSession: () => ({
    session: { user: { id: '40000000-0000-0000-0000-000000000006' } },
    role: 'operator',
    loading: false,
  }),
}));
vi.mock('@/lib/supabase', () => ({ getSupabase: () => currentFake.supabase }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

function teamsQuery() {
  const q = currentFake.queries.find((entry) => entry.table === 'teams');
  if (!q) {
    throw new Error('no query against `teams` was issued');
  }
  return q;
}

/** `.not('sales_org_id', 'is', null)` — the server-side team-type filter. */
function hasSalesOrgFilter(query: RecordedQuery): boolean {
  return query.ops.some(
    (o) =>
      o.op === 'not' && o.args[0] === 'sales_org_id' && o.args[1] === 'is' && o.args[2] === null,
  );
}

afterEach(() => {
  currentFake = makeFakeSupabase();
});

describe('useLeadTeamId (T-gti-08: never resolves a company team)', () => {
  it("applies a `sales_org_id is not null` filter, so a company team is unreachable through it", async () => {
    currentFake = makeFakeSupabase({
      // The trap, staged: an operator who ran the company wizard IS the
      // lead_id of this company team. Only the query filter keeps it out.
      teams: [{ id: '30000000-0000-0000-0000-000000000001' }],
    });
    const { useLeadTeamId } = await import('./useReps');
    const { result } = renderHook(() => useLeadTeamId(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(hasSalesOrgFilter(teamsQuery())).toBe(true);
  });

  it('still resolves deterministically (oldest led team first, limit 1)', async () => {
    currentFake = makeFakeSupabase({ teams: [{ id: 'team-1' }] });
    const { useLeadTeamId } = await import('./useReps');
    const { result } = renderHook(() => useLeadTeamId(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const q = teamsQuery();
    expect(q.ops.some((o) => o.op === 'eq' && o.args[0] === 'lead_id')).toBe(true);
    expect(q.ops.some((o) => o.op === 'order' && o.args[0] === 'created_at')).toBe(true);
    expect(q.ops.some((o) => o.op === 'limit' && o.args[0] === 1)).toBe(true);
  });
});

describe('useAdministrableTeams (T-gti-08: never OFFERS a company team)', () => {
  it('applies the same `sales_org_id is not null` filter', async () => {
    currentFake = makeFakeSupabase({ teams: [] });
    const { useAdministrableTeams } = await import('./useReps');
    const { result } = renderHook(() => useAdministrableTeams(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(hasSalesOrgFilter(teamsQuery())).toBe(true);
  });

  it('reads id, name and lead_id and does NOT re-scope by org membership in TypeScript (MAND-02: teams_select already did)', async () => {
    currentFake = makeFakeSupabase({
      teams: [
        { id: 'team-a', name: 'Team Org A', lead_id: null },
        { id: 'team-b', name: 'Team Org B', lead_id: 'user-9' },
      ],
    });
    const { useAdministrableTeams } = await import('./useReps');
    const { result } = renderHook(() => useAdministrableTeams(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const q = teamsQuery();
    const select = q.ops.find((o) => o.op === 'select');
    expect(String(select?.args[0])).toContain('lead_id');
    // Every row the RLS-scoped query returned is offered — no client-side drop.
    expect(result.current.data).toEqual([
      { id: 'team-a', name: 'Team Org A', leadId: null },
      { id: 'team-b', name: 'Team Org B', leadId: 'user-9' },
    ]);
  });
});
