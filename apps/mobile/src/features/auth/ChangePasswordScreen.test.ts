import { describe, expect, it, vi } from 'vitest';

// No react-native-testing-library in this repo — test the exported pure/DI'd
// functions directly, never mount the component. Mirrors
// ResetPasswordScreen.test.ts's stub set exactly (same transitive chain:
// TextField/Button/useThemeColors/LoginScreen), even though none of it is
// ever actually invoked here.
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

import { derivePasswordHint, PASSWORD_MIN_LENGTH } from './ResetPasswordScreen';
import { performPasswordChange, type ChangePasswordResult } from './ChangePasswordScreen';

describe('ChangePasswordScreen imports derivePasswordHint rather than redefining it', () => {
  it('is on screen at first render, before any typing (D-10) — same reused function', () => {
    expect(derivePasswordHint('', false)).toEqual({ key: 'auth.passwordRequirementHint' });
  });

  it('shows the countdown hint with the right remaining count while focused and under 12 characters', () => {
    expect(derivePasswordHint('abcde', true)).toEqual({ key: 'auth.passwordTooShortHint', count: 7 });
    expect(derivePasswordHint('a'.repeat(PASSWORD_MIN_LENGTH - 1), true)).toEqual({
      key: 'auth.passwordTooShortHint',
      count: 1,
    });
  });
});

describe('performPasswordChange (D-15/WR-12 — nonce-gated re-authentication)', () => {
  const password = 'correct-horse-battery-staple';
  const nonce = '123456';
  const reauthenticate = vi.fn(async () => ({ error: null }));

  it('calls updateUser({ password, nonce }) exactly once and resolves ok on success', async () => {
    const updateUser = vi.fn(async () => ({ data: {}, error: null }));
    const result = await performPasswordChange({ auth: { reauthenticate, updateUser }, password, nonce });
    expect(result satisfies ChangePasswordResult).toEqual({ kind: 'ok' });
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledWith({ password, nonce });
  });

  it('resolves reauthRejected — distinct from policyRejected — when GoTrue rejects the nonce', async () => {
    const updateUser = vi.fn(async () => ({
      data: null,
      error: { message: 'Password update requires reauthentication', status: 400, code: 'reauthentication_needed' },
    }));
    const result = await performPasswordChange({ auth: { reauthenticate, updateUser }, password, nonce });
    expect(result).toEqual({ kind: 'reauthRejected' });
  });

  it('resolves reauthRejected for a wrong/invalid nonce (reauthentication_not_valid)', async () => {
    const updateUser = vi.fn(async () => ({
      data: null,
      error: { message: 'Nonce is invalid', status: 400, code: 'reauthentication_not_valid' },
    }));
    const result = await performPasswordChange({ auth: { reauthenticate, updateUser }, password, nonce });
    expect(result).toEqual({ kind: 'reauthRejected' });
  });

  it('resolves policyRejected — distinct from reauthRejected and networkError — on a server policy rejection', async () => {
    const updateUser = vi.fn(async () => ({
      data: null,
      error: { message: 'Password does not meet requirements', status: 422, code: 'weak_password' },
    }));
    const result = await performPasswordChange({ auth: { reauthenticate, updateUser }, password, nonce });
    expect(result).toEqual({ kind: 'policyRejected' });
  });

  it('resolves networkError — distinct from policyRejected — on a genuine offline failure', async () => {
    const updateUser = vi.fn(async () => ({
      data: null,
      error: { message: 'Network request failed', status: undefined },
    }));
    const result = await performPasswordChange({ auth: { reauthenticate, updateUser }, password, nonce });
    expect(result).toEqual({ kind: 'networkError' });
  });

  it('resolves networkError when updateUser throws', async () => {
    const updateUser = vi.fn(async () => {
      throw new Error('Failed to fetch');
    });
    const result = await performPasswordChange({ auth: { reauthenticate, updateUser }, password, nonce });
    expect(result).toEqual({ kind: 'networkError' });
  });
});

describe('source-contract: derivePasswordHint is imported, not redefined', () => {
  it('ChangePasswordScreen.tsx contains zero local `function derivePasswordHint` declarations', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.join(import.meta.dirname, 'ChangePasswordScreen.tsx'),
      'utf-8',
    );
    expect((source.match(/function derivePasswordHint/g) ?? []).length).toBe(0);
    expect(source).toContain("import { derivePasswordHint");
  });

  it('renders auth.passwordRejectedByServer on policy rejection, auth.currentPasswordRejected on nonce rejection, and settings.saveErrorGeneric on network failure — three distinct copy keys', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.join(import.meta.dirname, 'ChangePasswordScreen.tsx'),
      'utf-8',
    );
    expect(source).toContain('auth.passwordRejectedByServer');
    expect(source).toContain('auth.currentPasswordRejected');
    expect(source).toContain('settings.saveErrorGeneric');
  });

  it('the OTP re-authentication field is rendered ABOVE the new-password field', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.join(import.meta.dirname, 'ChangePasswordScreen.tsx'),
      'utf-8',
    );
    const otpIndex = source.indexOf("t('auth.currentPasswordLabel')");
    const newPasswordIndex = source.indexOf("t('auth.passwordLabel')");
    expect(otpIndex).toBeGreaterThan(-1);
    expect(newPasswordIndex).toBeGreaterThan(-1);
    expect(otpIndex).toBeLessThan(newPasswordIndex);
  });

  it('submit is disabled with an empty re-auth field even with a valid new password, and the disabled expression requires both', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.join(import.meta.dirname, 'ChangePasswordScreen.tsx'),
      'utf-8',
    );
    // canSubmit requires BOTH the OTP length AND the password floor — asserted
    // structurally since this repo has no react-native-testing-library to
    // mount the component and toggle field state directly.
    expect(source).toMatch(/canSubmit\s*=\s*otp\.length === OTP_LENGTH && password\.length >= PASSWORD_MIN_LENGTH/);
    expect(source).toContain('disabled={!canSubmit}');
  });

  it('T-14-08-02 is referenced only inside the closed-by note, never inside a surviving accepted-risk block', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.join(import.meta.dirname, 'ChangePasswordScreen.tsx'),
      'utf-8',
    );
    const matches = source.match(/T-14-08-02/g) ?? [];
    expect(matches.length).toBe(1);
    expect(source).toContain('closes T-14-08-02');
    expect(source).not.toMatch(/does NOT ask for the\s*\* current password/);
  });

  it('names the probe artifact that grounds the nonce-required design', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.join(import.meta.dirname, 'ChangePasswordScreen.tsx'),
      'utf-8',
    );
    expect(source).toContain('15-SECURE-PASSWORD-CHANGE-PROBE.md');
    expect(source).toContain('NONCE_REQUIRED');
  });
});
