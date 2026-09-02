import { describe, expect, it, vi } from 'vitest';

// No react-test-renderer in this repo (StatusSheet.test.tsx precedent) —
// only the pure, exported functions are exercised. RecommendationBlock.tsx
// still imports 'react-native' at module scope for its JSX, so it must be
// mocked.
vi.mock('react-native', () => ({
  View: () => null,
  Text: () => null,
  Pressable: () => null,
  StyleSheet: { create: (styles: unknown) => styles },
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
// The reskinned RecommendationBlock renders a selected-check icon; mock the
// native icon set so the pure-logic assertions never load the native module.
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
// RecommendationBlock.tsx (since this plan) calls useThemeColors() ->
// ThemeProvider/AccessibilityProvider's own native deps — mocked here too
// (DiscountBlock.test.tsx precedent).
vi.mock('../../../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('../../settings/settingsCache', () => ({
  createSettingsCache: () => ({ get: () => null, set: () => {} }),
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));

import { resolveEffectiveChoice } from './RecommendationBlock';
import type { RecommendationRule } from '@frontdoorsales/flow-schema';

const rules: RecommendationRule[] = [
  { conditions: [{ field: 'device-count', operator: 'equals', value: 'many' }], result: 'tarif-l' },
  { conditions: [], result: 'tarif-s' }, // mandatory fallback (D-14)
];

describe('resolveEffectiveChoice (D-12/D-14: suggestion + rep override)', () => {
  it('resolves the first-match suggestion when no answer has been saved yet', () => {
    const result = resolveEffectiveChoice({ rules }, { 'device-count': 'many' }, undefined);
    expect(result.suggested).toBe('tarif-l');
    expect(result.effective).toBe('tarif-l');
    expect(result.overridden).toBe(false);
  });

  it('resolves the mandatory fallback when no rule matches', () => {
    const result = resolveEffectiveChoice({ rules }, { 'device-count': 'few' }, undefined);
    expect(result.suggested).toBe('tarif-s');
    expect(result.effective).toBe('tarif-s');
  });

  it('a rep override replaces the suggestion in the saved (effective) answer', () => {
    const result = resolveEffectiveChoice({ rules }, { 'device-count': 'many' }, 'tarif-s');
    expect(result.suggested).toBe('tarif-l');
    expect(result.effective).toBe('tarif-s');
    expect(result.overridden).toBe(true);
  });

  it('a saved answer matching the suggestion is not flagged as overridden', () => {
    const result = resolveEffectiveChoice({ rules }, { 'device-count': 'many' }, 'tarif-l');
    expect(result.overridden).toBe(false);
  });
});

describe('source assertions (D-14: override control present, no re-implemented rule engine)', () => {
  it('imports evaluateRecommendation via the useRecommendation hook, never re-implementing rule matching', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./RecommendationBlock.tsx', import.meta.url));
    const source = readFileSync(sourcePath, 'utf-8');
    expect(source).toMatch(/deriveRecommendation/);
    expect(source).not.toMatch(/\.every\(|switch\s*\(.*operator/);
  });
});
