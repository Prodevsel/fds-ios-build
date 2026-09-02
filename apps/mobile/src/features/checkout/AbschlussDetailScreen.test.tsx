import { describe, expect, it, vi } from 'vitest';

// Node test env: never load native RN/navigation modules; only the pure,
// exported view-logic helpers are under test (StatusSheet.test.tsx precedent).
vi.mock('react-native', () => ({
  View: () => null,
  Text: () => null,
  ScrollView: () => null,
  StyleSheet: { create: (styles: unknown) => styles },
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
// Safe-area boundary mock (AppLockGate.test.tsx / LoginScreen.test.tsx
// precedent): the screen calls useSafeAreaInsets() at module-consumer level,
// and react-native-safe-area-context's real entry point pulls in native code
// that cannot load under the node test env. Zero insets keep the asserted
// layout values identical to the pre-inset baseline.
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: vi.fn() }),
  useRoute: () => ({ params: {} }),
}));
vi.mock('../../app/DbBoundary', () => ({ DbBoundary: () => null }));
// AbschlussDetailScreen.tsx transitively imports the ui/ primitives, which
// (since 12-08) call useThemeColors() -> ThemeProvider/AccessibilityProvider's
// own native deps — mocked here too (AccessibilityProvider.test.tsx precedent).
vi.mock('../../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('../settings/settingsCache', () => ({
  createSettingsCache: () => ({ get: () => null, set: () => {} }),
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));
// contractsRepo.ts (imported for types + the pure helpers) transitively pulls
// expo-crypto (native) — mock it so the module loads under the node env.
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(), digestStringAsync: vi.fn() }));
// QUICK-F99: the screen now renders ContractPdfSheet, whose module graph
// reaches getSupabase() -> expo-secure-store and expo-file-system (both
// native). Mocked at the component boundary, same as DbBoundary above — this
// suite exercises the pure helpers, never the JSX.
vi.mock('./ContractPdfSheet', () => ({ ContractPdfSheet: () => null }));

import type { ContractDetailRow } from '../flow-runner/db/contractsRepo';
import {
  buildDetailRows,
  buildVerlauf,
  deriveDetailState,
  formatFullDate,
  pendingBannerText,
} from './AbschlussDetailScreen';

const detail = (overrides: Partial<ContractDetailRow> = {}): ContractDetailRow => ({
  id: 'c1',
  dealReference: 'FDS-20260727-AB12CD34',
  customerName: 'Sabine Krüger',
  productName: 'strom-24',
  signedAtIso: '2026-07-27T09:00:00.000Z',
  createdAtIso: '2026-07-27T09:00:01.000Z',
  doorPriceEur: 36.5,
  comparisonPriceEur: 42.9,
  discountAmountEur: 6.4,
  commissionEur: 30,
  ibanMasked: 'DE44 … 31',
  addressLine: null,
  advisorName: 'Max Mustermann',
  isDirectSign: false,
  repId: 'rep-1',
  gpsPresent: true,
  cancelledAtIso: null,
  ...overrides,
});

describe('deriveDetailState (banner/timeline lifecycle)', () => {
  it('is pending while queued, transferred once drained, cancelled after a Widerruf', () => {
    expect(deriveDetailState(detail(), true)).toBe('pending');
    expect(deriveDetailState(detail(), false)).toBe('transferred');
    expect(deriveDetailState(detail({ cancelledAtIso: '2026-08-01T00:00:00Z' }), true)).toBe(
      'cancelled',
    );
  });
});

describe('buildVerlauf (design SSOT 10b timeline)', () => {
  it('signed+encrypted are always done; the 3rd step waits while pending', () => {
    const steps = buildVerlauf(detail(), 'pending');
    expect(steps).toHaveLength(3);
    expect(steps[0]!.status).toBe('done');
    expect(steps[0]!.sublabel).toBe('GPS bestätigt');
    expect(steps[2]!.status).toBe('waiting');
  });

  it('marks the transfer step done once transferred, and shows the no-GPS sublabel', () => {
    const steps = buildVerlauf(detail({ gpsPresent: false }), 'transferred');
    expect(steps[0]!.sublabel).toBe('Ohne GPS erfasst');
    expect(steps[2]!.status).toBe('done');
  });
});

describe('pendingBannerText (relative "vor N Min.")', () => {
  const signed = '2026-07-27T09:00:00.000Z';
  const at = (min: number) => new Date('2026-07-27T09:00:00.000Z').getTime() + min * 60_000;

  it('renders just-now, minutes, and hours variants', () => {
    expect(pendingBannerText(signed, at(0))).toBe('Sync ausstehend · gerade eben');
    expect(pendingBannerText(signed, at(2))).toBe('Sync ausstehend · vor 2 Min.');
    expect(pendingBannerText(signed, at(150))).toBe('Sync ausstehend · vor 2 Std.');
  });

  it('never throws on a malformed signed-at timestamp', () => {
    expect(pendingBannerText('not-a-date', Date.now())).toBe('Sync ausstehend · gerade eben');
  });
});

describe('formatFullDate (locale-free DD.MM.YYYY)', () => {
  it('formats and degrades gracefully', () => {
    expect(formatFullDate('2026-08-10T00:00:00Z')).toBe('10.08.2026');
    expect(formatFullDate('nope')).toBe('nope');
  });
});

describe('buildDetailRows (a row with nothing to say is absent, not blanked)', () => {
  const labels = (rows: ReturnType<typeof buildDetailRows>) => rows.map((row) => row.label);

  it('keeps every row a fully-populated flow contract can actually fill', () => {
    const rows = buildDetailRows(detail());
    expect(labels(rows)).toEqual(['Produkt', 'Bankverbindung', 'Berater', 'Monatlich', 'Provision']);
    expect(rows.find((row) => row.label === 'Monatlich')?.value).toBe('36,50 € mtl.');
    expect(rows.find((row) => row.label === 'Bankverbindung')?.mono).toBe(true);
  });

  // houses.address exists (0083) but is unreachable from a contract: no
  // house_id, no draft reference. The row can never be filled, on any path.
  it('never emits the address row — a contract has no reachable house/draft link', () => {
    expect(labels(buildDetailRows(detail()))).not.toContain('Adresse');
    expect(labels(buildDetailRows(detail({ addressLine: null })))).not.toContain('Adresse');
  });

  it('omits bank and monthly rows for a direct-sign contract (neither has a source on that path)', () => {
    const rows = buildDetailRows(
      detail({ isDirectSign: true, ibanMasked: null, doorPriceEur: null, commissionEur: null }),
    );
    expect(labels(rows)).toEqual(['Produkt', 'Berater']);
  });

  it('never renders 0,00 € mtl. even if a direct-sign sentinel leaks through as a zero', () => {
    const rows = buildDetailRows(detail({ isDirectSign: true, doorPriceEur: 0 }));
    expect(rows.every((row) => !row.value.startsWith('0,00'))).toBe(true);
    expect(labels(rows)).not.toContain('Monatlich');
  });

  it('omits the advisor row when no name synced down, and the commission row when there is none', () => {
    expect(labels(buildDetailRows(detail({ advisorName: null })))).not.toContain('Berater');
    expect(labels(buildDetailRows(detail({ commissionEur: null })))).not.toContain('Provision');
  });

  it('never emits a null value or the — placeholder', () => {
    const variants = [
      detail(),
      detail({ advisorName: null, commissionEur: null }),
      detail({ isDirectSign: true, ibanMasked: null, doorPriceEur: null }),
      detail({ productName: null, advisorName: null, ibanMasked: null, doorPriceEur: null, commissionEur: null }),
    ];
    for (const variant of variants) {
      for (const row of buildDetailRows(variant)) {
        expect(typeof row.value).toBe('string');
        expect(row.value.length).toBeGreaterThan(0);
        expect(row.value).not.toBe('—');
      }
    }
  });

  it('marks only the final surviving row as last, so the card never draws a dangling divider', () => {
    for (const variant of [detail(), detail({ commissionEur: null }), detail({ isDirectSign: true })]) {
      const rows = buildDetailRows(variant);
      expect(rows.filter((row) => row.last)).toHaveLength(rows.length > 0 ? 1 : 0);
      if (rows.length > 0) expect(rows[rows.length - 1]!.last).toBe(true);
    }
  });

  it('returns an empty list rather than a card full of placeholders when nothing is fillable', () => {
    expect(
      buildDetailRows(
        detail({
          productName: null,
          ibanMasked: null,
          advisorName: null,
          doorPriceEur: null,
          commissionEur: null,
        }),
      ),
    ).toEqual([]);
  });
});
