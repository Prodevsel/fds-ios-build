import { useMemo } from 'react';
import { getColors, lightColors, type ColorScheme } from '../../../design/tokens';
import { useHighContrast } from './AccessibilityProvider';
import { useIsForcedLight } from './forceLightTheme';
import { useColorSchemeResolved } from './ThemeProvider';

/**
 * Pure: resolves the final color object a screen renders with — composing
 * the `ThemeProvider`-resolved scheme, the `AccessibilityProvider`
 * high-contrast flag, and the `ForceLightTheme` escape hatch (SET-05).
 * `forceLight` wins outright: it returns `lightColors` untouched, bypassing
 * both `resolvedScheme` and `highContrast` entirely, so the signature/
 * scanner surfaces (12-11) can never render dark or high-contrast-boosted —
 * always exactly today's shipped light palette. Extracted so it is directly
 * unit-tested without a component renderer (no react-native-testing-library
 * in this repo).
 */
export function resolveThemeColors(
  resolvedScheme: ColorScheme,
  forceLight: boolean,
  highContrast: boolean,
): ReturnType<typeof getColors> {
  if (forceLight) return lightColors;
  return getColors(resolvedScheme, highContrast);
}

/**
 * Returns the resolved color object for the current screen — every rollout
 * plan in wave 6 (12-08..12-12) replaces its `import { color } from
 * '.../design/tokens'` with `const color = useThemeColors();`. The returned
 * object is memoized so a consumer's
 * `useMemo(() => StyleSheet.create(...), [colors])` is stable across
 * renders.
 */
export function useThemeColors(): ReturnType<typeof getColors> {
  const resolvedScheme = useColorSchemeResolved();
  const highContrast = useHighContrast();
  const forceLight = useIsForcedLight();

  return useMemo(
    () => resolveThemeColors(resolvedScheme, forceLight, highContrast),
    [resolvedScheme, forceLight, highContrast],
  );
}
