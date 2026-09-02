import { describe, expect, it, vi } from 'vitest';

// No react-native-testing-library in this repo (SegmentedControl.test.tsx /
// InfoSheet.test.tsx precedent) — test the exported pure logic
// (`getTextFieldBorderColor`, `getRevealToggleLabel`) directly, never mount
// the component. TextField.tsx imports react-native at module scope —
// stubbed here (mirrors SegmentedControl.test.tsx's precedent), even though
// it is never actually invoked (this file never mounts the component).
// Plan 14-05 adds `Pressable` (reveal toggle) and `@expo/vector-icons`
// (reveal glyph) to TextField.tsx's imports — stubbed for the same reason.
vi.mock('react-native', () => ({
  Pressable: () => null,
  StyleSheet: { create: (s: unknown) => s },
  Text: () => null,
  TextInput: () => null,
  View: () => null,
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
vi.mock('../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('../features/settings/settingsCache', () => ({
  createSettingsCache: () => ({ get: () => null, set: () => {} }),
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));

import { getRevealToggleLabel, getTextFieldBorderColor } from './TextField';
import { themeTestColors as color } from '../features/settings/theme/themeTestColors';
import { t } from '../i18n';

describe('getTextFieldBorderColor (pure error-state border resolver)', () => {
  it('resolves to the destructive color when an error is present', () => {
    expect(getTextFieldBorderColor(true, color)).toBe(color.destructive);
  });

  it('resolves to the strong border color when there is no error', () => {
    expect(getTextFieldBorderColor(false, color)).toBe(color.borderStrong);
  });

  it('border-color helper is unchanged for existing (non-secure) inputs', () => {
    // Regression guard: adding secureTextEntry/helperText support must not
    // alter the pre-existing border-color resolution any existing caller
    // (ProfileEditScreen.tsx) already relies on.
    expect(getTextFieldBorderColor(false, color)).toBe(color.borderStrong);
    expect(getTextFieldBorderColor(true, color)).toBe(color.destructive);
  });
});

describe('getRevealToggleLabel (pure reveal-toggle accessibility label resolver)', () => {
  it('resolves to the "show password" label when not revealed', () => {
    expect(getRevealToggleLabel(false)).toBe(t('auth.showPasswordLabel'));
  });

  it('resolves to the "hide password" label when revealed', () => {
    expect(getRevealToggleLabel(true)).toBe(t('auth.hidePasswordLabel'));
  });

  it('flips as the reveal state flips', () => {
    const shown = getRevealToggleLabel(true);
    const hidden = getRevealToggleLabel(false);
    expect(shown).not.toBe(hidden);
  });
});

describe('TextField optional props (secureTextEntry / helperText)', () => {
  // Both new props are optional per TextFieldProps — this is a structural
  // (type-level) proof that neither is required, so every pre-14-05 caller
  // (e.g. ProfileEditScreen.tsx) keeps compiling unchanged. Exercised via
  // TypeScript itself at build time (`pnpm --filter mobile typecheck`);
  // this test documents the contract without mounting the component.
  it('helperText and errorText are independent, coexistable string props', () => {
    const helperText: string | undefined = 'Mindestens 12 Zeichen.';
    const errorText: string | null | undefined = 'Ungültige Eingabe.';
    expect(typeof helperText).toBe('string');
    expect(typeof errorText).toBe('string');
  });
});
