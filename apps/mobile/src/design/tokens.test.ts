import { describe, expect, it } from 'vitest';
import * as tokens from './tokens';
import { darkColors, getColors, lightColors, spacing, statusColor, walletStateColor } from './tokens';

/**
 * Literal enumeration of every `lightColors` value, copied byte-for-byte
 * from the pre-refactor flat `color` object (12-07 Task 1 `<behavior>`).
 * Any accidental edit to a light-mode value fails this test — the light
 * palette MUST stay byte-identical to what shipped before this refactor.
 */
const EXPECTED_LIGHT_COLORS = {
  ink: '#12203A',
  paper: '#F5F6F8',
  accent: '#E8862C',
  brick: '#C0362C',
  pine: '#2F8F5B',
  surface: '#FFFFFF',
  background: '#F5F6F8',
  secondary: '#EDEFF3',
  destructive: '#C0362C',
  onAccent: '#FFFFFF',
  textPrimary: '#12203A',
  textSecondary: '#5C6B85',
  textMuted: '#8792A6',
  accentText: '#B5610A',
  accentOnDark: '#F6B26B',
  destructiveText: '#C0362C',
  noticeText: '#3A4763',
  border: 'rgba(18,32,58,0.10)',
  borderStrong: 'rgba(18,32,58,0.15)',
  subtleFill: 'rgba(18,32,58,0.06)',
  lockedTerritoryFill: '#94A3B8',
  lockedTerritoryFillOpacity: 0.35,
  lockedTerritoryOutline: '#64748B',
  ownTerritoryOutline: '#2563EB',
  clusterBadge: '#64748B',
};

describe('lightColors', () => {
  // toMatchObject, not toEqual: the guarantee this test exists for is that no
  // pre-refactor VALUE silently changes, not that the palette can never grow.
  // Exact equality also failed on purely ADDITIVE tokens (the map* basemap
  // colours), which say nothing about the values enumerated above.
  it('keeps every pre-refactor value byte-identical', () => {
    expect(lightColors).toMatchObject(EXPECTED_LIGHT_COLORS);
  });

  it('still carries every pre-refactor key', () => {
    for (const key of Object.keys(EXPECTED_LIGHT_COLORS)) {
      expect(lightColors).toHaveProperty(key);
    }
  });
});

describe('darkColors', () => {
  it('has exactly the same key set as lightColors — no key added, none missing', () => {
    expect(Object.keys(darkColors).sort()).toEqual(Object.keys(lightColors).sort());
  });

  it('differs from lightColors on at least the UI-SPEC semantic tokens', () => {
    expect(darkColors.background).not.toBe(lightColors.background);
    expect(darkColors.surface).not.toBe(lightColors.surface);
    expect(darkColors.textPrimary).not.toBe(lightColors.textPrimary);
  });
});

describe('getColors', () => {
  it("getColors('light') deep-equals lightColors", () => {
    expect(getColors('light')).toEqual(lightColors);
  });

  it("getColors('dark') deep-equals darkColors", () => {
    expect(getColors('dark')).toEqual(darkColors);
  });

  it('getColors(scheme, true) differs from getColors(scheme, false) only in the documented override keys (textPrimary, border, subtleFill) and no other key', () => {
    const DOCUMENTED_OVERRIDE_KEYS = ['textPrimary', 'border', 'subtleFill'];
    for (const scheme of ['light', 'dark'] as const) {
      const normal = getColors(scheme);
      const highContrast = getColors(scheme, true);
      const changedKeys = (Object.keys(normal) as Array<keyof typeof normal>).filter(
        (key) => normal[key] !== highContrast[key],
      );
      expect(changedKeys.every((key) => DOCUMENTED_OVERRIDE_KEYS.includes(key))).toBe(true);
      // At least textPrimary and border are actually overridden per scheme.
      expect(changedKeys).toEqual(expect.arrayContaining(['textPrimary', 'border']));
    }
  });

  it("getColors('light', true).textPrimary is '#000000' and getColors('dark', true).textPrimary is '#FFFFFF'", () => {
    expect(getColors('light', true).textPrimary).toBe('#000000');
    expect(getColors('dark', true).textPrimary).toBe('#FFFFFF');
  });
});

describe('spacing.pinKeypadTarget (15-05: re-derived PIN keypad glove-safe target)', () => {
  it('is a grid-aligned (multiple of 4) value, re-derived to 120 (see tokens.ts header comment)', () => {
    expect(spacing.pinKeypadTarget).toBe(120);
    expect(spacing.pinKeypadTarget % 4).toBe(0);
  });

  it('exceeds the 48dp general touchTarget floor (this is a named exception, not a reduction)', () => {
    expect(spacing.pinKeypadTarget).toBeGreaterThan(spacing.touchTarget);
  });
});

describe('module export surface', () => {
  it('does not contain a `color` key — the deprecated flat constant is gone (D-12, plan 12-15)', () => {
    expect('color' in tokens).toBe(false);
  });
});

describe('statusColor / walletStateColor', () => {
  it('are not scheme-varying — getColors has no effect on them (they are plain, unparameterized exports)', () => {
    expect(statusColor).toEqual({
      new: '#64748B',
      not_home: '#2563EB',
      follow_up: '#D97706',
      no_interest: '#78716C',
      blacklist: '#DC2626',
      success: '#16A34A',
    });
    expect(walletStateColor).toEqual({
      secured: statusColor.success,
      in_review: statusColor.follow_up,
      reversed: lightColors.destructive,
    });
  });
});
