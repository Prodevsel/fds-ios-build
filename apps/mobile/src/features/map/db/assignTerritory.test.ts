import { describe, expect, it, vi } from 'vitest';

// Node test environment: assignTerritory.ts transitively imports getSupabase
// (lib/auth/supabase), which reaches into native modules — mock it so these
// tests never load the native react-native chain (mirrors
// useRoleScope.test.ts's mocking pattern). Every test here injects its own
// fake `supabase`, so the mocked getSupabase is never actually invoked.
vi.mock('../../../lib/auth/supabase', () => ({ getSupabase: vi.fn() }));

import { createAssignTerritory, type CreateAssignTerritoryOptions } from './assignTerritory';

function fakeSupabase(
  rpcImpl: (fn: string, args: unknown) => Promise<{ data: unknown; error: unknown }>,
): NonNullable<CreateAssignTerritoryOptions['supabase']> {
  return { rpc: vi.fn(rpcImpl) as never };
}

describe('assignTerritory (direct assign_territory RPC helper)', () => {
  it('calls rpc("assign_territory", { p_territory_id, p_rep_id }) with the given uuid', async () => {
    const rpc = vi.fn(async () => ({ data: 'assigned', error: null }));
    const { assignTerritory } = createAssignTerritory({ supabase: { rpc: rpc as never } });

    await assignTerritory('territory-1', 'rep-1');

    expect(rpc).toHaveBeenCalledWith('assign_territory', {
      p_territory_id: 'territory-1',
      p_rep_id: 'rep-1',
    });
  });

  it('calls rpc with p_rep_id: null to clear the assignment', async () => {
    const rpc = vi.fn(async () => ({ data: 'assigned', error: null }));
    const { assignTerritory } = createAssignTerritory({ supabase: { rpc: rpc as never } });

    await assignTerritory('territory-1', null);

    expect(rpc).toHaveBeenCalledWith('assign_territory', {
      p_territory_id: 'territory-1',
      p_rep_id: null,
    });
  });

  it('throws on a transport error', async () => {
    const supabase = fakeSupabase(async () => ({ data: null, error: new Error('network down') }));
    const { assignTerritory } = createAssignTerritory({ supabase });

    await expect(assignTerritory('territory-1', 'rep-1')).rejects.toThrow('network down');
  });

  it.each(['assigned', 'not_entitled', 'not_team_member', 'not_activated'] as const)(
    'returns the %s verdict verbatim (not thrown)',
    async (verdict) => {
      const supabase = fakeSupabase(async () => ({ data: verdict, error: null }));
      const { assignTerritory } = createAssignTerritory({ supabase });

      await expect(assignTerritory('territory-1', 'rep-1')).resolves.toBe(verdict);
    },
  );
});
