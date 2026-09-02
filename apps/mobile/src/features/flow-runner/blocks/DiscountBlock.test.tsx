import { describe, expect, it, vi } from 'vitest';

// No react-test-renderer in this repo (StatusSheet.test.tsx precedent) —
// only the pure, exported functions are exercised. DiscountBlock.tsx still
// imports 'react-native' at module scope for its JSX, so it must be mocked.
vi.mock('react-native', () => ({
  View: () => null,
  Text: () => null,
  Pressable: () => null,
  StyleSheet: { create: (styles: unknown) => styles },
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
// The reskinned DiscountBlock composes the shared ui/ Button + an icon; mock the
// native icon set so the pure-logic assertions never load the native module.
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
// Button.tsx (since 12-08) calls useThemeColors() -> ThemeProvider/
// AccessibilityProvider's own native deps — mocked here too
// (AccessibilityProvider.test.tsx precedent).
vi.mock('../../../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('../../settings/settingsCache', () => ({
  createSettingsCache: () => ({ get: () => null, set: () => {} }),
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));

import {
  computeHeroDisplay,
  computeSnapshot,
  resolveAndFreezeSnapshot,
  type DiscountBlockRepo,
} from './DiscountBlock';
import type { DiscountTermsRow } from '../db/discountTermsRepo';
import { t } from '../../../i18n';

function fakeTerms(overrides: Partial<DiscountTermsRow> = {}): DiscountTermsRow {
  return {
    id: 'terms-1',
    company_id: 'company-1',
    product_slug: 'glasfaser-home',
    version: 1,
    status: 'published',
    type: 'markdown',
    door_price: 34.99,
    comparison_price: 49.99,
    // 0090 (H02): a terms row authored BEFORE the one-time/term/disclosure
    // columns existed — all null. The default fixture stays that shape on
    // purpose, so every pre-H02 assertion below keeps testing the old row.
    setup_fee: null,
    setup_fee_comparison: null,
    minimum_term_months: null,
    price_note: null,
    terms_text: 'Nur heute an Ihrer Tuer...',
    created_at: '2026-07-22T00:00:00Z',
    ...overrides,
  };
}

describe('computeSnapshot (T-03-16: discount amount derived solely from door/comparison prices)', () => {
  it('derives discount amount as comparison minus door price', () => {
    const snapshot = computeSnapshot(fakeTerms());
    expect(snapshot.discountAmount).toBeCloseTo(15.0);
    expect(snapshot.doorPrice).toBe(34.99);
    expect(snapshot.comparisonPrice).toBe(49.99);
    expect(snapshot.termsText).toBe('Nur heute an Ihrer Tuer...');
  });

  it('includes termsId/termsVersion from the resolved terms row (Gap 2A attribution)', () => {
    const snapshot = computeSnapshot(fakeTerms({ id: 'terms-42', version: 7 }));
    expect(snapshot.termsId).toBe('terms-42');
    expect(snapshot.termsVersion).toBe(7);
  });

  it('standalone terms with no comparison price: discount amount is null (nothing to compare to, D-18)', () => {
    const snapshot = computeSnapshot(fakeTerms({ type: 'standalone', comparison_price: null }));
    expect(snapshot.discountAmount).toBeNull();
    expect(snapshot.comparisonPrice).toBeNull();
  });
});

describe('resolveAndFreezeSnapshot (D-19/Pitfall 4: frozen at render/confirm time)', () => {
  it('a later mutation of the resolved terms row does not change the already-frozen snapshot', async () => {
    const termsRow = fakeTerms();
    const repo: DiscountBlockRepo = { getTermsById: vi.fn(async () => termsRow) };

    const first = await resolveAndFreezeSnapshot({ repo, termsRef: 'terms-1' });
    expect(first?.snapshot.discountAmount).toBeCloseTo(15.0);

    // Terms row mutates AFTER the snapshot was frozen (e.g. a later terms
    // version published while this consultation is mid-flow).
    termsRow.door_price = 10;
    termsRow.comparison_price = 20;

    // The already-frozen snapshot object is a separate value, untouched by
    // the mutation — this IS the Pitfall 4 proof.
    expect(first?.snapshot.discountAmount).toBeCloseTo(15.0);
    expect(first?.snapshot.doorPrice).toBe(34.99);
    expect(first?.snapshot.comparisonPrice).toBe(49.99);
  });

  it('returns null when the terms row cannot be resolved', async () => {
    const repo: DiscountBlockRepo = { getTermsById: vi.fn(async () => null) };
    const result = await resolveAndFreezeSnapshot({ repo, termsRef: 'missing' });
    expect(result).toBeNull();
  });
});

describe('source assertions (D-16: struck-through comparison price, no rep-discretion toggle)', () => {
  it('renders a struck-through comparison price style and has no rep-toggle for applying the discount', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./DiscountBlock.tsx', import.meta.url));
    const source = readFileSync(sourcePath, 'utf-8');
    expect(source).toMatch(/textDecorationLine:\s*['"]line-through['"]/);
    expect(source).not.toMatch(/Switch|toggle|applyDiscount/i);
  });
});

/**
 * H02 — what the customer actually signs.
 *
 * The hero card used to show a monthly price and nothing else. A monthly price
 * alone is not what the customer owes: there is a one-time setup fee, a minimum
 * term, and the prices are net. Those three now come off the terms row as
 * structured data (0090) and are rendered as their own lines.
 *
 * `computeHeroDisplay` is the pure display projection the JSX renders from —
 * this repo tests pure logic, not rendered DOM (StatusSheet.test.tsx precedent),
 * and a projection is the only shape of this that can be asserted without a
 * renderer.
 */
describe('computeHeroDisplay (H02: setup fee, minimum term, net note)', () => {
  const heroBlock = {
    type: 'discount' as const,
    id: 'door-discount',
    label: 'Ihr Tuer-Vorteil',
    gate: false,
    termsRef: 'terms-1',
    showComparisonPrice: true,
    emphasize: true,
  };

  it('renders the net-price note under the monthly price', () => {
    const display = computeHeroDisplay(fakeTerms(), heroBlock);
    expect(display.netNote).toBe(t('price.netNote'));
  });

  it('renders a one-time setup fee line with its struck-through regular price', () => {
    const display = computeHeroDisplay(
      fakeTerms({ setup_fee: 499, setup_fee_comparison: 999 }),
      heroBlock,
    );
    expect(display.setupFeeLabel).toBe(t('price.setupFeeLabel'));
    expect(display.setupFee).toBe('499,00 €');
    expect(display.setupFeeComparison).toBe('999,00 €');
  });

  it('omits the struck-through regular setup price when there is nothing to strike through', () => {
    const display = computeHeroDisplay(fakeTerms({ setup_fee: 499 }), heroBlock);
    expect(display.setupFee).toBe('499,00 €');
    expect(display.setupFeeComparison).toBeNull();
  });

  it('shows a waived setup fee (0) rather than dropping it as falsy', () => {
    const display = computeHeroDisplay(fakeTerms({ setup_fee: 0 }), heroBlock);
    expect(display.setupFee).toBe('0,00 €');
  });

  it('renders the minimum term with the month count interpolated', () => {
    const display = computeHeroDisplay(fakeTerms({ minimum_term_months: 12 }), heroBlock);
    expect(display.minimumTerm).toBe(t('price.minimumTerm').replace('{months}', '12'));
  });

  it('a terms row with all three new fields null renders as before plus the net note', () => {
    const display = computeHeroDisplay(fakeTerms(), heroBlock);
    expect(display.setupFee).toBeNull();
    expect(display.setupFeeComparison).toBeNull();
    expect(display.minimumTerm).toBeNull();
    // No "null" ever reaches a Text node.
    expect(JSON.stringify(display)).not.toContain('"null"');
    expect(display.doorPrice).toBe('34,99 €');
    expect(display.comparisonPrice).toBe('49,99 €');
    expect(display.netNote).toBe(t('price.netNote'));
  });

  it('a tenant-authored price_note wins over the platform default', () => {
    const display = computeHeroDisplay(
      fakeTerms({ price_note: 'Alle Preise zzgl. USt. und Versand.' }),
      heroBlock,
    );
    expect(display.netNote).toBe('Alle Preise zzgl. USt. und Versand.');
  });

  it('still computes the display-only savings line from the frozen door/comparison pair', () => {
    const display = computeHeroDisplay(fakeTerms(), heroBlock);
    expect(display.savingsMonthly).toBe('15,00 €');
    expect(display.savingsYearly).toBe('180,00 €');
  });
});
