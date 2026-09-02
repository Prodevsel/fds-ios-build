import { describe, expect, it, vi } from 'vitest';

// Node test environment (vitest.config.ts): never load native Expo/RN modules —
// mock every native import LoginScreen.tsx transitively pulls in, mirroring
// MapScreen.test.tsx. This exercises the pure classifyAuthError helper only.
vi.mock('react-native', () => ({
  KeyboardAvoidingView: () => null,
  Platform: { OS: 'ios' },
  Pressable: () => null,
  ScrollView: () => null,
  StyleSheet: { create: (styles: unknown) => styles },
  Text: () => null,
  TextInput: () => null,
  View: () => null,
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
// Plan 14-06: LoginScreen.tsx now navigates to ForgotPassword via
// useNavigation() (replacing the old local reset-hint state) — mocked here
// for the same reason as every other native/context dep above.
vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
}));
vi.mock('../../ui/Button', () => ({ Button: () => null }));
vi.mock('../../lib/auth/supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('./FdsLogo', () => ({ FdsLogo: () => null }));
// LoginScreen.tsx calls useThemeColors() directly (12-09) -> ThemeProvider/
// AccessibilityProvider's own native deps — mocked here too
// (AccessibilityProvider.test.tsx / 12-08's WalletScreen.test.tsx precedent).
vi.mock('../../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('../settings/settingsCache', () => ({
  createSettingsCache: () => ({ get: () => null, set: () => {} }),
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));

import { classifyAuthError } from './LoginScreen';

/**
 * The error supabase-js ACTUALLY throws when a fetch rejects, reproduced by
 * value rather than approximated: `@supabase/auth-js/dist/module/lib/fetch.js`
 * does `throw new AuthRetryableFetchError(_getErrorMessage(error), 0)`, and
 * `AuthRetryableFetchError extends CustomAuthError` sets `name` and `status`
 * (`.../lib/errors.js`). `status` is 0 — NOT undefined. Hand-building a bare
 * `{ message }` (as this test originally did) is what let 14-REVIEW CR-03 ship:
 * it passed against a predicate the real library shape could never satisfy.
 */
function authRetryableFetchError(message: string, status = 0) {
  const error = new Error(message) as Error & {
    name: string;
    status: number;
    code: string | undefined;
    __isAuthError: boolean;
  };
  error.name = 'AuthRetryableFetchError';
  error.status = status;
  error.code = undefined;
  error.__isAuthError = true;
  return error;
}

describe('classifyAuthError', () => {
  it('maps the real AuthRetryableFetchError (status 0) a dropped connection produces to "offline"', () => {
    expect(classifyAuthError(authRetryableFetchError('Network request failed'))).toBe('offline');
    expect(classifyAuthError(authRetryableFetchError('TypeError: Failed to fetch'))).toBe('offline');
  });

  it('maps a transport failure with an unrecognised message to "offline" on the error name alone', () => {
    // React Native, Node's undici and browsers all word this differently — the
    // classification must not depend on matching the wording.
    expect(classifyAuthError(authRetryableFetchError('Load failed'))).toBe('offline');
  });

  it('still maps a bare network/fetch message with no status at all to "offline"', () => {
    expect(classifyAuthError({ message: 'Network request failed' })).toBe('offline');
    expect(classifyAuthError({ message: 'TypeError: Failed to fetch' })).toBe('offline');
  });

  it('maps a credential rejection (HTTP status present) to "invalid"', () => {
    expect(classifyAuthError({ message: 'Invalid login credentials', status: 400 })).toBe('invalid');
  });

  it('maps a 5xx response to "invalid", never "offline" (D-20: a response that arrived must not change the copy)', () => {
    // auth-js raises AuthRetryableFetchError for 500-530 too. Treating those as
    // "offline" would make the known 14-04 hook-failure oracle (500 for a known
    // address, 200 for an unknown one) readable straight off the reset-request
    // screen.
    expect(classifyAuthError(authRetryableFetchError('Internal Server Error', 500))).toBe('invalid');
    expect(classifyAuthError(authRetryableFetchError('Service Unavailable', 503))).toBe('invalid');
  });

  it('defaults an unclassifiable error to "invalid"', () => {
    expect(classifyAuthError({})).toBe('invalid');
    expect(classifyAuthError({ message: 'something else' })).toBe('invalid');
  });
});
