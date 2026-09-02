import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Node test environment (vitest.config.ts): never load native RN/Expo
// modules; this repo never mounts a React renderer (no react-test-renderer
// dependency, see StatusSheet.test.tsx) — only pure/exported logic is under
// test here, plus source-scan assertions for structural claims (rows are
// non-interactive Views, no hardcoded copy), mirroring MapScreen.test.tsx's
// established pattern for this exact class of claim.
vi.mock('react-native', () => ({
  FlatList: () => null,
  View: () => null,
  Text: () => null,
  Pressable: () => null,
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
// ContractListScreen.tsx transitively imports the ui/ primitives, which
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
vi.mock('../flow-runner/db/contractsRepo', () => ({
  createContractsRepo: vi.fn(),
  // Real, pure set-membership check (no native surface) so deriveContractRowState
  // resolves correctly under test.
  deriveContractSyncState: (id: string, pendingIds: ReadonlySet<string> | readonly string[]) => {
    const set = pendingIds instanceof Set ? pendingIds : new Set(pendingIds);
    return set.has(id) ? 'pending' : 'synced';
  },
  // Real, pure too: `extractPendingContractIds` moved here from
  // ContractListScreen.tsx (it belongs next to deriveContractSyncState — one
  // D-22 derivation, two halves) and is re-exported from the screen, so this
  // whole-module mock has to keep supplying it.
  extractPendingContractIds: (crudEntries: ReadonlyArray<{ table: string; id: string }>) =>
    new Set(crudEntries.filter((entry) => entry.table === 'contracts').map((entry) => entry.id)),
}));

import type { ContractListRow } from '../flow-runner/db/contractsRepo';
import {
  buildSubtitle,
  deriveContractRowState,
  extractPendingContractIds,
  formatShortDate,
  formatSignedAt,
  matchesFilter,
  monthLabel,
  statusLineFor,
  syncPillKeyFor,
  widerrufDeadlineIso,
} from './ContractListScreen';

const listRow = (overrides: Partial<ContractListRow> = {}): ContractListRow => ({
  id: 'c1',
  dealReference: 'FDS-20260723-AB12CD34',
  customerName: 'Erika Muster',
  productName: 'strom-24',
  signedAtIso: '2026-07-23T09:00:00.000Z',
  doorPriceEur: 36.5,
  cancelledAtIso: null,
  ...overrides,
});

describe('deriveContractRowState + matchesFilter (design SSOT 10 status/filter)', () => {
  it('classifies pending (in queue), transferred (drained), and cancelled (Widerruf)', () => {
    expect(deriveContractRowState(listRow(), new Set(['c1']))).toBe('pending');
    expect(deriveContractRowState(listRow(), new Set())).toBe('transferred');
    expect(deriveContractRowState(listRow({ cancelledAtIso: '2026-08-01T00:00:00Z' }), new Set(['c1']))).toBe(
      'cancelled',
    );
  });

  it('filters: Alle keeps all, Offen keeps pending, Übertragen keeps transferred+cancelled', () => {
    expect(matchesFilter('pending', 'all')).toBe(true);
    expect(matchesFilter('pending', 'open')).toBe(true);
    expect(matchesFilter('transferred', 'open')).toBe(false);
    expect(matchesFilter('transferred', 'transferred')).toBe(true);
    expect(matchesFilter('cancelled', 'transferred')).toBe(true);
  });
});

describe('subtitle + status line + date helpers', () => {
  it('builds "{Monat} · {n} Verträge · {k} offen" (singular/plural aware)', () => {
    expect(buildSubtitle([listRow()], 1)).toBe('Juli · 1 Vertrag · 1 offen');
    expect(buildSubtitle([listRow(), listRow({ id: 'c2' })], 0)).toBe('Juli · 2 Verträge · 0 offen');
  });

  it('renders the transferred status line with a signed_at + 14d Widerruf deadline', () => {
    const line = statusLineFor(listRow(), 'transferred');
    expect(line).toContain('Übertragen');
    expect(line).toContain('Widerruf bis 06.08.'); // 2026-07-23 + 14d = 2026-08-06
  });

  it('renders the pending and cancelled status lines', () => {
    expect(statusLineFor(listRow(), 'pending')).toBe('Sync ausstehend');
    expect(statusLineFor(listRow({ cancelledAtIso: '2026-08-01T10:00:00Z' }), 'cancelled')).toContain(
      '01.08.',
    );
  });

  it('widerrufDeadlineIso adds 14 days; formatShortDate/monthLabel are locale-free', () => {
    expect(widerrufDeadlineIso('2026-07-23T09:00:00.000Z').slice(0, 10)).toBe('2026-08-06');
    expect(formatShortDate('2026-08-06T00:00:00Z')).toBe('06.08.');
    expect(monthLabel('2026-07-23T09:00:00.000Z')).toBe('Juli');
    expect(monthLabel('not-a-date')).toBe('');
  });
});

describe('extractPendingContractIds (D-22, pure)', () => {
  it('keeps only contracts-table ids', () => {
    const ids = extractPendingContractIds([
      { table: 'contracts', id: 'c1' },
      { table: 'houses', id: 'h1' },
      { table: 'contracts', id: 'c2' },
    ]);
    expect(ids).toEqual(new Set(['c1', 'c2']));
  });

  it('returns an empty set for an empty batch', () => {
    expect(extractPendingContractIds([])).toEqual(new Set());
  });
});

describe('formatSignedAt', () => {
  it('formats an ISO timestamp as DD.MM.YYYY HH:MM', () => {
    expect(formatSignedAt('2026-07-23T09:05:00.000Z')).toMatch(/^\d{2}\.\d{2}\.2026 \d{2}:\d{2}$/);
  });

  it('never throws on a malformed timestamp — returns the input verbatim', () => {
    expect(formatSignedAt('not-a-date')).toBe('not-a-date');
  });
});

describe('syncPillKeyFor', () => {
  it('maps pending/synced to the reused syncPill i18n keys (D-22 — no new copy)', () => {
    expect(syncPillKeyFor('pending')).toBe('syncPill.pending');
    expect(syncPillKeyFor('synced')).toBe('syncPill.synced');
  });
});

describe('ContractListScreen source contract (D-18 UI-SPEC)', () => {
  const rawSource = readFileSync(
    fileURLToPath(new URL('./ContractListScreen.tsx', import.meta.url)),
    'utf-8',
  );
  // Strip comments before scanning for code-level claims (hardcoded copy,
  // .complete() calls) — doc comments legitimately reference these terms in
  // prose (e.g. "never .complete()'d here", "Meine Abschlüsse") without that
  // being the code claim under test.
  const source = rawSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('renders rows as tappable Pressables into the Abschluss-Detail when onOpenDetail is wired', () => {
    // \r?\n: tolerate CRLF working copies (core.autocrlf=true on Windows)
    const rowFn = source.match(/function ContractRow\([\s\S]*?\r?\n}\r?\n/);
    expect(rowFn).not.toBeNull();
    // A row is a Pressable only when an onPress handler is supplied (the map
    // overlay can leave rows non-interactive); the screen passes onOpenDetail.
    expect(rowFn![0]).toMatch(/Pressable/);
    expect(rowFn![0]).toMatch(/onPress/);
    expect(source).toMatch(/onOpenDetail/);
  });

  it('renders the empty state using the exact German i18n keys + a "Zur Karte" CTA', () => {
    expect(source).toContain('emptyState.noContractsHeading');
    expect(source).toContain('emptyState.noContractsBody');
    expect(source).toContain('abschluesse.emptyCta');
  });

  it('trusts watchContracts ordering — never re-sorts/reverses rows itself (filtering only)', () => {
    expect(source).not.toMatch(/rows\.(sort|reverse)\(/);
    expect(source).toMatch(/data=\{visibleRows\}/);
  });

  it('never calls .complete() on the read-only crud batch peek (T-04-20 append-only)', () => {
    expect(source).not.toMatch(/\.complete\(/);
  });

  it('has no hardcoded German copy — every user-facing string goes through t()', () => {
    const germanWords = ['Abschlüsse', 'Kunde', 'Synchronisiert', 'Ausstehend'];
    for (const word of germanWords) {
      expect(source).not.toContain(word);
    }
  });
});
