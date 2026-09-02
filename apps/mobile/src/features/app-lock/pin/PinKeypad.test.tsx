import { describe, expect, it, vi } from 'vitest';

// Node test environment (vitest.config.ts): PinKeypad.tsx imports
// useThemeColors(), whose provider chain (ThemeProvider/AccessibilityProvider)
// transitively pulls in react-native's Appearance + expo-localization + the
// settings repo/cache — mocked here even though no component is ever
// mounted (only the pure, exported logic functions are exercised below).
// Mirrors DiscountBlock.test.tsx / StatusSheet.test.tsx's precedent exactly.
vi.mock('react-native', () => ({
  View: () => null,
  Text: () => null,
  Pressable: () => null,
  StyleSheet: { create: (styles: unknown) => styles },
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
vi.mock('../../../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('../../settings/settingsCache', () => ({
  createSettingsCache: () => ({ get: () => null, set: () => {} }),
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));

import { compositeOver, contrastRatio } from '../../../design/contrast';
import { darkColors, lightColors } from '../../../design/tokens';
import {
  computeNextValue,
  derivePinDotsLabel,
  handleBackspacePress,
  handleDigitPress,
} from './PinKeypad';

describe('derivePinDotsLabel (T-15-05-03: a11y label exposes COUNT, never digits)', () => {
  it('derivePinDotsLabel(3, 6) returns the exact German string', () => {
    expect(derivePinDotsLabel(3, 6)).toBe('3 von 6 Ziffern eingegeben');
  });

  it('never contains a digit sequence resembling entered PIN content — only the two counts', () => {
    const label = derivePinDotsLabel(4, 6);
    expect(label).toBe('4 von 6 Ziffern eingegeben');
  });
});

describe('computeNextValue', () => {
  it('appends a digit while under pinLength', () => {
    expect(computeNextValue('12', '3', 6)).toBe('123');
  });

  it('is a no-op once value.length reaches pinLength', () => {
    expect(computeNextValue('123456', '7', 6)).toBe('123456');
  });
});

describe('handleDigitPress (onComplete fires exactly once)', () => {
  it('calls onChange on every press and onComplete exactly once, only on the press that reaches pinLength', () => {
    const onChange = vi.fn();
    const onComplete = vi.fn();
    let value = '';

    for (const digit of ['1', '2', '3', '4', '5']) {
      handleDigitPress(value, digit, 6, onChange, onComplete);
      value = onChange.mock.calls[onChange.mock.calls.length - 1]![0] as string;
    }
    expect(onComplete).not.toHaveBeenCalled();

    handleDigitPress(value, '6', 6, onChange, onComplete);
    value = onChange.mock.calls[onChange.mock.calls.length - 1]![0] as string;
    expect(value).toBe('123456');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('123456');
    expect(onChange).toHaveBeenCalledTimes(6);
  });

  it('does not fire onComplete again, and does not call onChange, on a later press with an already-full value', () => {
    const onChange = vi.fn();
    const onComplete = vi.fn();

    handleDigitPress('123456', '7', 6, onChange, onComplete);

    expect(onChange).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe('handleBackspacePress', () => {
  it('removes the last entered digit', () => {
    const onChange = vi.fn();
    handleBackspacePress('123', onChange);
    expect(onChange).toHaveBeenCalledWith('12');
  });

  it('is a silent no-op on an empty value', () => {
    const onChange = vi.fn();
    handleBackspacePress('', onChange);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('source assertions (no react-test-renderer in this repo — StatusSheet.test.tsx precedent)', () => {
  async function readSource() {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./PinKeypad.tsx', import.meta.url));
    return readFileSync(sourcePath, 'utf-8');
  }

  it('renders no text node containing the entered value — every <Text> shows only a fixed digit/backspace glyph, never `value`', async () => {
    const source = await readSource();
    // Every rendered digit glyph is `{digit}` (the row-iteration variable) or
    // a literal '0'/'⌫' — never the entered `value` prop itself.
    expect(source).not.toMatch(/<Text[^>]*>\s*\{?\s*value\b/);
    expect(source).toMatch(/<Text style=\{styles\.digitGlyph\}>\{digit\}<\/Text>/);
  });

  it('the dots row exposes derivePinDotsLabel(value.length, pinLength) as its accessibilityLabel', async () => {
    const source = await readSource();
    expect(source).toMatch(/const dotsLabel = derivePinDotsLabel\(value\.length, pinLength\);/);
    expect(source).toMatch(/accessibilityLabel=\{dotsLabel\}/);
  });

  it('contains zero bare hex color literals — every color comes from the colors token object', async () => {
    const source = await readSource();
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('references spacing.pinKeypadTarget at least twice (width and height)', async () => {
    const source = await readSource();
    const matches = source.match(/spacing\.pinKeypadTarget/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('disabled keys use opacity 0.4 and stay full size — never shrink or leave the tree (SegmentedControl.tsx precedent)', async () => {
    const source = await readSource();
    expect(source).toMatch(/keyDisabled:\s*\{\s*opacity:\s*0\.4\s*\}/);
    // The disabled style is layered ON TOP of the full-size `key` style, never
    // replacing it — proven by both appearing in the same style array.
    expect(source).toMatch(/styles\.key,[\s\S]{0,80}disabled \? styles\.keyDisabled : null/);
  });
});

describe('digit glyph contrast (Phase 13 precedent: computed, not assumed) — >= 4.5:1 on colors.secondary in both themes', () => {
  it('light theme clears 4.5:1', () => {
    const ratio = contrastRatio(lightColors.textPrimary, lightColors.secondary);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('dark theme clears 4.5:1 (colors.secondary is translucent — flattened over colors.surface first, contrast.ts convention)', () => {
    const flattenedSecondary = compositeOver(darkColors.secondary, darkColors.surface);
    const ratio = contrastRatio(darkColors.textPrimary, flattenedSecondary);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
