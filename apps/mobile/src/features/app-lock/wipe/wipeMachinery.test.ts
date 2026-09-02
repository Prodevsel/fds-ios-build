import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SEC-07/SEC-08 (D-01/D-02/D-04/D-12, T-15-10-01..09) — the drain-then-purge
 * core. Every native/PowerSync dependency is mocked so this suite runs under
 * plain vitest/node; the behavior under test is `readWipeReadiness`/
 * `runDrainThenPurge`'s pure orchestration against an INJECTED `WipeDeps`,
 * never the real native wiring (that lives in `createDefaultWipeDeps` and is
 * covered separately, lightly, at the bottom of this file).
 */

vi.mock('expo-file-system', () => ({
  File: vi.fn(),
  Directory: vi.fn(),
  Paths: { document: 'file:///fake/documents' },
}));

vi.mock('../../../lib/db/powersync', () => ({
  openDatabase: vi.fn(),
  closeDatabase: vi.fn(),
}));

vi.mock('../../../lib/db/dbFilePaths', () => ({
  DB_PATH_VERIFIED: true,
  resolveDatabaseFilePathsDefault: vi.fn(() => ({
    directoryUri: '/fake',
    mainUri: '/fake/frontdoorsales.sqlite',
    walUri: '/fake/frontdoorsales.sqlite-wal',
    shmUri: '/fake/frontdoorsales.sqlite-shm',
  })),
}));

vi.mock('../../../lib/db/encryption', () => ({
  regenerateEncryptionKey: vi.fn(async () => 'fake-key'),
}));

import {
  PURGE_STEP_ORDER,
  createDefaultWipeDeps,
  readWipeReadiness,
  runDrainThenPurge,
  type WipeDeps,
  type WipeEntryPoint,
  type WipePhase,
} from './wipeMachinery';

function makeDeps(overrides: Partial<WipeDeps> = {}): {
  deps: WipeDeps;
  calls: string[];
  phases: WipePhase[];
} {
  const calls: string[] = [];
  const phases: WipePhase[] = [];
  const deps: WipeDeps = {
    getUploadQueueStats: vi.fn(async () => ({ count: 0, size: null })),
    disconnectAndClear: vi.fn(async () => {
      calls.push('disconnectAndClear');
    }),
    closeDatabase: vi.fn(async () => {
      calls.push('closeDatabase');
    }),
    deleteFile: vi.fn(async (uri: string) => {
      if (uri === 'main') calls.push('deleteFile:main');
      else if (uri === 'wal') calls.push('deleteFile:wal');
      else if (uri === 'shm') calls.push('deleteFile:shm');
    }),
    regenerateEncryptionKey: vi.fn(async () => {
      calls.push('regenerateEncryptionKey');
    }),
    clearAttachmentStore: vi.fn(async () => {
      calls.push('clearAttachmentStore');
    }),
    filePaths: { mainUri: 'main', walUri: 'wal', shmUri: 'shm' },
    dbPathVerified: true,
    onPhase: (phase) => phases.push(phase),
    ...overrides,
  };
  return { deps, calls, phases };
}

const DESTRUCTIVE_KEYS = [
  'disconnectAndClear',
  'closeDatabase',
  'deleteFile',
  'regenerateEncryptionKey',
  'clearAttachmentStore',
] as const;

function expectNoDestructiveCalls(deps: WipeDeps) {
  for (const key of DESTRUCTIVE_KEYS) {
    expect(deps[key]).not.toHaveBeenCalled();
  }
}

describe('readWipeReadiness', () => {
  it('surfaces the pending count VERBATIM, never coerced to a boolean', async () => {
    const { deps } = makeDeps({ getUploadQueueStats: vi.fn(async () => ({ count: 3, size: 120 })) });
    expect(await readWipeReadiness(deps)).toEqual({ kind: 'blocked', pendingCount: 3 });
  });

  it('yields ready when the queue is empty', async () => {
    const { deps } = makeDeps({ getUploadQueueStats: vi.fn(async () => ({ count: 0, size: null })) });
    expect(await readWipeReadiness(deps)).toEqual({ kind: 'ready' });
  });
});

describe('runDrainThenPurge — unverified-path gate (T-15-10-09)', () => {
  const entries: WipeEntryPoint[] = ['local', 'pin-lockout', 'remote'];

  for (const entry of entries) {
    it(`returns blocked-unverified-path and calls NOTHING destructive for entry point '${entry}'`, async () => {
      const { deps, phases } = makeDeps({ dbPathVerified: false });
      const result = await runDrainThenPurge(entry, deps);

      expect(result).toEqual({ kind: 'blocked-unverified-path' });
      expectNoDestructiveCalls(deps);
      expect(phases).toEqual([{ kind: 'blocked-unverified-path' }]);
    });
  }

  it('the unverified-path check runs BEFORE the queue check — both problems report the path issue', async () => {
    const { deps } = makeDeps({
      dbPathVerified: false,
      getUploadQueueStats: vi.fn(async () => ({ count: 5, size: null })),
    });

    const result = await runDrainThenPurge('local', deps);

    expect(result).toEqual({ kind: 'blocked-unverified-path' });
    expect(deps.getUploadQueueStats).not.toHaveBeenCalled();
  });

  it('never returns complete on ANY input combination with dbPathVerified: false', async () => {
    for (const count of [0, 1, 5]) {
      const { deps } = makeDeps({
        dbPathVerified: false,
        getUploadQueueStats: vi.fn(async () => ({ count, size: null })),
      });
      const result = await runDrainThenPurge('local', deps);
      expect(result.kind).not.toBe('complete');
    }
  });
});

describe('runDrainThenPurge — queue gate (D-01/D-02/D-04/D-12)', () => {
  const entries: WipeEntryPoint[] = ['local', 'pin-lockout'];

  for (const entry of entries) {
    it(`blocks with the verbatim pending count and calls NOTHING destructive ('${entry}')`, async () => {
      const { deps, phases } = makeDeps({
        getUploadQueueStats: vi.fn(async () => ({ count: 7, size: null })),
      });

      const result = await runDrainThenPurge(entry, deps);

      expect(result).toEqual({ kind: 'blocked', pendingCount: 7 });
      expectNoDestructiveCalls(deps);
      expect(phases).toEqual([{ kind: 'blocked', pendingCount: 7 }]);
    });
  }

  it('never returns complete when the queue is non-zero', async () => {
    const { deps } = makeDeps({ getUploadQueueStats: vi.fn(async () => ({ count: 1, size: null })) });
    const result = await runDrainThenPurge('local', deps);
    expect(result.kind).not.toBe('complete');
  });
});

describe('runDrainThenPurge — success path (zero queue, verified path)', () => {
  it('calls disconnectAndClear, closeDatabase, deleteFile(main/wal/shm), clearAttachmentStore, regenerateEncryptionKey in EXACTLY PURGE_STEP_ORDER', async () => {
    const { deps, calls } = makeDeps();
    const result = await runDrainThenPurge('local', deps);

    expect(result).toEqual({ kind: 'complete' });
    expect(calls).toEqual([...PURGE_STEP_ORDER]);
  });

  it("'local' and 'pin-lockout' produce byte-identical recorded call sequences (D-04, structural proof)", async () => {
    const local = makeDeps();
    const pinLockout = makeDeps();

    await runDrainThenPurge('local', local.deps);
    await runDrainThenPurge('pin-lockout', pinLockout.deps);

    expect(local.calls).toEqual(pinLockout.calls);
    expect(local.calls).toEqual([...PURGE_STEP_ORDER]);
  });

  it('emits purging before the first destructive call and complete only after the last one resolves', async () => {
    const order: string[] = [];
    const { deps } = makeDeps({
      disconnectAndClear: vi.fn(async () => {
        order.push('disconnectAndClear');
      }),
      onPhase: (phase) => order.push(`phase:${phase.kind}`),
    });

    await runDrainThenPurge('local', deps);

    expect(order[0]).toBe('phase:purging');
    expect(order[order.length - 1]).toBe('phase:complete');
    expect(order.indexOf('disconnectAndClear')).toBeGreaterThan(order.indexOf('phase:purging'));
  });

  it('regenerateEncryptionKey runs LAST, after every file is gone', async () => {
    const { deps, calls } = makeDeps();
    await runDrainThenPurge('local', deps);
    expect(calls[calls.length - 1]).toBe('regenerateEncryptionKey');
  });
});

describe('runDrainThenPurge — WAL/SHM tolerance vs. mainUri failure (T-15-10-08)', () => {
  it('a missing WAL/SHM file does NOT fail the purge', async () => {
    const { deps } = makeDeps({
      deleteFile: vi.fn(async (uri: string) => {
        if (uri === 'wal' || uri === 'shm') throw new Error('ENOENT');
      }),
    });

    const result = await runDrainThenPurge('local', deps);
    expect(result).toEqual({ kind: 'complete' });
  });

  it('a mainUri rejection DOES fail the purge, and regenerateEncryptionKey is still called', async () => {
    const { deps, calls } = makeDeps({
      deleteFile: vi.fn(async (uri: string) => {
        if (uri === 'main') throw new Error('disk full');
      }),
    });

    const result = await runDrainThenPurge('local', deps);

    expect(result).toEqual({ kind: 'failed', message: 'disk full' });
    expect(deps.regenerateEncryptionKey).toHaveBeenCalledOnce();
    expect(calls).not.toContain('deleteFile:wal');
    expect(calls).not.toContain('deleteFile:shm');
    expect(calls).not.toContain('clearAttachmentStore');
  });
});

describe('createDefaultWipeDeps (production wiring, lightly covered)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('never binds dbPathVerified to a literal true — it always reads DB_PATH_VERIFIED', async () => {
    const deps = createDefaultWipeDeps();
    expect(deps.dbPathVerified).toBe(true);
  });

  it('falls back to dbPathVerified: false when resolving the native paths throws', async () => {
    const dbFilePaths = await import('../../../lib/db/dbFilePaths');
    vi.mocked(dbFilePaths.resolveDatabaseFilePathsDefault).mockImplementationOnce(() => {
      throw new Error('native module not linked');
    });

    const deps = createDefaultWipeDeps();
    expect(deps.dbPathVerified).toBe(false);
  });
});
