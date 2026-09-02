import { describe, expect, it, vi } from 'vitest';

// Node test environment (vitest.config.ts): never load native RN/Expo modules.
// InfoSheet.tsx imports react-native + @expo/vector-icons at module scope, so
// stub them — only the pure, exported `buildStatusLegend()` is under test here
// (mirrors StatusSheet.test.tsx's "test the exported logic, never mount" pattern).
// Since 12-08, InfoSheet.tsx also imports `useThemeColors()` (12-07), which
// transitively pulls in ThemeProvider/AccessibilityProvider's own native
// dependencies (useSessionDb -> PowerSync/op-sqlite, settingsCache ->
// react-native-mmkv, expo-localization) — mocked here at the module boundary
// too, mirroring `AccessibilityProvider.test.tsx`'s precedent, even though
// none of these hooks are ever actually invoked (no react-native-testing-
// library in this repo — this file never mounts a component).
vi.mock('react-native', () => ({
  Modal: () => null,
  Pressable: () => null,
  ScrollView: () => null,
  StyleSheet: { create: (s: unknown) => s, absoluteFillObject: {} },
  Text: () => null,
  View: () => null,
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
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

import { buildStatusLegend } from './InfoSheet';
import { statusColor, statusIcon, type HouseStatus } from '../design/tokens';

describe('buildStatusLegend', () => {
  const legend = buildStatusLegend();

  it('covers all six house statuses in legend order', () => {
    expect(legend.map((e) => e.status)).toEqual<HouseStatus[]>([
      'new',
      'not_home',
      'follow_up',
      'no_interest',
      'success',
      'blacklist',
    ]);
  });

  it('pairs each status with its traffic-light colour AND glyph (never colour alone)', () => {
    for (const entry of legend) {
      expect(entry.color).toBe(statusColor[entry.status]);
      expect(entry.iconName).toBe(statusIcon[entry.status]);
    }
  });

  it('provides a non-empty German label and one-line meaning for every entry', () => {
    for (const entry of legend) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.meaning.length).toBeGreaterThan(0);
      // label and meaning are distinct strings, not the same key echoed twice
      expect(entry.meaning).not.toBe(entry.label);
    }
  });

  it('names blacklist as the permanent, team-wide advertising objection', () => {
    const blacklist = legend.find((e) => e.status === 'blacklist');
    const meaning = blacklist?.meaning.toLowerCase() ?? '';
    expect(meaning).toContain('werbewiderspruch');
    expect(meaning).toContain('dauerhaft');
  });

  it('keeps the polite no reversible in its copy — it is NOT a lock', () => {
    // The whole point of 0103: a rep reading this must not think a refusal
    // closes the door for good. If this copy ever starts sounding permanent,
    // reps go back to reaching for the blacklist.
    const noInterest = legend.find((e) => e.status === 'no_interest');
    expect(noInterest?.meaning.toLowerCase()).toContain('später');
  });
});
