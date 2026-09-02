import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';
import { getColors, type ColorScheme } from './tokens';

describe('contrastRatio', () => {
  it('returns 21 (within a small epsilon) for pure black vs pure white', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
  });

  it('returns 1 for a color against itself', () => {
    expect(contrastRatio('#12203A', '#12203A')).toBeCloseTo(1, 5);
  });

  it('composites an rgba(...) foreground over the supplied background instead of producing NaN', () => {
    const ratio = contrastRatio('rgba(18,32,58,0.35)', '#F5F6F8');
    expect(Number.isNaN(ratio)).toBe(false);
    expect(ratio).toBeGreaterThan(1);
  });
});

/**
 * WCAG floor proof (T-12-07-02): computed ratios over the real `getColors`
 * token values for both themes, normal and high-contrast mode. The AAA
 * (7:1) promise applies specifically to `textPrimary` — the "body text"
 * token per 12-UI-SPEC.md's Accessibility Contract — which is the token the
 * high-contrast override set actually swaps. `textSecondary` (label/meta
 * text, never overridden by high contrast) is held to the AA (4.5:1) floor
 * in every mode, which its shipped/tuned values already clear.
 */
const SCHEMES: ColorScheme[] = ['light', 'dark'];

describe('contrast floors across getColors(scheme, highContrast)', () => {
  for (const scheme of SCHEMES) {
    describe(`scheme: ${scheme}`, () => {
      it('textPrimary vs background and vs surface clear 4.5:1 (AA) at highContrast: false', () => {
        const colors = getColors(scheme, false);
        expect(contrastRatio(colors.textPrimary, colors.background)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(colors.textPrimary, colors.surface)).toBeGreaterThanOrEqual(4.5);
      });

      it('textPrimary vs background and vs surface clear 7:1 (AAA) at highContrast: true', () => {
        const colors = getColors(scheme, true);
        expect(contrastRatio(colors.textPrimary, colors.background)).toBeGreaterThanOrEqual(7);
        expect(contrastRatio(colors.textPrimary, colors.surface)).toBeGreaterThanOrEqual(7);
      });

      it('textSecondary vs surface clears 4.5:1 (AA) regardless of highContrast', () => {
        expect(contrastRatio(getColors(scheme, false).textSecondary, getColors(scheme, false).surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(getColors(scheme, true).textSecondary, getColors(scheme, true).surface)).toBeGreaterThanOrEqual(4.5);
      });
    });
  }
});

/**
 * T-12-11-01 (12-11-PLAN.md): the Widerrufsbelehrung (statutory withdrawal
 * notice, rendered via BelehrungBlock's `noticeText` style) is a legally
 * required notice, not decoration — it must never be the least legible text
 * on screen in any theme. `noticeText` is not one of `highContrastOverrides`'
 * three swapped keys, so `highContrast` does not change its value; this
 * assertion proves the SHIPPED value already clears the AAA (7:1) floor on
 * its own in both schemes, which is why no token needed tuning for this plan.
 */
describe('Widerrufsbelehrung notice-text contrast floor (T-12-11-01)', () => {
  for (const scheme of SCHEMES) {
    for (const highContrast of [false, true]) {
      it(`noticeText vs surface clears 4.5:1 (AA) and 7:1 (AAA) — scheme: ${scheme}, highContrast: ${highContrast}`, () => {
        const colors = getColors(scheme, highContrast);
        const ratio = contrastRatio(colors.noticeText, colors.surface);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
        expect(ratio).toBeGreaterThanOrEqual(7.0);
      });
    }
  }
});
