import { describe, expect, it, vi } from 'vitest';

// No react-native-testing-library in this repo — test the exported pure
// `performResetRequest` directly, never mount the component.
// ForgotPasswordScreen.tsx imports react-native (+ its own transitive chain:
// TextField/Button/useThemeColors/LoginScreen/useDeepLinkRecovery) at module
// scope — stub the native/DI leaves (mirrors TextField.test.tsx's precedent),
// even though none of it is ever actually invoked here.
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
  useRoute: () => ({ params: undefined }),
}));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
vi.mock('expo-linking', () => ({
  getInitialURL: vi.fn(async () => null),
  addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  parse: vi.fn(),
}));
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

import { performResetRequest, type ResetRequestResult } from './ForgotPasswordScreen';

describe('performResetRequest (D-20 enumeration-safe reset request)', () => {
  const redirectTo = 'frontdoorsales://reset-password';

  it('resolves confirmed for a success-shaped auth response', async () => {
    const resetPasswordForEmail = vi.fn(async () => ({ data: {}, error: null }));
    const result = await performResetRequest({
      auth: { resetPasswordForEmail },
      email: 'known@example.com',
      redirectTo,
    });
    expect(result satisfies ResetRequestResult).toEqual({ kind: 'confirmed' });
    expect(resetPasswordForEmail).toHaveBeenCalledWith('known@example.com', { redirectTo });
  });

  it('resolves confirmed IDENTICALLY for a "user not found"-shaped auth error (D-20 structural proof)', async () => {
    const resetPasswordForEmail = vi.fn(async () => ({
      data: null,
      error: { message: 'User not found', status: 400 },
    }));
    const result = await performResetRequest({
      auth: { resetPasswordForEmail },
      email: 'unknown@example.com',
      redirectTo,
    });
    expect(result).toEqual({ kind: 'confirmed' });
  });

  it('resolves offline for a genuine network failure — distinguished from confirmed', async () => {
    const resetPasswordForEmail = vi.fn(async () => ({
      data: null,
      error: { message: 'Network request failed', status: undefined },
    }));
    const result = await performResetRequest({
      auth: { resetPasswordForEmail },
      email: 'rep@example.com',
      redirectTo,
    });
    expect(result).toEqual({ kind: 'offline' });
  });

  it('resolves offline for the REAL AuthRetryableFetchError shape (status 0) — never a false "email sent"', async () => {
    // REGRESSION (14-REVIEW CR-03): supabase-js RETURNS this error rather than
    // throwing it, and it carries `status: 0`, not `undefined`. The old
    // predicate therefore classified it 'invalid', so a locked-out rep with no
    // connectivity was shown `auth.resetRequestConfirmation` ("a message has
    // been sent") for a request that never left the device.
    const error = new Error('Network request failed') as Error & { name: string; status: number };
    error.name = 'AuthRetryableFetchError';
    error.status = 0;
    const resetPasswordForEmail = vi.fn(async () => ({ data: null, error }));
    const result = await performResetRequest({
      auth: { resetPasswordForEmail },
      email: 'rep@example.com',
      redirectTo,
    });
    expect(result).toEqual({ kind: 'offline' });
  });

  it('resolves confirmed for a 5xx response (D-20: the 14-04 hook-failure oracle must not reach the copy)', async () => {
    const error = new Error('Internal Server Error') as Error & { name: string; status: number };
    error.name = 'AuthRetryableFetchError';
    error.status = 500;
    const resetPasswordForEmail = vi.fn(async () => ({ data: null, error }));
    const result = await performResetRequest({
      auth: { resetPasswordForEmail },
      email: 'known@example.com',
      redirectTo,
    });
    expect(result).toEqual({ kind: 'confirmed' });
  });

  it('resolves offline when resetPasswordForEmail throws (e.g. fetch rejection)', async () => {
    const resetPasswordForEmail = vi.fn(async () => {
      throw new Error('Failed to fetch');
    });
    const result = await performResetRequest({
      auth: { resetPasswordForEmail },
      email: 'rep@example.com',
      redirectTo,
    });
    expect(result).toEqual({ kind: 'offline' });
  });
});
