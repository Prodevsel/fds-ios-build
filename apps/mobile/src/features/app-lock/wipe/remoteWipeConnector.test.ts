import { describe, expect, it, vi } from 'vitest';

/**
 * remoteWipeConnector.ts imports wipeMachinery.ts (D-04, shared purge
 * machinery), lib/auth/supabase.ts, and lib/device/getDeviceId.ts, all of
 * which import native modules at module scope (expo-file-system,
 * expo-secure-store, expo-crypto, expo-application, PowerSync/op-sqlite) —
 * mock every one so this suite runs under plain vitest/node, mirroring
 * wipeMachinery.test.ts's own mock set exactly. Every test in this file
 * drives `attachRemoteWipeConnector`/`deriveRemoteWipeAction` against an
 * INJECTED `RemoteWipeDeps`, never `createDefaultRemoteWipeDeps`'s real
 * native wiring.
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
// supabase.ts (reached through remoteWipeConnector -> sessionsRepo) imports
// react-native-mmkv, whose real module cannot be parsed under the Node test
// environment. Unmocked, the whole suite loaded as ZERO tests rather than
// failing on an assertion — the same silent shape StatusSheet.test.tsx had.
vi.mock('react-native-mmkv', () => ({
  createMMKV: vi.fn(() => {
    throw new Error('MMKV native module must never be constructed in unit tests');
  }),
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));
vi.mock('expo-crypto', () => ({
  getRandomBytesAsync: vi.fn(),
  digestStringAsync: vi.fn(),
  randomUUID: vi.fn(() => 'fake-uuid'),
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
}));
vi.mock('expo-application', () => ({
  getAndroidId: vi.fn(() => 'fake-android-id'),
  getIosIdForVendorAsync: vi.fn(async () => 'fake-idfv'),
}));
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

import {
  attachRemoteWipeConnector,
  deriveRemoteWipeAction,
  parseRemoteWipeOrderRow,
  type RemoteWipeDeps,
  type RemoteWipeOrder,
} from './remoteWipeConnector';
import type { WipePhase } from './wipeMachinery';

/** Flushes a generous number of microtask ticks — every dep below is a plain
 * Promise-based async function (no real timers), so this is deterministic. */
async function flush(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

describe('deriveRemoteWipeAction (D-01, pure)', () => {
  it('is none for no order', () => {
    expect(deriveRemoteWipeAction(null, 0, false)).toEqual({ kind: 'none' });
  });

  it('locks unconditionally on first sight even with a non-zero queue', () => {
    const order: RemoteWipeOrder = { id: 'o1', status: 'queued', pendingArtifactCount: 7 };
    expect(deriveRemoteWipeAction(order, 7, false)).toEqual({ kind: 'lock-and-report' });
  });

  it('locks before purging even when the queue is already zero on first sight', () => {
    const order: RemoteWipeOrder = { id: 'o1', status: 'queued', pendingArtifactCount: 0 };
    expect(deriveRemoteWipeAction(order, 0, false)).toEqual({ kind: 'lock-and-report' });
  });

  it('reports the new count while still draining, already locked', () => {
    const order: RemoteWipeOrder = { id: 'o1', status: 'locked_draining', pendingArtifactCount: 3 };
    expect(deriveRemoteWipeAction(order, 3, true)).toEqual({ kind: 'lock-and-report' });
  });

  it('purges once the queue drains to zero, already locked', () => {
    const order: RemoteWipeOrder = { id: 'o1', status: 'locked_draining', pendingArtifactCount: 0 };
    expect(deriveRemoteWipeAction(order, 0, true)).toEqual({ kind: 'purge' });
  });

  it('a stalled order that finally drains still completes', () => {
    const order: RemoteWipeOrder = { id: 'o1', status: 'locked_stalled', pendingArtifactCount: 0 };
    expect(deriveRemoteWipeAction(order, 0, true)).toEqual({ kind: 'purge' });
  });

  it('never re-purges a purged_complete order', () => {
    const order: RemoteWipeOrder = { id: 'o1', status: 'purged_complete', pendingArtifactCount: 0 };
    expect(deriveRemoteWipeAction(order, 0, true)).toEqual({ kind: 'already-complete' });
  });
});

describe('parseRemoteWipeOrderRow', () => {
  it('parses a valid raw row', () => {
    expect(parseRemoteWipeOrderRow({ id: 'o1', status: 'queued', pending_artifact_count: '4' })).toEqual({
      id: 'o1',
      status: 'queued',
      pendingArtifactCount: 4,
    });
  });

  it('drops an unrecognized status rather than guessing', () => {
    expect(parseRemoteWipeOrderRow({ id: 'o1', status: 'bogus', pending_artifact_count: '4' })).toBeNull();
  });

  it('is null for an absent row', () => {
    expect(parseRemoteWipeOrderRow(undefined)).toBeNull();
  });
});

interface Harness {
  deps: RemoteWipeDeps;
  calls: string[];
  unsubscribeSpy: ReturnType<typeof vi.fn>;
  emit(order: RemoteWipeOrder | null): void;
}

function makeHarness(overrides: Partial<RemoteWipeDeps> = {}): Harness {
  const calls: string[] = [];
  let watchCb: ((order: RemoteWipeOrder | null) => void) | null = null;
  const unsubscribeSpy = vi.fn();

  const deps: RemoteWipeDeps = {
    watchOrder: vi.fn((cb) => {
      watchCb = cb;
      return unsubscribeSpy;
    }),
    getUploadQueueStats: vi.fn(async () => ({ count: 0, size: null })),
    lock: vi.fn(() => {
      calls.push('lock:remote-wipe');
    }),
    revokeAllSessions: vi.fn(async () => {
      calls.push('revokeAllSessions');
    }),
    reportProgress: vi.fn(async (_deviceId: string, status: string, pendingCount: number, stallReason?: string) => {
      calls.push(`reportProgress:${status}:${pendingCount}:${stallReason ?? 'none'}`);
      return 'recorded' as const;
    }),
    getDeviceId: vi.fn(async () => 'device-1'),
    runPurge: vi.fn(async (): Promise<WipePhase> => ({ kind: 'complete' })),
    ...overrides,
  };

  return {
    deps,
    calls,
    unsubscribeSpy,
    emit(order) {
      watchCb?.(order);
    },
  };
}

describe('attachRemoteWipeConnector (D-01/D-02/D-04)', () => {
  it('on first sight of an order: lock, revokeAllSessions, reportProgress in that exact order, zero purge calls', async () => {
    const { deps, calls, emit } = makeHarness({
      getUploadQueueStats: vi.fn(async () => ({ count: 7, size: null })),
    });
    attachRemoteWipeConnector(deps);

    emit({ id: 'o1', status: 'queued', pendingArtifactCount: 7 });
    await flush();

    expect(calls).toEqual(['lock:remote-wipe', 'revokeAllSessions', 'reportProgress:locked_draining:7:none']);
    expect(deps.runPurge).not.toHaveBeenCalled();
  });

  it('runPurge is never called while pendingCount > 0, across queued/locked_draining/locked_stalled and both lock states', async () => {
    const { deps, emit } = makeHarness({
      getUploadQueueStats: vi.fn(async () => ({ count: 5, size: null })),
    });
    attachRemoteWipeConnector(deps);

    // First sight (alreadyLocked: false -> true after this tick).
    emit({ id: 'o1', status: 'queued', pendingArtifactCount: 5 });
    await flush();
    // Already locked, still draining.
    emit({ id: 'o1', status: 'locked_draining', pendingArtifactCount: 5 });
    await flush();
    // Already locked, now stalled — still non-zero.
    emit({ id: 'o1', status: 'locked_stalled', pendingArtifactCount: 5 });
    await flush();

    expect(deps.runPurge).not.toHaveBeenCalled();
  });

  it('a reportProgress rejection does not undo the lock', async () => {
    const { deps, emit } = makeHarness({
      reportProgress: vi.fn(async () => {
        throw new Error('network down');
      }),
    });
    attachRemoteWipeConnector(deps);

    emit({ id: 'o1', status: 'queued', pendingArtifactCount: 2 });
    await flush();

    expect(deps.lock).toHaveBeenCalledWith('remote-wipe');
    expect(deps.lock).toHaveBeenCalledTimes(1);
  });

  it('a no_order reportProgress result does not undo the lock', async () => {
    const { deps, emit } = makeHarness({
      reportProgress: vi.fn(async () => 'no_order' as const),
    });
    attachRemoteWipeConnector(deps);

    emit({ id: 'o1', status: 'queued', pendingArtifactCount: 2 });
    await flush();

    expect(deps.lock).toHaveBeenCalledWith('remote-wipe');
  });

  it('on purge: calls runPurge and only then reports purged_complete with a literal 0 — never a non-zero count', async () => {
    const { deps, calls, emit } = makeHarness();
    attachRemoteWipeConnector(deps);

    // Lock first (D-01: never skipped, even at count 0).
    emit({ id: 'o1', status: 'queued', pendingArtifactCount: 0 });
    await flush();
    expect(deps.runPurge).not.toHaveBeenCalled();

    // Now already locked, queue at zero -> purge.
    emit({ id: 'o1', status: 'locked_draining', pendingArtifactCount: 0 });
    await flush();

    expect(deps.runPurge).toHaveBeenCalledOnce();
    expect(calls.at(-1)).toBe('reportProgress:purged_complete:0:none');
    for (const call of (deps.reportProgress as ReturnType<typeof vi.fn>).mock.calls) {
      if (call[1] === 'purged_complete') {
        expect(call[2]).toBe(0);
      }
    }
  });

  it('blocked-unverified-path maps to locked_stalled/unverified_path, never purged_complete, and reports the truthful (possibly zero) count', async () => {
    const { deps, calls, emit } = makeHarness({
      runPurge: vi.fn(async (): Promise<WipePhase> => ({ kind: 'blocked-unverified-path' })),
    });
    attachRemoteWipeConnector(deps);

    emit({ id: 'o1', status: 'queued', pendingArtifactCount: 0 });
    await flush();
    emit({ id: 'o1', status: 'locked_draining', pendingArtifactCount: 0 });
    await flush();

    expect(deps.runPurge).toHaveBeenCalledOnce();
    expect(calls.at(-1)).toBe('reportProgress:locked_stalled:0:unverified_path');
    expect(calls).not.toContain('reportProgress:purged_complete:0:none');
  });

  it('does not retry the purge on a subsequent watch tick after a blocked-unverified-path result', async () => {
    const { deps, emit } = makeHarness({
      runPurge: vi.fn(async (): Promise<WipePhase> => ({ kind: 'blocked-unverified-path' })),
    });
    attachRemoteWipeConnector(deps);

    emit({ id: 'o1', status: 'queued', pendingArtifactCount: 0 });
    await flush();
    emit({ id: 'o1', status: 'locked_draining', pendingArtifactCount: 0 });
    await flush();
    // One more tick with the identical (still-locked, still-zero) state.
    emit({ id: 'o1', status: 'locked_stalled', pendingArtifactCount: 0 });
    await flush();

    expect(deps.runPurge).toHaveBeenCalledOnce();
  });

  it('a queue-caused stall carries stallReason "queue", distinct from unverified_path', async () => {
    const { deps, calls, emit } = makeHarness({
      runPurge: vi.fn(async (): Promise<WipePhase> => ({ kind: 'blocked', pendingCount: 2 })),
    });
    attachRemoteWipeConnector(deps);

    emit({ id: 'o1', status: 'queued', pendingArtifactCount: 0 });
    await flush();
    emit({ id: 'o1', status: 'locked_draining', pendingArtifactCount: 0 });
    await flush();

    expect(calls.at(-1)).toBe('reportProgress:locked_stalled:2:queue');
  });

  it('no reportProgress call in this module ever carries locked_stalled with a null/missing reason', async () => {
    const scenarios: WipePhase[] = [
      { kind: 'blocked-unverified-path' },
      { kind: 'blocked', pendingCount: 3 },
    ];

    for (const purgeResult of scenarios) {
      const { deps, emit } = makeHarness({
        runPurge: vi.fn(async (): Promise<WipePhase> => purgeResult),
      });
      attachRemoteWipeConnector(deps);

      emit({ id: 'o1', status: 'queued', pendingArtifactCount: 0 });
      await flush();
      emit({ id: 'o1', status: 'locked_draining', pendingArtifactCount: 0 });
      await flush();

      for (const call of (deps.reportProgress as ReturnType<typeof vi.fn>).mock.calls) {
        if (call[1] === 'locked_stalled') {
          expect(call[3]).toBeDefined();
          expect(call[3]).not.toBeNull();
        }
      }
    }
  });

  it('returns a cleanup function that removes the watch subscription', () => {
    const { deps, unsubscribeSpy } = makeHarness();
    const cleanup = attachRemoteWipeConnector(deps);

    expect(unsubscribeSpy).not.toHaveBeenCalled();
    cleanup();
    expect(unsubscribeSpy).toHaveBeenCalledOnce();
  });

  it('does nothing for a null order', async () => {
    const { deps, calls, emit } = makeHarness();
    attachRemoteWipeConnector(deps);

    emit(null);
    await flush();

    expect(calls).toEqual([]);
    expect(deps.lock).not.toHaveBeenCalled();
  });

  it('does nothing for an already purged_complete order', async () => {
    const { deps, calls, emit } = makeHarness();
    attachRemoteWipeConnector(deps);

    emit({ id: 'o1', status: 'purged_complete', pendingArtifactCount: 0 });
    await flush();

    expect(calls).toEqual([]);
    expect(deps.lock).not.toHaveBeenCalled();
  });
});
