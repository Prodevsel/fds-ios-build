import { afterEach, describe, expect, it } from 'vitest';
import { deriveDeviceLocale, i18n, SUPPORTED_LOCALES, t } from './index';

describe('i18next bootstrap', () => {
  afterEach(async () => {
    // Every test in this file mutates the shared i18next singleton via
    // changeLanguage — restore the default so other test files (and later
    // tests in this file) never observe a leaked 'en' active language.
    await i18n.changeLanguage('de');
  });

  it('exposes exactly de/en as SUPPORTED_LOCALES', () => {
    expect(SUPPORTED_LOCALES).toEqual(['de', 'en']);
  });

  it('falls back to de', () => {
    expect(i18n.options.fallbackLng).toEqual(['de']);
  });

  it('t() returns the German string by default', () => {
    expect(t('settings.title')).toBe('Einstellungen');
  });

  it('t() returns the English string after changeLanguage("en")', async () => {
    await i18n.changeLanguage('en');
    expect(t('settings.title')).toBe('Settings');
  });

  it('t() throws on an unknown key, preserving the fail-loud contract', () => {
    // @ts-expect-error -- deliberately invalid key to exercise the throw path
    expect(() => t('this.key.does.not.exist')).toThrow(/missing string/);
  });
});

describe('deriveDeviceLocale', () => {
  it('returns the matching locale for a supported device language', () => {
    expect(deriveDeviceLocale('en')).toBe('en');
    expect(deriveDeviceLocale('de')).toBe('de');
  });

  it('returns "de" for an unsupported device language', () => {
    expect(deriveDeviceLocale('fr')).toBe('de');
  });

  it('returns "de" when the device language is undefined', () => {
    expect(deriveDeviceLocale(undefined)).toBe('de');
  });
});
