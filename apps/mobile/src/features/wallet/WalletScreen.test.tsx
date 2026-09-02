import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// Node test environment (vitest.config.ts): never load native RN/Expo modules —
// this repo never mounts a React renderer (no react-test-renderer dependency,
// see ContractListScreen.test.tsx / MapScreen.test.tsx). Only pure/exported
// logic is under test here, plus source-scan assertions for structural claims
// (reversed rows never filtered, no hardcoded hex), mirroring that established
// pattern. Mock every native import WalletScreen.tsx transitively pulls in.
vi.mock('react-native', () => ({
  FlatList: () => null,
  View: () => null,
  Text: () => null,
  Pressable: () => null,
  StyleSheet: { create: (styles: unknown) => styles },
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
// Safe-area boundary mock: this file transitively imports a checkout screen
// (quick task 260827-f98 made those screens call useSafeAreaInsets()), and
// react-native-safe-area-context's real entry point is unparseable under the
// node test env. Zero insets keep every asserted value at its prior baseline.
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
// WalletScreen.tsx transitively imports the ui/ primitives, which (since
// 12-08) call useThemeColors() -> ThemeProvider/AccessibilityProvider's own
// native deps — mocked here too (AccessibilityProvider.test.tsx precedent).
vi.mock('../../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('../settings/settingsCache', () => ({
  createSettingsCache: () => ({ get: () => null, set: () => {} }),
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));
// formatSignedAt is imported from ContractListScreen, which transitively imports
// contractsRepo -> expo-crypto (native) — mock it (mirrors walletRepo.test.ts).
vi.mock('expo-crypto', () => ({
  digestStringAsync: vi.fn(),
  randomUUID: vi.fn(),
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
}));
// getServerTimeAnchorFromSession lives in FlowRunnerScreen.tsx (heavy native
// chain: camera/signature/maps) — replace the whole module so it never loads.
vi.mock('../flow-runner/FlowRunnerScreen', () => ({
  getServerTimeAnchorFromSession: vi.fn(async () => null),
}));
vi.mock('../../lib/auth/supabase', () => ({ getSupabase: vi.fn() }));

import { WALLET_STATE_LABEL_KEY, buildWalletView } from './WalletScreen';
import type { WalletDeal } from './db/walletRepo';

// Deterministic anchor: 2026-07-27T12:00:00Z. WIDERRUF = 14 days.
const NOW_MS = Date.parse('2026-07-27T12:00:00.000Z');

const fixture: WalletDeal[] = [
  {
    id: 'd-secured',
    dealReference: 'A-100',
    customerName: 'Anna Sicher',
    signedAtIso: '2026-07-07T09:00:00.000Z', // 20 days ago -> secured
    commissionEur: 100,
    cancelledAtIso: null,
  },
  {
    id: 'd-review',
    dealReference: 'A-200',
    customerName: 'Bea Prüfung',
    signedAtIso: '2026-07-24T09:00:00.000Z', // 3 days ago -> in_review
    commissionEur: 200,
    cancelledAtIso: null,
  },
  {
    id: 'd-reversed',
    dealReference: 'A-300',
    customerName: 'Cem Widerruf',
    signedAtIso: '2026-07-22T09:00:00.000Z', // cancelled -> reversed
    commissionEur: 50,
    cancelledAtIso: '2026-07-25T09:00:00.000Z',
  },
];

describe('buildWalletView — 3 KPIs (WALT-01, D-04/D-10)', () => {
  it('computes all three KPI figures against the injected anchor', () => {
    const view = buildWalletView(fixture, NOW_MS);
    // All three deals signed this calendar month, any state (D-04).
    expect(view.kpis.dealsThisMonth).toBe(3);
    // Secured euro total = only the secured deal (D-10); reversed excluded.
    expect(view.kpis.securedEur).toBe('100,00 €');
    // Under-review euro total = only the in_review deal.
    expect(view.kpis.underReviewEur).toBe('200,00 €');
  });

  it('reversed deals contribute to NEITHER euro total (D-01)', () => {
    const view = buildWalletView(fixture, NOW_MS);
    // 50 (reversed) never lands in secured or under-review.
    expect(view.kpis.securedEur).not.toContain('150');
    expect(view.kpis.underReviewEur).not.toContain('250');
  });
});

describe('buildWalletView — per-deal list with reversal visibility (D-01/D-03)', () => {
  it('emits a row for EVERY deal, including the reversed one (never filtered)', () => {
    const view = buildWalletView(fixture, NOW_MS);
    expect(view.rows).toHaveLength(3);
    const reversed = view.rows.find((r) => r.id === 'd-reversed');
    expect(reversed).toBeDefined();
    expect(reversed?.state).toBe('reversed');
  });

  it('derives each row state from the anchor (secured vs in_review)', () => {
    const view = buildWalletView(fixture, NOW_MS);
    expect(view.rows.find((r) => r.id === 'd-secured')?.state).toBe('secured');
    expect(view.rows.find((r) => r.id === 'd-review')?.state).toBe('in_review');
  });

  it('formats each commission de-DE and renders "—" for a null amount', () => {
    const withNull: WalletDeal[] = [
      {
        id: 'd-null',
        dealReference: 'A-000',
        customerName: 'Dana Null',
        signedAtIso: '2026-07-07T09:00:00.000Z',
        commissionEur: null,
        cancelledAtIso: null,
      },
    ];
    const view = buildWalletView(withNull, NOW_MS);
    expect(view.rows[0]?.commissionLabel).toBe('—');
    expect(buildWalletView(fixture, NOW_MS).rows[0]?.commissionLabel).toBe('100,00 €');
  });
});

describe('buildWalletView — empty state', () => {
  it('returns zeroed KPIs and no rows for []', () => {
    const view = buildWalletView([], NOW_MS);
    expect(view.rows).toHaveLength(0);
    expect(view.kpis.dealsThisMonth).toBe(0);
    expect(view.kpis.securedEur).toBe('0,00 €');
    expect(view.kpis.underReviewEur).toBe('0,00 €');
  });
});

describe('WALLET_STATE_LABEL_KEY', () => {
  it('maps every wallet state to a distinct wallet.* i18n key', () => {
    expect(WALLET_STATE_LABEL_KEY.in_review).toBe('wallet.stateInReview');
    expect(WALLET_STATE_LABEL_KEY.secured).toBe('wallet.stateSecured');
    expect(WALLET_STATE_LABEL_KEY.reversed).toBe('wallet.stateReversed');
  });
});

describe('WalletScreen source contract (D-01 transparency, tokens, wiring)', () => {
  const rawSource = readFileSync(
    fileURLToPath(new URL('./WalletScreen.tsx', import.meta.url)),
    'utf-8',
  );
  // Strip comments before code-level scans (prose legitimately mentions hex /
  // "filter" etc.), mirroring ContractListScreen.test.tsx.
  const source = rawSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('never filters deals by state — reversed rows stay visible (D-01)', () => {
    expect(source).not.toMatch(/\.filter\([^)]*reversed/);
    expect(source).not.toMatch(/!==\s*['"]reversed['"]/);
  });

  it('has no hardcoded hex colors — every color via design tokens', () => {
    expect(source).not.toMatch(/#[0-9A-Fa-f]{6}/);
    expect(source).toContain('walletStateColor');
  });

  it('subscribes reactively via walletRepo.watchWallet (D-05)', () => {
    expect(source).toContain('watchWallet');
    expect(source).toContain('createWalletRepo');
  });

  it('anchors the 14-day boundary on the server-time JWT iat, not the raw clock', () => {
    expect(source).toContain('getServerTimeAnchorFromSession');
    expect(source).toMatch(/Math\.max\(/);
  });

  it('routes all user-facing copy through t() (no hardcoded German)', () => {
    const germanWords = ['Provision', 'Gesichert', 'Prüfung', 'Widerruf', 'Abschlüsse'];
    for (const word of germanWords) {
      expect(source).not.toContain(word);
    }
  });
});
