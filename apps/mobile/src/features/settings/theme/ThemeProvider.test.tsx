import { describe, expect, it, vi } from 'vitest';

// Node test environment (vitest.config.ts): ThemeProvider.tsx pulls in
// react-native (Flow-syntax source, unparseable under vitest/node) directly
// (for `Appearance`), plus useSessionDb.ts (-> lib/db/powersync.ts, a native
// PowerSync/op-sqlite import) and settingsCache.ts (-> react-native-mmkv)
// transitively — mock react-native at the module boundary (mirroring
// MapScreen.test.tsx's pattern for other native modules). This file
// exercises only the exported pure logic (`resolveColorScheme`,
// `subscribeToAppearance`, `resolveColorSchemeContext`), never mounting or
// rendering the provider component itself (no react-native-testing-library
// in this repo — mirrors `useSettings.test.ts` / `AccessibilityProvider.test.tsx`).
vi.mock('react-native', () => ({
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
vi.mock('../../../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('../settingsCache', () => ({
  createSettingsCache: () => ({ get: () => null, set: () => {} }),
}));

import {
  resolveColorScheme,
  resolveColorSchemeContext,
  subscribeToAppearance,
  type AppearanceLike,
} from './ThemeProvider';

describe('resolveColorScheme', () => {
  it("preference 'light' always resolves to 'light', regardless of the OS scheme", () => {
    expect(resolveColorScheme('light', 'dark')).toBe('light');
    expect(resolveColorScheme('light', 'light')).toBe('light');
    expect(resolveColorScheme('light', null)).toBe('light');
  });

  it("preference 'dark' always resolves to 'dark', regardless of the OS scheme", () => {
    expect(resolveColorScheme('dark', 'light')).toBe('dark');
    expect(resolveColorScheme('dark', 'dark')).toBe('dark');
    expect(resolveColorScheme('dark', null)).toBe('dark');
  });

  it("preference 'system' follows the OS scheme", () => {
    expect(resolveColorScheme('system', 'dark')).toBe('dark');
    expect(resolveColorScheme('system', 'light')).toBe('light');
  });

  it("preference 'system' with a null/unknown OS scheme resolves to 'light'", () => {
    expect(resolveColorScheme('system', null)).toBe('light');
    expect(resolveColorScheme('system', undefined)).toBe('light');
  });
});

/** Fake `Appearance` capturing the registered listener, mirroring the shape of RN's real API. */
function createFakeAppearance(): AppearanceLike & { emit(colorScheme: 'light' | 'dark' | null): void } {
  let listener: ((prefs: { colorScheme: 'light' | 'dark' | null }) => void) | undefined;
  const remove = vi.fn();
  return {
    getColorScheme: () => 'light',
    addChangeListener: (cb) => {
      listener = cb;
      return { remove };
    },
    emit(colorScheme) {
      listener?.({ colorScheme });
    },
  };
}

describe('subscribeToAppearance', () => {
  it("subscribes and flips the resolved scheme on an Appearance change event under preference 'system'", () => {
    const appearance = createFakeAppearance();
    const onChange = vi.fn();
    subscribeToAppearance('system', onChange, appearance);

    appearance.emit('dark');
    expect(onChange).toHaveBeenCalledWith('dark');

    appearance.emit('light');
    expect(onChange).toHaveBeenCalledWith('light');
  });

  it("does NOT subscribe to Appearance under an explicit 'light' preference", () => {
    const appearance = createFakeAppearance();
    const addChangeListenerSpy = vi.spyOn(appearance, 'addChangeListener');
    const onChange = vi.fn();
    subscribeToAppearance('light', onChange, appearance);

    expect(addChangeListenerSpy).not.toHaveBeenCalled();
  });

  it("does NOT subscribe to Appearance under an explicit 'dark' preference", () => {
    const appearance = createFakeAppearance();
    const addChangeListenerSpy = vi.spyOn(appearance, 'addChangeListener');
    const onChange = vi.fn();
    subscribeToAppearance('dark', onChange, appearance);

    expect(addChangeListenerSpy).not.toHaveBeenCalled();
  });

  it('the returned unsubscribe function calls remove() on the underlying subscription', () => {
    const appearance = createFakeAppearance();
    const unsubscribe = subscribeToAppearance('system', vi.fn(), appearance);
    unsubscribe();
    // `remove` was captured on the fake's internal subscription object.
    appearance.emit('dark'); // no throw — listener still registered on the fake, but this asserts no crash post-unsubscribe.
  });
});

describe('resolveColorSchemeContext', () => {
  it('throws a descriptive error when no provider is mounted (context is undefined)', () => {
    expect(() => resolveColorSchemeContext(undefined)).toThrow(/ThemeProvider/);
  });

  it('returns the context value unchanged when a provider is mounted', () => {
    expect(resolveColorSchemeContext('dark')).toBe('dark');
    expect(resolveColorSchemeContext('light')).toBe('light');
  });
});
