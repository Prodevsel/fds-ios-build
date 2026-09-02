import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import de from './de.json';
import en from './en.json';

/**
 * i18next runtime for `apps/mobile` (SET-02, D-05, D-06). Mirrors
 * `apps/admin/src/i18n/index.ts`'s bootstrap shape at the SAME
 * i18next/react-i18next versions (one i18n idiom in the monorepo, not two),
 * but registers a single FLAT `translation` namespace instead of admin's
 * per-feature namespace globbing — `de.json`/`en.json` stay locked to the
 * flat "section.key" convention this module has always used
 * (12-UI-SPEC.md).
 *
 * The exported `t(key)` preserves the exact call shape all existing call
 * sites already use (`t('settings.title')`), so this replacement is zero
 * call-site churn: it resolves through i18next but keeps throwing on a
 * missing key instead of i18next's default silent key-echo, so the prior
 * hand-rolled accessor's fail-loud contract survives unchanged.
 */

type Resources = typeof de;
export type TranslationKey = keyof Resources;

export const SUPPORTED_LOCALES = ['de', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

void i18n.use(initReactI18next).init({
  lng: 'de',
  fallbackLng: 'de',
  resources: {
    de: { translation: de },
    en: { translation: en },
  },
  interpolation: { escapeValue: false },
});

export { i18n };

export function t(key: TranslationKey): string {
  if (!i18n.exists(key)) {
    throw new Error(`i18n: missing string for key "${key}"`);
  }
  return i18n.t(key);
}

/**
 * Pure: resolves a device languageCode to a supported locale, falling back
 * to 'de' (the primary market, D-05) for anything unsupported or undefined.
 * Takes the code as an argument rather than reading expo-localization's
 * device-locale API internally, so this module stays test-safe under Node —
 * the caller (`AccessibilityProvider.tsx`) resolves the device's active
 * locale and passes its languageCode in.
 *
 * USED ONLY to seed a first-time `user_settings` row (Pitfall 4). Once a row
 * exists, the persisted `language` value is authoritative and this function
 * must never be consulted again to re-derive the active language — on
 * Android the OS per-app language can change independently of an explicit
 * in-app choice, and re-deriving here would silently revert it.
 */
export function deriveDeviceLocale(languageCode: string | undefined): SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(languageCode ?? '')
    ? (languageCode as SupportedLocale)
    : 'de';
}
