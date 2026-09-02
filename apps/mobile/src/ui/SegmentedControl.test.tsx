import { describe, expect, it, vi } from 'vitest';

// Node test environment (vitest.config.ts): no react-native-testing-library
// in this repo (see InfoSheet.test.tsx / ContractListScreen.test.tsx
// precedent) — stub react-native at module scope and test the exported pure
// logic (`getSegmentedOptionStyle`, `handleSegmentedOptionPress`) directly,
// never mount the component. Since 12-08, `SegmentedControl.tsx` also
// imports `useThemeColors()` (12-07) for its component body, which
// transitively pulls in ThemeProvider/AccessibilityProvider's own native
// dependencies — mocked here too, mirroring `InfoSheet.test.tsx`'s and
// `AccessibilityProvider.test.tsx`'s precedent, even though none of these
// hooks are ever actually invoked (this file never mounts the component).
vi.mock('react-native', () => ({
  Pressable: () => null,
  StyleSheet: { create: (styles: unknown) => styles },
  Text: () => null,
  View: () => null,
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
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

import { getSegmentedOptionStyle, handleSegmentedOptionPress } from './SegmentedControl';
import { radius, spacing } from '../design/tokens';
import { themeTestColors as color } from '../features/settings/theme/themeTestColors';

describe('getSegmentedOptionStyle', () => {
  it('gives the selected option an accent fill and weight-600 label', () => {
    const style = getSegmentedOptionStyle(true, color);
    expect(style.container.backgroundColor).toBe(color.accent);
    expect(style.label.color).toBe(color.onAccent);
    expect(style.label.fontWeight).toBe('600');
  });

  it('gives an unselected option a secondary fill and weight-400 label', () => {
    const style = getSegmentedOptionStyle(false, color);
    expect(style.container.backgroundColor).toBe(color.secondary);
    expect(style.label.color).toBe(color.textPrimary);
    expect(style.label.fontWeight).toBe('400');
  });

  it('signals selection via a non-color property (fontWeight), never color alone', () => {
    const selected = getSegmentedOptionStyle(true, color);
    const unselected = getSegmentedOptionStyle(false, color);
    expect(selected.label.fontWeight).not.toBe(unselected.label.fontWeight);
  });

  it('every option resolves to at least a 48dp (spacing.touchTarget) minHeight', () => {
    expect(getSegmentedOptionStyle(true, color).container.minHeight).toBeGreaterThanOrEqual(spacing.touchTarget);
    expect(getSegmentedOptionStyle(false, color).container.minHeight).toBeGreaterThanOrEqual(spacing.touchTarget);
  });

  it('uses the pill radius token for the option shape', () => {
    expect(getSegmentedOptionStyle(true, color).container.borderRadius).toBe(radius.pill);
  });

  // 13-04/SET-07: per-option disable (ceiling dimming), never a whole-control disable.
  it('applies opacity 0.4 when disabled, regardless of selection', () => {
    expect(getSegmentedOptionStyle(false, color, true).container.opacity).toBe(0.4);
    expect(getSegmentedOptionStyle(true, color, true).container.opacity).toBe(0.4);
  });

  it('applies no opacity override when not disabled (default parameter, byte-identical to the pre-13-04 shape)', () => {
    expect(getSegmentedOptionStyle(false, color).container.opacity).toBeUndefined();
    expect(getSegmentedOptionStyle(true, color, false).container.opacity).toBeUndefined();
  });

  it('never reduces minHeight below spacing.touchTarget when disabled — dims, never shrinks/reflows', () => {
    expect(getSegmentedOptionStyle(false, color, true).container.minHeight).toBe(spacing.touchTarget);
  });
});

describe('handleSegmentedOptionPress', () => {
  it('calls onChange exactly once when a non-selected option is pressed', () => {
    const onChange = vi.fn();
    handleSegmentedOptionPress('large', 'default', onChange);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('large');
  });

  it('calls onChange zero times when the already-selected option is pressed', () => {
    const onChange = vi.fn();
    handleSegmentedOptionPress('default', 'default', onChange);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('works across a real 3-option set (default/large/extra_large) without cross-firing', () => {
    const onChange = vi.fn();
    handleSegmentedOptionPress('extra_large', 'large', onChange);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('extra_large');
  });

  // 13-04/SET-07: pressing an option in `disabledValues` (e.g. '30'/'60' under
  // a 15-minute ceiling) must never invoke `onChange` — silent no-op, no
  // toast, no error, because the option is genuinely unreachable.
  it('calls onChange zero times when the pressed option is disabled, even for a genuine value change', () => {
    const onChange = vi.fn();
    handleSegmentedOptionPress('30', '15', onChange, true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('the disabled check wins even if the disabled option happens to already be selected', () => {
    const onChange = vi.fn();
    handleSegmentedOptionPress('30', '30', onChange, true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('defaults disabled to false — every pre-13-04 call site keeps firing onChange unchanged', () => {
    const onChange = vi.fn();
    handleSegmentedOptionPress('large', 'default', onChange);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
