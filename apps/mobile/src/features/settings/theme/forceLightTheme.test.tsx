import { describe, expect, it, vi } from 'vitest';

// Node test environment (vitest.config.ts): `useThemeColors.ts` pulls in
// `ThemeProvider.tsx` (react-native's `Appearance`, Flow-syntax source
// unparseable under vitest/node) and `AccessibilityProvider.tsx`
// transitively (-> useSessionDb.ts -> native PowerSync/op-sqlite,
// settingsCache.ts -> react-native-mmkv, expo-localization) — mock all three
// at the module boundary (mirrors `ThemeProvider.test.tsx` /
// `AccessibilityProvider.test.tsx`). No react-native-testing-library in this
// repo, so `ForceLightTheme`/`useIsForcedLight` are never rendered — their
// entire observable effect (SET-05: a component inside `ForceLightTheme`
// receives `lightColors` no matter what) is captured by the pure
// `resolveThemeColors` resolver, exercised directly here with
// `forceLight: true` standing in for "inside `ForceLightTheme`".
vi.mock('react-native', () => ({
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
vi.mock('../../../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('../settingsCache', () => ({
  createSettingsCache: () => ({ get: () => null, set: () => {} }),
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));

import { resolveThemeColors } from './useThemeColors';
import { darkColors, lightColors } from '../../../design/tokens';

describe('resolveThemeColors — the ForceLightTheme escape hatch (SET-05)', () => {
  it("receives lightColors when forceLight is true, even though the provider's resolved scheme is 'dark'", () => {
    expect(resolveThemeColors('dark', true, false)).toEqual(lightColors);
  });

  it('receives lightColors when forceLight is true, even with highContrast also true (both bypassed together)', () => {
    expect(resolveThemeColors('dark', true, true)).toEqual(lightColors);
  });

  it('receives lightColors when forceLight is true and resolvedScheme is already light (no-op case)', () => {
    expect(resolveThemeColors('light', true, false)).toEqual(lightColors);
  });

  it('receives getColors(scheme, highContrast) — NOT forced light — when forceLight is false', () => {
    expect(resolveThemeColors('dark', false, false)).toEqual(darkColors);
    expect(resolveThemeColors('dark', false, true).textPrimary).toBe('#FFFFFF');
    expect(resolveThemeColors('light', false, false)).toEqual(lightColors);
  });
});
