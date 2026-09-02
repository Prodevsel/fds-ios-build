import { createContext, Fragment, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getLocales } from 'expo-localization';
import { useSessionDb } from '../../../app/useSessionDb';
import { deriveDeviceLocale, i18n } from '../../../i18n';
import { createSettingsCache } from '../settingsCache';
import { createSettingsRepo, type SettingsRepo, type TextSize } from '../db/settingsRepo';
import { useSettings } from '../useSettings';

/**
 * AccessibilityProvider — the first React Context provider in `apps/mobile`
 * (no in-repo analog, 12-PATTERNS.md § No Analog Found). Reads `useSettings()`
 * and exposes the rep's `text_size`/`high_contrast` preference to every
 * screen via context, so a preference change takes effect immediately, app-
 * wide, without a restart (SET-06).
 *
 * NON-NEGOTIABLE, for every future screen that consumes `useTextScale()`:
 * the returned multiplier COMPOUNDS with the OS font scale
 * (`PixelRatio.getFontScale()` / the OS accessibility text-size setting) —
 * it must NEVER be implemented via any RN `Text` prop that disables or caps
 * OS-driven font scaling (the two forbidden props are named in the UI-SPEC's
 * "OS-level scaling interaction" section; grepped for repo-wide in CI, so do
 * not reintroduce either one). At the combined maximum (OS accessibility
 * max × `extra_large`), row labels MUST wrap to a second line, never
 * truncate or clip.
 *
 * Also owns two SET-02 responsibilities, since this is the one provider
 * already mounted app-wide above every screen:
 * (1) first-login seeding — `expo-localization`'s device-locale API is read
 *     HERE (not inside `i18n/index.ts`, which stays Node-testable) and
 *     handed to `SettingsRepo.ensureSettingsRow`, which only ever inserts on
 *     the very first row for a rep (Pitfall 4) — every later mount is a
 *     harmless no-op guarded by the repo's own existence check.
 * (2) applying the persisted language to the live i18next instance whenever
 *     it differs from the active one.
 *
 * Known, deliberate trade-off: the ~35 existing call sites across this app
 * use the module-level `t()` accessor (a plain function call, not React's
 * reactive `useTranslation()` hook), so they do NOT re-render on their own
 * when `i18n.changeLanguage` resolves. Rather than migrate 35 files to
 * `useTranslation()` — a second large refactor this phase does not carry
 * alongside the theme work — the provider forces a full remount of its
 * children, keyed on the active i18next language, whenever it changes. The
 * one user-visible consequence: switching language resets navigation to the
 * current tab's root screen. `t()` and `useTranslation()` resolve against
 * the same i18next instance, so a future phase can migrate call sites
 * incrementally without touching this mechanism.
 */

/** `text_size` → in-app multiplier, applied on TOP of the OS font scale. */
export const TEXT_SCALE_MULTIPLIERS: Record<TextSize, number> = {
  default: 1,
  large: 1.15,
  extra_large: 1.3,
};

interface ScalableTypographyEntry {
  fontSize: number;
  lineHeight: number;
}

/**
 * Pure: multiplies `fontSize` and `lineHeight` of a `typography` token entry
 * by the given multiplier, preserving every other property (fontWeight,
 * fontFamily, ...) untouched. Never returns a raw number a screen could
 * hardcode — always the full, scaled token shape.
 */
export function scaleTypography<T extends ScalableTypographyEntry>(entry: T, multiplier: number): T {
  return {
    ...entry,
    fontSize: entry.fontSize * multiplier,
    lineHeight: entry.lineHeight * multiplier,
  };
}

export interface AccessibilityContextValue {
  textScaleMultiplier: number;
  scale: <T extends ScalableTypographyEntry>(entry: T) => T;
  highContrast: boolean;
}

const AccessibilityContext = createContext<AccessibilityContextValue | undefined>(undefined);

/**
 * Pure guard: resolves the context value or throws a descriptive error.
 * Extracted from the hooks below so it is directly unit-testable without a
 * component renderer (this repo has no react-native-testing-library — see
 * `useSettings.test.ts` precedent).
 */
export function resolveAccessibilityContext(
  ctx: AccessibilityContextValue | undefined,
): AccessibilityContextValue {
  if (!ctx) {
    throw new Error(
      'useTextScale/useHighContrast must be used within an AccessibilityProvider — ' +
        'mount <AccessibilityProvider> above this screen (RootNavigator.tsx does this app-wide).',
    );
  }
  return ctx;
}

/** Returns a scaler function: pass a `typography` entry, get it back scaled by the rep's `text_size` preference. */
export function useTextScale(): AccessibilityContextValue['scale'] {
  return resolveAccessibilityContext(useContext(AccessibilityContext)).scale;
}

/** Returns the rep's `high_contrast` preference, live. */
export function useHighContrast(): boolean {
  return resolveAccessibilityContext(useContext(AccessibilityContext)).highContrast;
}

/** Never actually invoked: `userId` is only non-null once `db` has resolved (see `useSessionDb`), so this repo is a structurally-inert placeholder for the pre-session splash render. */
const INERT_REPO: SettingsRepo = {
  getSettings: async () => null,
  watchSettings: () => () => {},
  ensureSettingsRow: async () => {},
  updateSettings: async () => {},
};

/**
 * Pure/DI'd: seeds the first-login `user_settings` row with a device-derived
 * language via the injected `ensureSettingsRow`. `ensureSettingsRow` itself
 * is a SELECT-then-maybe-INSERT no-op once a row exists (db/settingsRepo.ts),
 * so this is safe to call on every mount — it only ever writes once, per
 * rep, ever (Pitfall 4). `deviceLocaleCode` is the raw, possibly-unsupported
 * OS value; `deriveDeviceLocale` narrows it to a supported locale.
 */
export function seedDeviceLanguage(
  userId: string,
  deviceLocaleCode: string | undefined,
  ensureSettingsRow: SettingsRepo['ensureSettingsRow'],
): void {
  void ensureSettingsRow({ userId, deviceLanguage: deriveDeviceLocale(deviceLocaleCode) });
}

/**
 * Pure/DI'd: applies the persisted language preference to the live i18next
 * instance exactly once when it differs from the currently active language,
 * and is a no-op when they already match (T-12-06-01 — the persisted value
 * is authoritative, this is the only place it is ever pushed into i18next).
 */
export function applyPersistedLanguage(
  persistedLanguage: string,
  activeLanguage: string,
  changeLanguage: (lng: string) => Promise<unknown>,
): void {
  if (persistedLanguage === activeLanguage) return;
  void changeLanguage(persistedLanguage);
}

export interface AccessibilityProviderProps {
  children: ReactNode;
}

export function AccessibilityProvider({ children }: AccessibilityProviderProps) {
  const { db, userId } = useSessionDb();
  const cache = useMemo(() => createSettingsCache(), []);
  const repo = useMemo(() => (db ? createSettingsRepo({ db }) : INERT_REPO), [db]);
  const { textSize, highContrast, language } = useSettings({ cache, repo, userId });

  // (1) First-login seeding — see the header comment above. Deliberately
  // NOT gated on `db` alone: `userId` also gates INERT_REPO out, so this
  // never fires against the pre-session placeholder repo.
  useEffect(() => {
    if (!userId) return;
    seedDeviceLanguage(userId, getLocales()[0]?.languageCode ?? undefined, repo.ensureSettingsRow);
  }, [repo, userId]);

  // (2) Apply the persisted language to i18next whenever it changes.
  useEffect(() => {
    applyPersistedLanguage(language, i18n.language, (lng) => i18n.changeLanguage(lng));
  }, [language]);

  // (2, continued) Force a remount of the subtree on every actual i18next
  // language change (not merely on `language` prop change — `i18n.language`
  // is the source of truth for what module-level `t()` currently renders,
  // and only updates once `changeLanguage` has actually resolved). See the
  // header comment for why a remount is necessary and its one consequence.
  const [renderedLanguage, setRenderedLanguage] = useState(i18n.language);
  useEffect(() => {
    const handleLanguageChanged = (lng: string) => setRenderedLanguage(lng);
    i18n.on('languageChanged', handleLanguageChanged);
    return () => {
      i18n.off('languageChanged', handleLanguageChanged);
    };
  }, []);

  const value = useMemo<AccessibilityContextValue>(() => {
    const multiplier = TEXT_SCALE_MULTIPLIERS[textSize];
    return {
      textScaleMultiplier: multiplier,
      scale: (entry) => scaleTypography(entry, multiplier),
      highContrast,
    };
  }, [textSize, highContrast]);

  return (
    <AccessibilityContext.Provider value={value}>
      <Fragment key={renderedLanguage}>{children}</Fragment>
    </AccessibilityContext.Provider>
  );
}
