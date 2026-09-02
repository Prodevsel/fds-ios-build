import { describe, expect, it, vi } from 'vitest';

// Node test environment (vitest.config.ts): AccessibilityProvider.tsx pulls
// in useSessionDb.ts (-> lib/db/powersync.ts, a native PowerSync/op-sqlite
// import) and settingsCache.ts (-> react-native-mmkv) transitively — mock
// both at the module boundary, mirroring MapScreen.test.tsx's pattern. This
// file exercises only the exported pure logic (`scaleTypography`,
// `resolveAccessibilityContext`, `TEXT_SCALE_MULTIPLIERS`); there is no
// react-native-testing-library in this repo, so the provider/hooks are never
// mounted or rendered (see useSettings.test.ts precedent).
vi.mock('../../../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('../settingsCache', () => ({
  createSettingsCache: () => ({ get: () => null, set: () => {} }),
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));

import {
  applyPersistedLanguage,
  resolveAccessibilityContext,
  scaleTypography,
  seedDeviceLanguage,
  TEXT_SCALE_MULTIPLIERS,
  type AccessibilityContextValue,
} from './AccessibilityProvider';
import { typography } from '../../../design/tokens';
import type { SettingsRepo } from '../db/settingsRepo';

describe('TEXT_SCALE_MULTIPLIERS', () => {
  it('maps exactly default/large/extra_large to 1 / 1.15 / 1.3', () => {
    expect(TEXT_SCALE_MULTIPLIERS).toEqual({ default: 1, large: 1.15, extra_large: 1.3 });
  });
});

describe('scaleTypography', () => {
  it('scales typography.body at the large multiplier to fontSize 18.4 / lineHeight 25.3', () => {
    const scaled = scaleTypography(typography.body, TEXT_SCALE_MULTIPLIERS.large);
    expect(scaled.fontSize).toBeCloseTo(18.4, 5);
    expect(scaled.lineHeight).toBeCloseTo(25.3, 5);
  });

  it('preserves every other property (e.g. fontWeight) untouched', () => {
    const scaled = scaleTypography(typography.body, TEXT_SCALE_MULTIPLIERS.large);
    expect(scaled.fontWeight).toBe(typography.body.fontWeight);
  });

  it('is a no-op at the default (×1.0) multiplier', () => {
    const scaled = scaleTypography(typography.heading, TEXT_SCALE_MULTIPLIERS.default);
    expect(scaled.fontSize).toBe(typography.heading.fontSize);
    expect(scaled.lineHeight).toBe(typography.heading.lineHeight);
  });
});

describe('resolveAccessibilityContext', () => {
  it('throws a descriptive error when no provider is mounted (context is undefined)', () => {
    expect(() => resolveAccessibilityContext(undefined)).toThrow(/AccessibilityProvider/);
  });

  it('returns the context value unchanged when a provider is mounted', () => {
    const value: AccessibilityContextValue = {
      textScaleMultiplier: 1.15,
      scale: (entry) => entry,
      highContrast: true,
    };
    expect(resolveAccessibilityContext(value)).toBe(value);
  });
});

describe('seedDeviceLanguage', () => {
  it('calls ensureSettingsRow with a deviceLanguage derived from the device locale code', () => {
    const ensureSettingsRow: SettingsRepo['ensureSettingsRow'] = vi.fn(async () => undefined);
    seedDeviceLanguage('rep-1', 'en', ensureSettingsRow);
    expect(ensureSettingsRow).toHaveBeenCalledWith({ userId: 'rep-1', deviceLanguage: 'en' });
  });

  it('narrows an unsupported device locale code down to "de"', () => {
    const ensureSettingsRow: SettingsRepo['ensureSettingsRow'] = vi.fn(async () => undefined);
    seedDeviceLanguage('rep-1', 'fr', ensureSettingsRow);
    expect(ensureSettingsRow).toHaveBeenCalledWith({ userId: 'rep-1', deviceLanguage: 'de' });
  });

  it('falls back to "de" when the device locale code is undefined', () => {
    const ensureSettingsRow: SettingsRepo['ensureSettingsRow'] = vi.fn(async () => undefined);
    seedDeviceLanguage('rep-1', undefined, ensureSettingsRow);
    expect(ensureSettingsRow).toHaveBeenCalledWith({ userId: 'rep-1', deviceLanguage: 'de' });
  });
});

describe('applyPersistedLanguage', () => {
  it('calls changeLanguage exactly once when the persisted language differs from the active one', () => {
    const changeLanguage = vi.fn(async () => undefined);
    applyPersistedLanguage('en', 'de', changeLanguage);
    expect(changeLanguage).toHaveBeenCalledTimes(1);
    expect(changeLanguage).toHaveBeenCalledWith('en');
  });

  it('does not call changeLanguage when the persisted language already matches the active one', () => {
    const changeLanguage = vi.fn(async () => undefined);
    applyPersistedLanguage('de', 'de', changeLanguage);
    expect(changeLanguage).toHaveBeenCalledTimes(0);
  });
});
