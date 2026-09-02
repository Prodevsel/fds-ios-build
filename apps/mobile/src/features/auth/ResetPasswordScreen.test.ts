import { describe, expect, it, vi } from 'vitest';

// No react-native-testing-library in this repo — test the exported pure
// functions directly, never mount the component. ResetPasswordScreen.tsx
// imports react-native (+ its transitive chain: TextField/Button/
// useThemeColors/LoginScreen) at module scope — stub the native/DI leaves
// (mirrors TextField.test.tsx's precedent), even though none of it is ever
// actually invoked here.
vi.mock('react-native', () => ({
  KeyboardAvoidingView: () => null,
  Platform: { OS: 'ios' },
  Pressable: () => null,
  ScrollView: () => null,
  StyleSheet: { create: (s: unknown) => s },
  Text: () => null,
  TextInput: () => null,
  View: () => null,
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: vi.fn(), navigate: vi.fn() }),
}));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
vi.mock('../../lib/auth/supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('../../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('../settings/settingsCache', () => ({
  createSettingsCache: () => ({ get: () => null, set: () => {} }),
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));

import {
  derivePasswordHint,
  deriveResetPasswordViewState,
  performPasswordUpdate,
  PASSWORD_MIN_LENGTH,
  type UpdatePasswordResult,
} from './ResetPasswordScreen';

describe('derivePasswordHint (D-10 always-visible requirement hint)', () => {
  it('is the requirement hint at zero characters, before any typing (visible before submission)', () => {
    expect(derivePasswordHint('', false)).toEqual({ key: 'auth.passwordRequirementHint' });
    expect(derivePasswordHint('', true)).toEqual({ key: 'auth.passwordTooShortHint', count: PASSWORD_MIN_LENGTH });
  });

  it('is the countdown key with the correct remaining count while focused and under 12 characters', () => {
    expect(derivePasswordHint('abcde', true)).toEqual({ key: 'auth.passwordTooShortHint', count: 7 });
    expect(derivePasswordHint('a'.repeat(11), true)).toEqual({ key: 'auth.passwordTooShortHint', count: 1 });
  });

  it('reverts to the requirement hint once 12+ characters are typed, even while focused', () => {
    expect(derivePasswordHint('a'.repeat(12), true)).toEqual({ key: 'auth.passwordRequirementHint' });
    expect(derivePasswordHint('a'.repeat(20), true)).toEqual({ key: 'auth.passwordRequirementHint' });
  });

  it('reverts to the requirement hint on blur regardless of length', () => {
    expect(derivePasswordHint('abc', false)).toEqual({ key: 'auth.passwordRequirementHint' });
  });
});

describe('deriveResetPasswordViewState', () => {
  it('is loading before the session check resolves', () => {
    expect(deriveResetPasswordViewState(false, false)).toBe('loading');
    expect(deriveResetPasswordViewState(false, true)).toBe('loading');
  });

  it('is form once checked and a session exists', () => {
    expect(deriveResetPasswordViewState(true, true)).toBe('form');
  });

  it('is expired once checked and no session exists (stale/invalid recovery)', () => {
    expect(deriveResetPasswordViewState(true, false)).toBe('expired');
  });
});

describe('performPasswordUpdate', () => {
  const password = 'correct-horse-battery-staple';

  it('resolves success when updateUser succeeds', async () => {
    const updateUser = vi.fn(async () => ({ data: {}, error: null }));
    const result = await performPasswordUpdate({ auth: { updateUser }, password });
    expect(result satisfies UpdatePasswordResult).toEqual({ kind: 'success' });
    expect(updateUser).toHaveBeenCalledWith({ password });
  });

  it('resolves rejected (not a bare "invalid password") on a server rejection', async () => {
    const updateUser = vi.fn(async () => ({
      data: null,
      error: { message: 'Password does not meet requirements', status: 422 },
    }));
    const result = await performPasswordUpdate({ auth: { updateUser }, password });
    expect(result).toEqual({ kind: 'rejected' });
  });

  it('resolves offline for a genuine network failure — distinguished from rejected', async () => {
    const updateUser = vi.fn(async () => ({
      data: null,
      error: { message: 'Network request failed', status: undefined },
    }));
    const result = await performPasswordUpdate({ auth: { updateUser }, password });
    expect(result).toEqual({ kind: 'offline' });
  });

  it('resolves offline when updateUser throws', async () => {
    const updateUser = vi.fn(async () => {
      throw new Error('Failed to fetch');
    });
    const result = await performPasswordUpdate({ auth: { updateUser }, password });
    expect(result).toEqual({ kind: 'offline' });
  });
});
