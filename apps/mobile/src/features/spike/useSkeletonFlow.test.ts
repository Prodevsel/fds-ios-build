import { beforeEach, describe, expect, it, vi } from 'vitest';

// Node test environment: never load native Expo/RN modules (see
// vitest.config.ts). The module under test imports these transitively; the
// exported bootSkeletonFlow() itself only consumes injected deps.
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'test-uuid') }));
vi.mock('../../lib/auth/supabase', () => ({
  getSupabase: vi.fn(),
  getPowerSyncUrl: vi.fn(),
}));
vi.mock('../../lib/db/powersync', () => ({ openDatabase: vi.fn() }));

import { bootSkeletonFlow, type SkeletonBootDeps, type SkeletonPhase } from './useSkeletonFlow';

interface FakeDb {
  readonly tag: 'fake-db';
}

function makeDeps(overrides: Partial<SkeletonBootDeps<FakeDb>> = {}) {
  const phases: SkeletonPhase[] = [];
  const deps: SkeletonBootDeps<FakeDb> = {
    getSession: vi.fn(async () => ({ data: { session: { user: { id: 'u1' } } } })),
    signInWithPassword: vi.fn(async () => ({ error: null })),
    openAndConnect: vi.fn(async (): Promise<FakeDb> => ({ tag: 'fake-db' })),
    setPhase: (phase) => phases.push(phase),
    ...overrides,
  };
  return { deps, phases };
}

describe('bootSkeletonFlow (Defect 1: offline session restore)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('restore mode with a stored session reaches ready WITHOUT signInWithPassword', async () => {
    const { deps, phases } = makeDeps();

    const db = await bootSkeletonFlow(deps, 'restore');

    expect(db).toEqual({ tag: 'fake-db' });
    expect(deps.signInWithPassword).not.toHaveBeenCalled();
    expect(deps.getSession).toHaveBeenCalledTimes(1);
    expect(phases).toEqual(['connecting', 'ready']);
  });

  it('restore mode with no stored session ends signed-out and never opens the DB', async () => {
    const { deps, phases } = makeDeps({
      getSession: vi.fn(async () => ({ data: { session: null } })),
    });

    const db = await bootSkeletonFlow(deps, 'restore');

    expect(db).toBeNull();
    expect(deps.signInWithPassword).not.toHaveBeenCalled();
    expect(deps.openAndConnect).not.toHaveBeenCalled();
    expect(phases).toEqual(['signed-out']);
  });

  it('sign-in mode runs the password grant then the same DB-init path', async () => {
    const { deps, phases } = makeDeps();

    const db = await bootSkeletonFlow(deps, 'sign-in');

    expect(db).toEqual({ tag: 'fake-db' });
    expect(deps.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(phases).toEqual(['signing-in', 'connecting', 'ready']);
  });

  it('sign-in mode surfaces auth errors and never opens the DB', async () => {
    const { deps } = makeDeps({
      signInWithPassword: vi.fn(async () => ({ error: { message: 'bad credentials' } })),
    });

    await expect(bootSkeletonFlow(deps, 'sign-in')).rejects.toThrow(
      'sign-in failed: bad credentials',
    );
    expect(deps.openAndConnect).not.toHaveBeenCalled();
  });
});
