import { describe, expect, it, vi } from 'vitest';

// Node test environment (vitest.config.ts): no react-native-testing-library
// in this repo (see SegmentedControl.test.tsx / InfoSheet.test.tsx
// precedent) — test the exported pure `getLockAffordanceStyle` directly,
// never mount `LockAffordance`. `LockAffordance.tsx` also imports
// `react-native`/`@expo/vector-icons`/`useThemeColors()` at module scope for
// its component body (never invoked by this file), so those are stubbed the
// same way `SegmentedControl.test.tsx` stubs them.
vi.mock('react-native', () => ({
  Text: () => null,
  View: () => null,
}));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
vi.mock('../../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('./settingsCache', () => ({
  createSettingsCache: () => ({ get: () => null, set: () => {} }),
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));

import { getLockAffordanceStyle } from './LockAffordance';
import { compositeOver, contrastRatio } from '../../design/contrast';
import { getColors } from '../../design/tokens';

describe('getLockAffordanceStyle', () => {
  it("returns null for 'free' — no icon, no chip at all", () => {
    expect(getLockAffordanceStyle('free', getColors('light'))).toBeNull();
    expect(getLockAffordanceStyle('free', getColors('dark'))).toBeNull();
  });

  it("returns 'information-outline' for 'proposed' and 'lock-outline' for 'locked' — distinct icon shapes (D-16)", () => {
    const colors = getColors('light');
    const proposed = getLockAffordanceStyle('proposed', colors);
    const locked = getLockAffordanceStyle('locked', colors);
    expect(proposed?.icon).toBe('information-outline');
    expect(locked?.icon).toBe('lock-outline');
    expect(proposed?.icon).not.toBe(locked?.icon);
  });

  it('gives proposed and locked the SAME neutral chip fill and text color — color alone never distinguishes them (D-16)', () => {
    const colors = getColors('light');
    const proposed = getLockAffordanceStyle('proposed', colors);
    const locked = getLockAffordanceStyle('locked', colors);

    expect(proposed?.chip.backgroundColor).toBe(colors.secondary);
    expect(locked?.chip.backgroundColor).toBe(colors.secondary);
    expect(proposed?.chip.backgroundColor).toBe(locked?.chip.backgroundColor);

    expect(proposed?.label.color).toBe(colors.textSecondary);
    expect(locked?.label.color).toBe(colors.textSecondary);
    expect(proposed?.label.color).toBe(locked?.label.color);

    // Never accent, never destructive (13-UI-SPEC.md § Color).
    expect(proposed?.chip.backgroundColor).not.toBe(colors.accent);
    expect(proposed?.chip.backgroundColor).not.toBe(colors.destructive);
    expect(locked?.chip.backgroundColor).not.toBe(colors.accent);
    expect(locked?.chip.backgroundColor).not.toBe(colors.destructive);
  });

  it('resolves both dark-theme and light-theme colors without throwing (both consumed by the same pure function)', () => {
    expect(() => getLockAffordanceStyle('proposed', getColors('dark'))).not.toThrow();
    expect(() => getLockAffordanceStyle('locked', getColors('dark'))).not.toThrow();
  });
});

/**
 * T-13-04-03: the lock/proposed chip text must independently clear 4.5:1
 * (AA) against its own fill in BOTH themes — computed, not eyeballed. Light
 * theme's `secondary` token is already an opaque hex; dark theme's is a
 * translucent `rgba(...)` fill that only ever renders nested on the settings
 * card (`colors.surface`), so it is flattened with `compositeOver` first
 * (see `contrast.ts`'s header note) rather than measured against
 * `contrastRatio`'s default white backdrop, which would understate a
 * translucent dark-theme fill's real on-screen contrast.
 */
describe('lock/proposed chip contrast floor (T-13-04-03)', () => {
  it('textSecondary vs the chip fill clears 4.5:1 in light theme', () => {
    const colors = getColors('light');
    const chipBackground = compositeOver(colors.secondary, colors.surface);
    expect(contrastRatio(colors.textSecondary, chipBackground)).toBeGreaterThanOrEqual(4.5);
  });

  it('textSecondary vs the chip fill clears 4.5:1 in dark theme', () => {
    const colors = getColors('dark');
    const chipBackground = compositeOver(colors.secondary, colors.surface);
    expect(contrastRatio(colors.textSecondary, chipBackground)).toBeGreaterThanOrEqual(4.5);
  });
});
