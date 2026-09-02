import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

/**
 * This repo has no react-native-testing-library (AppLockGate.test.tsx/
 * SessionsScreen.tsx precedent), so `LocalWipeScreen`'s behavior is proven
 * through its exported pure orchestration functions
 * (`deriveInitialWipePhase`/`shouldAutoStartPurge`), the REAL
 * `runDrainThenPurge`/`readWipeReadiness` (against an injected `WipeDeps`
 * double, same shape as `wipeMachinery.test.ts`) for the async
 * never-before-resolve ordering claims, and source-level scans for the
 * static structural claims (style-object color usage, "no Alert.alert").
 */

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  ActivityIndicator: () => null,
  Modal: () => null,
  Pressable: () => null,
  StyleSheet: { create: (styles: unknown) => styles },
  Text: () => null,
  View: () => null,
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
vi.mock('expo-file-system', () => ({
  File: vi.fn(),
  Directory: vi.fn(),
  Paths: { document: 'file:///fake/documents' },
}));
vi.mock('../../../lib/db/powersync', () => ({ openDatabase: vi.fn(), closeDatabase: vi.fn() }));
vi.mock('../../../lib/db/dbFilePaths', () => ({
  DB_PATH_VERIFIED: true,
  resolveDatabaseFilePathsDefault: vi.fn(() => ({
    directoryUri: '/fake',
    mainUri: '/fake/frontdoorsales.sqlite',
    walUri: '/fake/frontdoorsales.sqlite-wal',
    shmUri: '/fake/frontdoorsales.sqlite-shm',
  })),
}));
vi.mock('../../../lib/db/encryption', () => ({ regenerateEncryptionKey: vi.fn(async () => 'fake-key') }));
vi.mock('../../../lib/auth/supabase', () => ({ getSupabase: vi.fn(() => ({ auth: { signOut: vi.fn() } })) }));
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));
vi.mock('../../../app/useSessionDb', () => ({ useSessionDb: () => ({ db: null, userId: null, ready: false }) }));
vi.mock('../../settings/settingsCache', () => ({ createSettingsCache: () => ({ get: () => null, set: () => {} }) }));
vi.mock('react-native-mmkv', () => ({
  createMMKV: vi.fn(() => {
    throw new Error('MMKV native module must never be constructed in unit tests');
  }),
}));

import { runDrainThenPurge, type WipeDeps, type WipePhase } from './wipeMachinery';
import { deriveInitialWipePhase, shouldAutoStartPurge } from './LocalWipeScreen';

const SCREEN_FILE = fileURLToPath(new URL('./LocalWipeScreen.tsx', import.meta.url));
const source = readFileSync(SCREEN_FILE, 'utf-8');

function makeDeps(overrides: Partial<WipeDeps> = {}): { deps: WipeDeps; phases: WipePhase[] } {
  const phases: WipePhase[] = [];
  const deps: WipeDeps = {
    getUploadQueueStats: vi.fn(async () => ({ count: 0, size: null })),
    disconnectAndClear: vi.fn(async () => undefined),
    closeDatabase: vi.fn(async () => undefined),
    deleteFile: vi.fn(async () => undefined),
    regenerateEncryptionKey: vi.fn(async () => undefined),
    clearAttachmentStore: vi.fn(async () => undefined),
    filePaths: { mainUri: 'main', walUri: 'wal', shmUri: 'shm' },
    dbPathVerified: true,
    onPhase: (phase) => phases.push(phase),
    ...overrides,
  };
  return { deps, phases };
}

describe('deriveInitialWipePhase (pure)', () => {
  it('returns blocked-unverified-path when dbPathVerified is false, regardless of readiness', () => {
    expect(deriveInitialWipePhase(false, { kind: 'ready' })).toEqual({ kind: 'blocked-unverified-path' });
    expect(deriveInitialWipePhase(false, { kind: 'blocked', pendingCount: 5 })).toEqual({
      kind: 'blocked-unverified-path',
    });
  });

  it('passes the readiness phase through unchanged when dbPathVerified is true', () => {
    expect(deriveInitialWipePhase(true, { kind: 'ready' })).toEqual({ kind: 'ready' });
    expect(deriveInitialWipePhase(true, { kind: 'blocked', pendingCount: 3 })).toEqual({
      kind: 'blocked',
      pendingCount: 3,
    });
  });
});

describe('shouldAutoStartPurge (pure, D-04: pin-lockout skips confirm)', () => {
  it('true only when skipConfirm is set AND the phase is ready', () => {
    expect(shouldAutoStartPurge({ kind: 'ready' }, true)).toBe(true);
    expect(shouldAutoStartPurge({ kind: 'ready' }, false)).toBe(false);
    expect(shouldAutoStartPurge({ kind: 'blocked', pendingCount: 1 }, true)).toBe(false);
    expect(shouldAutoStartPurge({ kind: 'blocked-unverified-path' }, true)).toBe(false);
  });
});

describe('sec.wipeBlockedBody interpolates the REAL pending count (D-02)', () => {
  it('the blocked branch replaces {{n}} with phase.pendingCount, never a generic message', () => {
    // Source-level proof: the blocked branch's body text is built from
    // `t('sec.wipeBlockedBody').replace('{{n}}', String(phase.pendingCount))`
    // — never a hardcoded/static string.
    expect(source).toMatch(/t\('sec\.wipeBlockedBody'\)\.replace\('\{\{n\}\}',\s*String\(phase\.pendingCount\)\)/);
  });
});

describe('LocalWipeScreen structural contract (source-level, AppLockGate.test.tsx precedent)', () => {
  it('never uses a platform Alert.alert for confirmation', () => {
    expect(source).not.toMatch(/Alert\.alert/);
  });

  it('never calls useNavigation() itself — AppLockGate mounts this component OUTSIDE NavigationContainer', () => {
    // dismiss/back is threaded through the onDismiss PROP instead (see header
    // comment) — a useNavigation() call here would throw the instant the
    // pin-lockout entry point (AppLockGate.tsx) rendered it.
    const importLines = source
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line))
      .join('\n');
    expect(importLines).not.toMatch(/@react-navigation\/native/);
  });

  it('the header back button is suppressed when onDismiss is left at its default (pin-lockout entry, nothing to go back to)', () => {
    expect(source).toMatch(/onDismiss !== NOOP/);
  });

  /**
   * Two mounts, OPPOSITE inset requirements — the reason `embeddedInPaddedContainer`
   * is a prop rather than a deleted line. Removing the inset unconditionally
   * would fix AppLockGate and break the navigator route, where the back
   * chevron would land under the clock.
   */
  it('applies the safe-area inset only when the mount did not already — never unconditionally, never never', () => {
    expect(source).toMatch(/\(embeddedInPaddedContainer \? 0 : insets\.top\) \+ spacing\.lg/);
    expect(source).toMatch(/\(embeddedInPaddedContainer \? 0 : insets\.bottom\) \+ spacing\.lg/);
    // The inset must still be READ — a screen that stopped calling the hook
    // would silently break the navigator-level mount.
    expect(source).toMatch(/useSafeAreaInsets\(\)/);
  });

  it("ProfilStack's navigator route does NOT pass embeddedInPaddedContainer — nothing above it pads the inset, so the screen's own inset is correct there", () => {
    const profilStack = readFileSync(
      fileURLToPath(new URL('../../../app/tabs/ProfilStack.tsx', import.meta.url)),
      'utf-8',
    );
    const jsxLine = profilStack.split('\n').find((line) => line.includes('<LocalWipeScreen'));
    expect(jsxLine).toBeDefined();
    expect(jsxLine).not.toMatch(/embeddedInPaddedContainer/);
  });

  it('the blocked/blocked-unverified-path shared block uses neither colors.accent nor colors.destructive', () => {
    const blockStart = source.indexOf('blockedBlock:');
    const blockEnd = source.indexOf('progressBlock:');
    const blockedStyles = source.slice(blockStart, blockEnd);
    expect(blockedStyles).not.toMatch(/colors\.accent/);
    expect(blockedStyles).not.toMatch(/colors\.destructive/);
  });

  it('BlockedBlock renders exactly one dismiss Pressable', () => {
    const fnStart = source.indexOf('function BlockedBlock');
    const fnEnd = source.indexOf('\nfunction ProgressBlock');
    const body = source.slice(fnStart, fnEnd);
    const pressableCount = (body.match(/<Pressable/g) ?? []).length;
    expect(pressableCount).toBe(1);
    expect(body).toMatch(/sec\.wipeBlockedDismiss/);
  });

  it('ConfirmBlock uses sec.wipeConfirmCta and offers an explicit Cancel action', () => {
    const fnStart = source.indexOf('function ConfirmBlock');
    const fnEnd = source.indexOf('\nfunction makeStyles');
    const body = source.slice(fnStart, fnEnd);
    expect(body).toMatch(/sec\.wipeConfirmCta/);
    expect(body).toMatch(/cta\.cancel/);
  });

  it('the blocked-unverified-path branch renders sec.wipeUnverifiedPath, distinct from the failed branch', () => {
    const uvIndex = source.indexOf("phase.kind === 'blocked-unverified-path'");
    const failedIndexHeader = source.indexOf(': (\n          <View style={styles.failedBlock}>');
    expect(uvIndex).toBeGreaterThan(-1);
    expect(failedIndexHeader).toBeGreaterThan(-1);
    const uvBranch = source.slice(uvIndex, failedIndexHeader);
    expect(uvBranch).toMatch(/sec\.wipeUnverifiedPath/);
    // The failed branch renders phase.message, never sec.wipeUnverifiedPath.
    const failedBranch = source.slice(failedIndexHeader);
    expect(failedBranch).not.toMatch(/sec\.wipeUnverifiedPath/);
    expect(failedBranch).toMatch(/phase\.message/);
  });

  it('the blocked-unverified-path branch renders ONLY the shared BlockedBlock (no second/retry control)', () => {
    const uvIndex = source.indexOf("phase.kind === 'blocked-unverified-path'");
    const nextBranch = source.indexOf(': phase.kind', uvIndex);
    const uvBranch = source.slice(uvIndex, nextBranch);
    // Exactly one JSX element is rendered for this branch: <BlockedBlock ... />.
    expect((uvBranch.match(/</g) ?? []).length).toBe(1);
    expect(uvBranch).toMatch(/<BlockedBlock/);
  });
});

describe('complete is never entered before the purge promise resolves (D-02, via the real runDrainThenPurge)', () => {
  it('onPhase sees purging strictly before complete, and complete only after every step resolved', async () => {
    let resolveDisconnect: () => void = () => undefined;
    const disconnectGate = new Promise<void>((resolve) => {
      resolveDisconnect = resolve;
    });

    const { deps, phases } = makeDeps({
      disconnectAndClear: vi.fn(async () => {
        await disconnectGate;
      }),
    });

    const purgePromise = runDrainThenPurge('local', deps);

    // Flush microtasks (dbPathVerified check, readWipeReadiness's await,
    // then the 'purging' onPhase call) WITHOUT resolving disconnectGate —
    // only 'purging' must be observed; 'complete' must not appear yet.
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }
    expect(phases.map((p) => p.kind)).toEqual(['purging']);

    resolveDisconnect();
    const finalPhase = await purgePromise;

    expect(finalPhase).toEqual({ kind: 'complete' });
    expect(phases.map((p) => p.kind)).toEqual(['purging', 'complete']);
  });
});

describe('a failed phase never transitions to complete', () => {
  it('a mainUri deletion failure ends in failed, and onPhase never emits complete afterward', async () => {
    const { deps, phases } = makeDeps({
      deleteFile: vi.fn(async (uri: string) => {
        if (uri === 'main') throw new Error('boom');
      }),
    });

    const result = await runDrainThenPurge('local', deps);

    expect(result.kind).toBe('failed');
    expect(phases.map((p) => p.kind)).not.toContain('complete');
  });
});

describe('blocked-unverified-path never transitions to complete', () => {
  it('dbPathVerified: false ends the flow immediately, onPhase never emits complete', async () => {
    const { deps, phases } = makeDeps({ dbPathVerified: false });

    const result = await runDrainThenPurge('local', deps);

    expect(result).toEqual({ kind: 'blocked-unverified-path' });
    expect(phases.map((p) => p.kind)).toEqual(['blocked-unverified-path']);
  });
});
