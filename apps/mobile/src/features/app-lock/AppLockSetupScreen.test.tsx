import { describe, expect, it, vi } from 'vitest';

/**
 * This repo has no react-native-testing-library, so `AppLockSetupScreen`'s
 * behavior is tested through its exported pure orchestration functions
 * (`handleSetupPinComplete`/`shouldShowBiometricToggle`) — every
 * native/transitive import the module pulls in at module scope is stubbed
 * purely so it can be imported for those exports (`EinstellungenScreen.test.tsx`
 * precedent).
 */
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Pressable: () => null,
  ScrollView: () => null,
  StyleSheet: { create: (styles: unknown) => styles },
  Switch: () => null,
  Text: () => null,
  View: () => null,
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: vi.fn() }) }));
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
// 15-11: this screen imports AppLockProvider.tsx, which now also imports
// remoteWipeConnector.ts (-> wipeMachinery.ts, lib/auth/supabase.ts,
// lib/device/getDeviceId.ts — all native-module-touching at module scope) —
// mock the same module boundary AppLockGate.test.tsx already establishes.
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
vi.mock('expo-application', () => ({
  getAndroidId: vi.fn(() => 'fake-android-id'),
  getIosIdForVendorAsync: vi.fn(async () => 'fake-idfv'),
}));

import { handleSetupPinComplete, shouldShowBiometricToggle } from './AppLockSetupScreen';

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

describe('handleSetupPinComplete', () => {
  it('the "enter" step always advances to "confirm" and never writes anything', () => {
    const result = handleSetupPinComplete('enter', '123456', null);
    expect(result).toEqual({ kind: 'advance-to-confirm', firstPin: '123456' });
  });

  it('a matching confirm step is ready to create the credential', () => {
    const result = handleSetupPinComplete('confirm', '123456', '123456');
    expect(result).toEqual({ kind: 'ready-to-create', pin: '123456' });
  });

  it('a mismatched confirm step reports mismatch — never ready-to-create', () => {
    const result = handleSetupPinComplete('confirm', '654321', '123456');
    expect(result).toEqual({ kind: 'mismatch' });
  });
});

describe('shouldShowBiometricToggle', () => {
  it('is true only when both hardware AND enrollment are present', () => {
    expect(shouldShowBiometricToggle(true, true)).toBe(true);
  });

  it('is false (absent, not disabled) when hardware is missing', () => {
    expect(shouldShowBiometricToggle(false, true)).toBe(false);
  });

  it('is false (absent, not disabled) when nothing is enrolled', () => {
    expect(shouldShowBiometricToggle(true, false)).toBe(false);
  });

  it('is false when neither is present', () => {
    expect(shouldShowBiometricToggle(false, false)).toBe(false);
  });
});

describe('mismatch write discipline (T-15-06: a PIN/confirm mismatch writes nothing)', () => {
  it('handleSetupPinComplete never returns ready-to-create for a mismatch, so createPinCredential is never reachable from that branch', () => {
    const writes: string[] = [];
    const fakeCreate = (pin: string) => writes.push(pin);

    const enterResult = handleSetupPinComplete('enter', '111111', null);
    expect(enterResult.kind).not.toBe('ready-to-create');

    const mismatchResult = handleSetupPinComplete('confirm', '222222', '111111');
    if (mismatchResult.kind === 'ready-to-create') {
      fakeCreate(mismatchResult.pin);
    }
    expect(writes).toHaveLength(0);
  });
});
