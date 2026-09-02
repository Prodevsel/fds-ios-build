import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance, type ColorSchemeName } from 'react-native';
import { useSessionDb } from '../../../app/useSessionDb';
import type { ColorScheme } from '../../../design/tokens';
import { createSettingsCache } from '../settingsCache';
import { createSettingsRepo, type SettingsRepo, type Theme } from '../db/settingsRepo';
import { useSettings } from '../useSettings';

/**
 * The OS scheme value as it actually flows through RN's `Appearance` API —
 * `getColorScheme()` and the change-listener payload both admit `null`/
 * `undefined` in practice (unset OS preference), wider than the
 * `ColorSchemeName` ('light' | 'dark') type alone.
 */
type RNColorSchemeName = ColorSchemeName | null | undefined;

/**
 * ThemeProvider — resolves the rep's persisted `theme` preference
 * (`'system' | 'light' | 'dark'`, D-13) plus the OS `Appearance` API into a
 * single RESOLVED `'light' | 'dark'` scheme, exposed via context.
 * `'system'` follows `Appearance` live and flips without an app restart;
 * an explicit `'light'`/`'dark'` preference is pinned and never reacts to OS
 * changes. Screens NEVER call `Appearance` directly — only this provider
 * does (12-UI-SPEC.md § Theme resolution model; grepped for repo-wide, see
 * `ThemeProvider.test.tsx`).
 *
 * Second Context provider in `apps/mobile` after `AccessibilityProvider`
 * (12-05) — same "no in-repo analog" situation (12-PATTERNS.md § No Analog
 * Found), so this mirrors that provider's DI shape (own `useSessionDb`/
 * cache/repo instantiation) rather than reaching into
 * `AccessibilityProvider`'s internals. `useThemeColors()`
 * (`useThemeColors.ts`) composes this provider's resolved scheme with
 * `AccessibilityProvider`'s `useHighContrast()` — the two providers stay
 * independent and are composed only at the point of use.
 */

const ThemeSchemeContext = createContext<ColorScheme | undefined>(undefined);

/**
 * Pure: resolves the persisted `theme` preference + the current OS
 * appearance into the single RESOLVED scheme. An explicit `'light'`/`'dark'`
 * preference always wins over the OS value. A null/unknown OS scheme
 * (`Appearance.getColorScheme()` can return `null`) resolves to `'light'`.
 */
export function resolveColorScheme(preference: Theme, osScheme: RNColorSchemeName): ColorScheme {
  if (preference === 'light' || preference === 'dark') return preference;
  return osScheme === 'dark' ? 'dark' : 'light';
}

/** The minimal subset of `Appearance` this module depends on — injectable for tests. */
export interface AppearanceLike {
  getColorScheme(): RNColorSchemeName;
  addChangeListener(listener: (prefs: { colorScheme: RNColorSchemeName }) => void): { remove(): void };
}

/**
 * Pure/DI'd: subscribes to live OS appearance changes ONLY while the
 * preference is `'system'` — an explicit `'light'`/`'dark'` preference must
 * never react to an OS change. Returns an unsubscribe function; a no-op
 * (nothing to unsubscribe) when the preference is not `'system'`.
 */
export function subscribeToAppearance(
  preference: Theme,
  onChange: (scheme: ColorScheme) => void,
  appearance: AppearanceLike = Appearance,
): () => void {
  if (preference !== 'system') return () => {};
  const subscription = appearance.addChangeListener(({ colorScheme }) => {
    onChange(resolveColorScheme(preference, colorScheme));
  });
  return () => subscription.remove();
}

/**
 * Pure guard: resolves the context value or throws a descriptive error.
 * Extracted from the hook below so it is directly unit-testable without a
 * component renderer (no react-native-testing-library in this repo — mirrors
 * `AccessibilityProvider.tsx`'s `resolveAccessibilityContext` precedent).
 */
export function resolveColorSchemeContext(ctx: ColorScheme | undefined): ColorScheme {
  if (!ctx) {
    throw new Error(
      'useColorSchemeResolved/useThemeColors must be used within a ThemeProvider — ' +
        'mount <ThemeProvider> above this screen (RootNavigator.tsx does this app-wide).',
    );
  }
  return ctx;
}

/** Returns the RESOLVED scheme (`'light' | 'dark'`, never `'system'`). */
export function useColorSchemeResolved(): ColorScheme {
  return resolveColorSchemeContext(useContext(ThemeSchemeContext));
}

/** Never actually invoked: `userId` is only non-null once `db` has resolved
 * (see `useSessionDb`), so this repo is a structurally-inert placeholder for
 * the pre-session splash render — mirrors `AccessibilityProvider.tsx`'s
 * `INERT_REPO`. */
const INERT_REPO: SettingsRepo = {
  getSettings: async () => null,
  watchSettings: () => () => {},
  ensureSettingsRow: async () => {},
  updateSettings: async () => {},
};

export interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const { db, userId } = useSessionDb();
  const cache = useMemo(() => createSettingsCache(), []);
  const repo = useMemo(() => (db ? createSettingsRepo({ db }) : INERT_REPO), [db]);
  const { theme } = useSettings({ cache, repo, userId });

  const [resolvedScheme, setResolvedScheme] = useState<ColorScheme>(() =>
    resolveColorScheme(theme, Appearance.getColorScheme()),
  );

  // Re-resolve whenever the persisted preference itself changes (e.g. the
  // rep flips theme in EinstellungenScreen) — independent of the live
  // Appearance subscription below.
  useEffect(() => {
    setResolvedScheme(resolveColorScheme(theme, Appearance.getColorScheme()));
  }, [theme]);

  // Live OS appearance changes, only while the preference is 'system'.
  useEffect(() => {
    return subscribeToAppearance(theme, setResolvedScheme);
  }, [theme]);

  return <ThemeSchemeContext.Provider value={resolvedScheme}>{children}</ThemeSchemeContext.Provider>;
}
