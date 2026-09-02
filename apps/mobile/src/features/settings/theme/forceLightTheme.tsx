import { createContext, useContext, type ReactNode } from 'react';

/**
 * ForceLightTheme — explicit opt-in wrapper pinning a subtree to the light
 * palette regardless of `ThemeProvider`'s resolved scheme, the persisted
 * `theme` preference, or the `AccessibilityProvider` high-contrast flag
 * (SET-05 hard exception, 12-UI-SPEC.md § Theme resolution model). The
 * Phase-4 signature-capture and scanner-preview surfaces opt into this
 * wrapper (wired in plan 12-11) — a per-screen `if (scheme === 'dark')`
 * branch is explicitly FORBIDDEN there: it is trivially forgotten the next
 * time those files are touched, whereas this wrapper is impossible to miss
 * and unit-tested (see `useThemeColors.ts`'s `resolveThemeColors`, exercised
 * from `forceLightTheme.test.tsx`).
 */

const ForceLightContext = createContext(false);

export interface ForceLightThemeProps {
  children: ReactNode;
}

export function ForceLightTheme({ children }: ForceLightThemeProps) {
  return <ForceLightContext.Provider value={true}>{children}</ForceLightContext.Provider>;
}

/** Internal: read by `useThemeColors()` to bypass scheme/highContrast entirely. Defaults to `false` outside any `ForceLightTheme`. */
export function useIsForcedLight(): boolean {
  return useContext(ForceLightContext);
}
