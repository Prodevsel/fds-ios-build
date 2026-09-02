import { describe, expect, it, vi } from 'vitest';

/**
 * This repo has no react-native-testing-library, so `AppLockProvider`'s
 * behavior is tested entirely through its exported pure functions
 * (`resolveInitialLockState`/`applyLock`/`applyUnlock`) — the same split
 * `useSettings.ts`'s `resolveInitialSnapshot`/`attachSettingsWatch` and
 * `AccessibilityProvider.tsx`'s `resolveAccessibilityContext` establish.
 * `AppLockProvider.tsx` imports `pin/pinHash.ts`, which imports
 * `expo-secure-store`/`expo-crypto` at module scope (native modules) — mock
 * both so this file can import the module for its pure exports without
 * loading react-native's own native-module bootstrapping (`pinHash.test.ts`
 * / `biometrics.test.ts` precedent).
 */
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));
vi.mock('expo-crypto', () => ({
  getRandomBytesAsync: vi.fn(),
  digestStringAsync: vi.fn(),
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
}));
// 15-07: AppLockProvider now also imports useAppStateLock.ts (react-native
// AppState) and useIdleTimer.ts (-> useSessionDb.ts -> lib/db/powersync.ts,
// a native PowerSync/op-sqlite import, plus settingsRepo.ts/
// settingsPolicyRepo.ts) — mock all three at the module boundary, same
// precedent as this file's existing mocks above and
// `useAppStateLock.test.ts`/`useIdleTimer.test.ts`.
vi.mock('react-native', () => ({
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));
vi.mock('../../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('../settings/db/settingsRepo', () => ({
  createSettingsRepo: () => ({ watchSettings: () => () => {} }),
}));
vi.mock('../settings/db/settingsPolicyRepo', () => ({
  createSettingsPolicyRepo: () => ({ watchPolicies: () => () => {} }),
}));
// 15-11: AppLockProvider.tsx now also imports remoteWipeConnector.ts (which
// transitively imports wipeMachinery.ts, lib/auth/supabase.ts, and
// lib/device/getDeviceId.ts — all native-module-touching at module scope)
// and useSessionDb.ts (openDatabase()/getSupabase()) — mock the same module
// boundary AppLockGate.test.tsx/wipeMachinery.test.ts already establish for
// this exact chain.
vi.mock('expo-file-system', () => ({
  File: vi.fn(),
  Directory: vi.fn(),
  Paths: { document: 'file:///fake/documents' },
}));
vi.mock('../../lib/db/powersync', () => ({ openDatabase: vi.fn(), closeDatabase: vi.fn() }));
vi.mock('../../lib/db/dbFilePaths', () => ({
  DB_PATH_VERIFIED: true,
  resolveDatabaseFilePathsDefault: vi.fn(() => ({
    directoryUri: '/fake',
    mainUri: '/fake/frontdoorsales.sqlite',
    walUri: '/fake/frontdoorsales.sqlite-wal',
    shmUri: '/fake/frontdoorsales.sqlite-shm',
  })),
}));
vi.mock('../../lib/db/encryption', () => ({ regenerateEncryptionKey: vi.fn(async () => 'fake-key') }));
vi.mock('../../lib/auth/supabase', () => ({ getSupabase: vi.fn(() => ({ auth: { signOut: vi.fn() } })) }));
vi.mock('../../lib/device/getDeviceId', () => ({ getDeviceIdDefault: vi.fn(async () => ({ deviceId: 'fake', deviceIdSource: 'fallback-uuid' })) }));
vi.mock('../settings/db/sessionsRepo', () => ({ createSessionsRepo: () => ({ listSessions: vi.fn(async () => []), revokeSession: vi.fn(async () => undefined) }) }));

import { applyLock, applyUnlock, resolveAppLockContext, resolveInitialLockState, type AppLockApi, type LockReason } from './AppLockProvider';

// Node test environment: react-native-mmkv is a native Nitro module. The
// provider constructs one for the fresh-install marker (freshInstallReset.ts),
// so it needs a stand-in here. A Map-backed fake with the marker ALREADY set
// keeps these tests on the existing-install path — the reset branch has its own
// suite in freshInstallReset.test.ts.
vi.mock('react-native-mmkv', () => {
  const map = new Map([['installed', '2026-01-01T00:00:00.000Z']]);
  return {
    createMMKV: () => ({
      getString: (k: string) => map.get(k),
      set: (k: string, v: string) => void map.set(k, v),
    }),
  };
});

describe('resolveInitialLockState', () => {
  it('is unlocked when no PIN credential exists', () => {
    expect(resolveInitialLockState(false)).toEqual({ isLocked: false, lockReason: null });
  });

  it('is locked when a PIN credential exists (the app opens locked on cold start)', () => {
    expect(resolveInitialLockState(true)).toEqual({ isLocked: true, lockReason: 'idle' });
  });
});

describe('applyLock', () => {
  it('locks an unlocked state with the given reason', () => {
    expect(applyLock({ isLocked: false, lockReason: null }, 'background')).toEqual({
      isLocked: true,
      lockReason: 'background',
    });
  });

  it('is idempotent: a second lock() call preserves the FIRST reason', () => {
    const alreadyLocked = { isLocked: true, lockReason: 'remote-wipe' as const };
    expect(applyLock(alreadyLocked, 'background')).toEqual(alreadyLocked);
    expect(applyLock(alreadyLocked, 'idle')).toEqual(alreadyLocked);
  });

  it('a background event cannot mask a remote-wipe lock', () => {
    const wipeLocked = { isLocked: true, lockReason: 'remote-wipe' as const };
    const result = applyLock(wipeLocked, 'background');
    expect(result.lockReason).toBe('remote-wipe');
  });
});

describe('applyUnlock (T-15-11-02: a correct PIN/biometric does not open a remote-wipe lock)', () => {
  it('clears both isLocked and lockReason', () => {
    expect(applyUnlock({ isLocked: true, lockReason: 'idle' })).toEqual({ isLocked: false, lockReason: null });
  });

  it.each<LockReason>(['background', 'idle', 'manual', 'session-revoked'])(
    'clears a %s-reasoned lock',
    (reason) => {
      expect(applyUnlock({ isLocked: true, lockReason: reason })).toEqual({ isLocked: false, lockReason: null });
    },
  );

  it('REFUSES to clear a remote-wipe lock — D-01\'s irreversibility', () => {
    const wipeLocked = { isLocked: true, lockReason: 'remote-wipe' as const };
    expect(applyUnlock(wipeLocked)).toBe(wipeLocked);
  });
});

describe('resolveAppLockContext', () => {
  it('throws a descriptive error when used outside an AppLockProvider', () => {
    expect(() => resolveAppLockContext(undefined)).toThrow(/AppLockProvider/);
  });

  it('returns the context value unchanged when present', () => {
    const fakeApi: AppLockApi = {
      isLocked: false,
      lockReason: null,
      hasPin: false,
      lock: () => {},
      unlock: () => {},
      refreshCredentialState: async () => {},
      noteInteraction: () => {},
    };
    expect(resolveAppLockContext(fakeApi)).toBe(fakeApi);
  });
});

/**
 * 15-07 (SEC-04): no react-native-testing-library in this repo, so the
 * PROVIDER's actual wiring (does mounting `AppLockProvider` really end up
 * calling `lock('background')`/`lock('idle')`?) is proven at the source
 * level, the same way `SignatureBlock.test.tsx`'s "source assertions" suite
 * already does for that file. Combined with `useAppStateLock.test.ts`'s and
 * `useIdleTimer.test.ts`'s own exhaustive unit tests (which already prove
 * `attachAppStateLock`/`attachIdleTimer` call `lock('background')`/
 * `lock('idle')` given ANY `lock` callback), this closes the loop: the
 * provider passes its real `lock` function — not a no-op, not `unlock` —
 * into both hooks.
 */
describe('auto-lock timer wiring (15-07, D-05/D-06/D-07/D-08)', () => {
  async function readProviderSource(): Promise<string> {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./AppLockProvider.tsx', import.meta.url));
    return readFileSync(sourcePath, 'utf-8');
  }

  it("calls useAppStateLock(lock) so a background transition results in lock('background') (D-05)", async () => {
    expect(await readProviderSource()).toMatch(/useAppStateLock\(lock\)/);
  });

  it("calls useIdleTimer(lock) so an elapsed idle deadline results in lock('idle') (D-07/D-08)", async () => {
    expect(await readProviderSource()).toMatch(/useIdleTimer\(lock\)/);
  });

  it('never preserves in-flight screen state on lock (D-06) — no draft-preservation hook exists in this provider', async () => {
    const source = await readProviderSource();
    expect(source).not.toMatch(/preserveDraft|saveDraft|draftSignature|persistStroke/i);
  });
});
