import { describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

/**
 * This repo has no react-native-testing-library, so `AppLockGate`'s behavior
 * is tested through its exported pure orchestration functions
 * (`handlePinSubmit`/`handleBiometricOutcome`/`deriveWipeWarningCount`) plus
 * a source-level scan of its own import statements — mirrors
 * `PinKeypad.test.tsx`'s and `useLeaderboard.test.ts`'s precedents. This
 * file never mounts the component, so every native/transitive import
 * `AppLockGate.tsx` pulls in at module scope is stubbed here purely so the
 * module can be imported for its pure exports (`EinstellungenScreen.test.tsx`
 * precedent for importing a heavy screen module this way).
 */
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Pressable: () => null,
  StyleSheet: { create: (styles: unknown) => styles },
  Text: () => null,
  View: () => null,
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
vi.mock('expo-local-authentication', () => ({
  hasHardwareAsync: vi.fn(),
  isEnrolledAsync: vi.fn(),
  supportedAuthenticationTypesAsync: vi.fn(),
  authenticateAsync: vi.fn(),
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
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
}));
vi.mock('../../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('../settings/settingsCache', () => ({
  createSettingsCache: () => ({ get: () => null, set: () => {} }),
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));
vi.mock('../../lib/auth/supabase', () => ({ getSupabase: vi.fn(() => ({ auth: { signOut: vi.fn() } })) }));
vi.mock('react-native-mmkv', () => ({
  createMMKV: vi.fn(() => {
    throw new Error('MMKV native module must never be constructed in unit tests');
  }),
}));
// 15-10 addition: AppLockGate.tsx now renders `LocalWipeScreen` (D-04) for
// `gateState.kind === 'wipe'`, which transitively imports `wipeMachinery.ts`
// — mock its native dependencies the same way `wipeMachinery.test.ts` does.
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
// 15-11: AppLockGate.tsx -> AppLockProvider.tsx now also imports
// remoteWipeConnector.ts, which imports lib/device/getDeviceId.ts
// (expo-application, native at module scope).
vi.mock('expo-application', () => ({
  getAndroidId: vi.fn(() => 'fake-android-id'),
  getIosIdForVendorAsync: vi.fn(async () => 'fake-idfv'),
}));

import { CLEARED_ATTEMPT_STATE, recordFailure, type AttemptState } from './pin/pinAttempts';
import {
  deriveRemoteWipeSurfaceCopy,
  deriveWipeWarningCount,
  handleBiometricOutcome,
  handlePinSubmit,
} from './AppLockGate';
import { runDrainThenPurge, type WipeDeps, type WipePhase } from './wipe/wipeMachinery';

const GATE_FILE = fileURLToPath(new URL('./AppLockGate.tsx', import.meta.url));

describe('AppLockGate.tsx source (T-15-06-01: leaks nothing about customer/contract data)', () => {
  const source = readFileSync(GATE_FILE, 'utf-8');
  const importLines = source
    .split('\n')
    .filter((line) => /^\s*import\b/.test(line))
    .join('\n');

  it('imports nothing from features/checkout', () => {
    expect(importLines).not.toMatch(/features\/checkout/);
  });

  it('imports nothing from features/map', () => {
    expect(importLines).not.toMatch(/features\/map/);
  });

  it('imports nothing from features/wallet', () => {
    expect(importLines).not.toMatch(/features\/wallet/);
  });

  it('imports nothing from features/termine', () => {
    expect(importLines).not.toMatch(/features\/termine/);
  });

  it('the wipe-warning banner has no dismiss control (T-15-06-07: never dismissible)', () => {
    expect(source.toLowerCase()).not.toMatch(/dismiss/);
  });
});

describe('remote-wipe-pending surface (15-11, D-01/D-02, T-15-11-02)', () => {
  const source = readFileSync(GATE_FILE, 'utf-8');

  it('renders no biometric CTA and no PinKeypad when lockReason === remote-wipe — the isRemoteWipeLocked branch short-circuits before either can render', () => {
    const branchStart = source.indexOf('isRemoteWipeLocked ? (');
    const branchEnd = source.indexOf(') : gateState.kind', branchStart);
    const branch = source.slice(branchStart, branchEnd);
    expect(branch).not.toMatch(/PinKeypad/);
    expect(branch).not.toMatch(/biometricCta/);
  });

  it('is checked BEFORE gateState.kind === \'wipe\' — remote-wipe is the more severe, unconditional lock', () => {
    expect(source.indexOf('isRemoteWipeLocked ? (')).toBeLessThan(source.indexOf("gateState.kind === 'wipe' ? ("));
  });

  it('interpolates the real pending count into sec.wipeBlockedBody, never a hardcoded/fabricated value', () => {
    expect(source).toMatch(/t\('sec\.wipeBlockedBody'\)\.replace\('\{\{n\}\}', String\(remoteWipePendingCount\)\)/);
  });

  it('offers no acknowledge/retry/proceed-anyway action anywhere in this file', () => {
    const lower = source.toLowerCase();
    expect(lower).not.toMatch(/dismiss/);
    expect(lower).not.toMatch(/\bretry\b/);
    expect(lower).not.toMatch(/proceed anyway|continue anyway/);
  });

  it('reads the queue depth via the shared wipeMachinery getUploadQueueStats — never a parallel counter', () => {
    expect(source).toMatch(/createDefaultWipeDeps\(\)\.getUploadQueueStats\(\)/);
  });
});

describe('deriveRemoteWipeSurfaceCopy (D-02: null/0 render progress copy, never a fabricated blocked count)', () => {
  it('is sec.wipeInProgress when the count is unknown (null)', () => {
    expect(deriveRemoteWipeSurfaceCopy(null)).toBe('sec.wipeInProgress');
  });

  it('is sec.wipeInProgress when the queue has genuinely drained to zero', () => {
    expect(deriveRemoteWipeSurfaceCopy(0)).toBe('sec.wipeInProgress');
  });

  it('is sec.wipeBlockedBody for any positive count', () => {
    expect(deriveRemoteWipeSurfaceCopy(5)).toBe('sec.wipeBlockedBody');
  });
});

describe('handlePinSubmit', () => {
  it('a correct PIN clears the attempt counter and unlocks', async () => {
    const midFailure: AttemptState = { failedAttempts: 3, backoffUntilEpochMs: null };
    const result = await handlePinSubmit('123456', midFailure, async () => true, 1000);
    expect(result).toEqual({ nextAttemptState: CLEARED_ATTEMPT_STATE, outcome: 'unlocked' });
  });

  it('a wrong PIN advances the counter via recordFailure and does not unlock', async () => {
    const result = await handlePinSubmit('000000', CLEARED_ATTEMPT_STATE, async () => false, 1000);
    expect(result.outcome).toBe('incorrect');
    expect(result.nextAttemptState).toEqual(recordFailure(CLEARED_ATTEMPT_STATE, 1000));
    expect(result.nextAttemptState.failedAttempts).toBe(1);
  });
});

describe('handleBiometricOutcome (D-10: biometric failure is not a wrong PIN)', () => {
  const midFailure: AttemptState = { failedAttempts: 4, backoffUntilEpochMs: null };

  it('a biometric success clears the attempt counter and unlocks', () => {
    const result = handleBiometricOutcome({ kind: 'success' }, midFailure);
    expect(result).toEqual({ nextAttemptState: CLEARED_ATTEMPT_STATE, outcome: 'unlocked' });
  });

  it('an unavailable outcome does NOT advance the attempt counter', () => {
    const result = handleBiometricOutcome({ kind: 'unavailable', reason: 'not_enrolled' }, midFailure);
    expect(result).toEqual({ nextAttemptState: midFailure, outcome: 'fallback' });
  });

  it('a failed outcome does NOT advance the attempt counter', () => {
    const result = handleBiometricOutcome({ kind: 'failed', reason: 'sensor_error' }, midFailure);
    expect(result).toEqual({ nextAttemptState: midFailure, outcome: 'fallback' });
    expect(result.nextAttemptState.failedAttempts).toBe(4); // unchanged, never incremented
  });
});

describe('deriveWipeWarningCount (T-15-06-07: the mandatory pre-wipe warning)', () => {
  it('is null below attempt 8', () => {
    expect(deriveWipeWarningCount({ failedAttempts: 7, backoffUntilEpochMs: null })).toBeNull();
  });

  it('is 2 at exactly 8 failed attempts', () => {
    expect(deriveWipeWarningCount({ failedAttempts: 8, backoffUntilEpochMs: null })).toBe(2);
  });

  it('is 1 at exactly 9 failed attempts', () => {
    expect(deriveWipeWarningCount({ failedAttempts: 9, backoffUntilEpochMs: null })).toBe(1);
  });

  it('is null once the terminal wipe state is reached (attempt 10)', () => {
    expect(deriveWipeWarningCount({ failedAttempts: 10, backoffUntilEpochMs: null })).toBeNull();
  });
});

describe('AppLockGate.tsx wires the attempt-10 wipe branch to LocalWipeScreen (D-04, plan 15-10)', () => {
  const source = readFileSync(GATE_FILE, 'utf-8');

  it("renders LocalWipeScreen with entry='pin-lockout' and skipConfirm for gateState.kind === 'wipe' — the SAME component/machinery as the local wipe, never a second implementation", () => {
    const branchStart = source.indexOf("gateState.kind === 'wipe'");
    const branchEnd = source.indexOf(') : (', branchStart);
    const branch = source.slice(branchStart, branchEnd);
    expect(branch).toMatch(
      /<LocalWipeScreen\s+entry="pin-lockout"\s+skipConfirm\s+embeddedInPaddedContainer\s*\/>/,
    );
  });

  it('passes embeddedInPaddedContainer — this gate renders the wipe screen inside a ScrollView that already applied insets.top/bottom, so the screen must not apply them twice', () => {
    const jsxLine = source.split('\n').find((line) => line.includes('<LocalWipeScreen'));
    expect(jsxLine).toMatch(/embeddedInPaddedContainer/);
    // The container this claim rests on. If the ScrollView ever stops padding
    // the inset, the prop becomes a bug rather than a fix — fail here first.
    expect(source).toMatch(/paddingTop:\s*insets\.top\s*\+\s*spacing\.lg/);
    expect(source).toMatch(/paddingBottom:\s*insets\.bottom\s*\+\s*spacing\.lg/);
  });

  it('imports LocalWipeScreen from ./wipe/LocalWipeScreen — no second/parallel wipe component', () => {
    expect(source).toMatch(/import\s*\{\s*LocalWipeScreen\s*\}\s*from\s*'\.\/wipe\/LocalWipeScreen'/);
  });

  it('never passes an onDismiss to LocalWipeScreen here — this gate is mounted outside NavigationContainer and gateState wipe is terminal', () => {
    const jsxLine = source
      .split('\n')
      .find((line) => line.includes('<LocalWipeScreen'));
    expect(jsxLine).toBeDefined();
    expect(jsxLine).not.toMatch(/onDismiss/);
  });
});

/**
 * Direct proof of the three entry points at THIS call site (not only via
 * wipeMachinery.test.ts's cross-entry-point proof) — `entry='pin-lockout'`
 * is exactly what AppLockGate.tsx's rendered `<LocalWipeScreen>` drives
 * `runDrainThenPurge` with (proven above via source scan); these tests
 * exercise that exact entry point against the real machinery.
 */
function makeGateWipeDeps(overrides: Partial<WipeDeps> = {}): { deps: WipeDeps; phases: WipePhase[] } {
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

const GATE_DESTRUCTIVE_KEYS = [
  'disconnectAndClear',
  'closeDatabase',
  'deleteFile',
  'regenerateEncryptionKey',
  'clearAttachmentStore',
] as const;

describe("attempt 10 ('pin-lockout' entry) honors D-12/T-15-10-02: inherits D-01's drain-then-purge without exception", () => {
  it('a non-empty queue renders the blocked state and performs ZERO destructive calls', async () => {
    const { deps, phases } = makeGateWipeDeps({
      getUploadQueueStats: vi.fn(async () => ({ count: 4, size: null })),
    });

    const result = await runDrainThenPurge('pin-lockout', deps);

    expect(result).toEqual({ kind: 'blocked', pendingCount: 4 });
    expect(phases).toEqual([{ kind: 'blocked', pendingCount: 4 }]);
    for (const key of GATE_DESTRUCTIVE_KEYS) {
      expect(deps[key]).not.toHaveBeenCalled();
    }
  });

  it('an empty queue runs the purge to completion under the pin-lockout entry point', async () => {
    const { deps } = makeGateWipeDeps();

    const result = await runDrainThenPurge('pin-lockout', deps);

    expect(result).toEqual({ kind: 'complete' });
    expect(deps.disconnectAndClear).toHaveBeenCalledOnce();
    expect(deps.regenerateEncryptionKey).toHaveBeenCalledOnce();
  });

  it('dbPathVerified: false renders blocked-unverified-path and performs ZERO destructive calls', async () => {
    const { deps, phases } = makeGateWipeDeps({ dbPathVerified: false });

    const result = await runDrainThenPurge('pin-lockout', deps);

    expect(result).toEqual({ kind: 'blocked-unverified-path' });
    expect(phases).toEqual([{ kind: 'blocked-unverified-path' }]);
    for (const key of GATE_DESTRUCTIVE_KEYS) {
      expect(deps[key]).not.toHaveBeenCalled();
    }
  });
});
