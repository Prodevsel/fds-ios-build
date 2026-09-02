import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// Node test environment (vitest.config.ts): no react-native-testing-library
// in this repo (see EinstellungenScreen.test.tsx / LockAffordance.test.tsx
// precedent) — test the extracted pure functions and a source-contract
// scan directly, never mount `SessionsScreen`. `SessionsScreen.tsx` also
// imports react-native/react-native-safe-area-context/@react-navigation/
// native/@expo/vector-icons/lib/auth/supabase at module scope for its JSX
// (never invoked by this file), so those are stubbed the same way.
vi.mock('react-native', () => ({
  ActivityIndicator: () => null,
  Modal: () => null,
  Pressable: () => null,
  ScrollView: () => null,
  StyleSheet: { create: (styles: unknown) => styles },
  Text: () => null,
  View: () => null,
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: vi.fn() }) }));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
vi.mock('../../lib/auth/supabase', () => ({ getSupabase: vi.fn() }));
// useThemeColors() transitively pulls AccessibilityProvider.tsx (->
// useSessionDb.ts -> native PowerSync/op-sqlite, settingsCache.ts ->
// react-native-mmkv, expo-localization) — same chain EinstellungenScreen.
// test.tsx already stubs; never invoked by this file (no component mount).
vi.mock('../../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('./settingsCache', () => ({
  createSettingsCache: () => ({ get: () => null, set: () => {} }),
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));
// AppLockProvider.tsx transitively pulls expo-secure-store/expo-crypto
// (pinHash.ts) and AppState-based timers (autoLock/*.ts) — none of which
// this file's module-scope-only import chain (no component mount) needs.
// Stub the one export SessionsScreen.tsx actually uses (`useAppLock`,
// `LockReason` is a type, erased at runtime).
vi.mock('../app-lock/AppLockProvider', () => ({
  useAppLock: () => ({ lock: vi.fn() }),
}));

import { confirmRevokeSession, deriveConfirmTier, deriveRowState } from './SessionsScreen';
import type { SessionRow } from './db/sessionsRepo';
import { compositeOver, contrastRatio } from '../../design/contrast';
import { getColors } from '../../design/tokens';

const CURRENT_SESSION: Pick<SessionRow, 'id' | 'isCurrent'> = { id: 'session-current', isCurrent: true };
const OTHER_SESSION: Pick<SessionRow, 'id' | 'isCurrent'> = { id: 'session-other', isCurrent: false };

describe('deriveConfirmTier', () => {
  it("returns 'modal' exactly when is_current is true", () => {
    expect(deriveConfirmTier(CURRENT_SESSION)).toBe('modal');
    expect(deriveConfirmTier(OTHER_SESSION)).toBe('inline');
  });
});

describe('deriveRowState', () => {
  it("returns 'idle' when neither pending nor confirming", () => {
    expect(deriveRowState(OTHER_SESSION, new Set(), null)).toBe('idle');
  });

  it("returns 'confirming' when confirmingId matches the session id", () => {
    expect(deriveRowState(OTHER_SESSION, new Set(), 'session-other')).toBe('confirming');
  });

  it("returns 'idle' when confirmingId matches a DIFFERENT session id", () => {
    expect(deriveRowState(OTHER_SESSION, new Set(), 'session-current')).toBe('idle');
  });

  it("returns 'revoking' when the session id is in pendingRevokeIds", () => {
    expect(deriveRowState(OTHER_SESSION, new Set(['session-other']), null)).toBe('revoking');
  });

  it("'revoking' (pendingRevokeIds) wins over 'confirming' — a row mid-revoke never reverts to a confirm prompt", () => {
    expect(deriveRowState(OTHER_SESSION, new Set(['session-other']), 'session-other')).toBe('revoking');
  });

  it('works identically for the current-device session (tier selection is a SEPARATE function)', () => {
    expect(deriveRowState(CURRENT_SESSION, new Set(), 'session-current')).toBe('confirming');
    expect(deriveRowState(CURRENT_SESSION, new Set(['session-current']), null)).toBe('revoking');
  });
});

describe('confirmRevokeSession (D-16/WR-08)', () => {
  it('revoking the CURRENT session calls lock(\'session-revoked\') exactly once, after the revoke RPC resolves', async () => {
    const calls: string[] = [];
    const revokeSession = vi.fn(async () => {
      calls.push('revokeSession');
    });
    const lock = vi.fn((reason: string) => {
      calls.push(`lock:${reason}`);
    });

    await confirmRevokeSession({ repo: { revokeSession }, lock, id: 'session-current', isCurrent: true });

    expect(revokeSession).toHaveBeenCalledTimes(1);
    expect(revokeSession).toHaveBeenCalledWith('session-current');
    expect(lock).toHaveBeenCalledTimes(1);
    expect(lock).toHaveBeenCalledWith('session-revoked');
    // Order: revoke resolves BEFORE lock fires, never the reverse.
    expect(calls).toEqual(['revokeSession', 'lock:session-revoked']);
  });

  it('revoking a NON-current session does not call lock', async () => {
    const revokeSession = vi.fn(async () => {});
    const lock = vi.fn();

    await confirmRevokeSession({ repo: { revokeSession }, lock, id: 'session-other', isCurrent: false });

    expect(revokeSession).toHaveBeenCalledTimes(1);
    expect(lock).not.toHaveBeenCalled();
  });

  it('if the revoke RPC rejects, lock is never called (even for the current session)', async () => {
    const revokeSession = vi.fn(async () => {
      throw new Error('network error');
    });
    const lock = vi.fn();

    await expect(
      confirmRevokeSession({ repo: { revokeSession }, lock, id: 'session-current', isCurrent: true }),
    ).rejects.toThrow('network error');
    expect(lock).not.toHaveBeenCalled();
  });
});

describe('SessionsScreen.tsx source contract', () => {
  const source = readFileSync(fileURLToPath(new URL('./SessionsScreen.tsx', import.meta.url)), 'utf-8');

  it('renders sessions.revokingState after a successful revoke — never a completed/instant-revocation state (D-07 forbidden copy)', () => {
    expect(source).toContain('sessions.revokingState');
    // Forbidden copy per 14-UI-SPEC.md's "Forbidden copy" row: any variant of
    // a completed "revoked" state presented as instant/finished, scoped to
    // actual rendered/user-facing copy — NOT the D-16/WR-08 `LockReason`
    // literal `'session-revoked'` (an internal identifier, never displayed)
    // or this file's own comment prose, which legitimately discusses
    // "revoked" sessions when documenting D-16's lock-on-revoke behavior.
    const withoutComments = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const withoutLockReasonLiteral = withoutComments.replace(/'session-revoked'/g, '');
    expect(withoutLockReasonLiteral).not.toMatch(/revoked/i);
    expect(source).not.toMatch(/beendet\b/); // "Wird beendet" (in-progress) is fine; a bare "beendet" completion claim is not present either way
    expect(source).not.toMatch(/erfolgreich/i);
    expect(source).not.toMatch(/Widerrufen\s*✓/);
  });

  it('renders the standing sessions.latencyExplainer banner (D-07 — a standing property, not a toast)', () => {
    expect(source).toContain('sessions.latencyExplainer');
  });

  it('never truncates the raw user-agent text (`numberOfLines` grep gate)', () => {
    const matches = source.match(/numberOfLines/g) ?? [];
    expect(matches).toHaveLength(0);
  });

  it('renders sessions.ipUnavailable for a null ip, never a blank cell', () => {
    expect(source).toContain('sessions.ipUnavailable');
  });

  it('uses the heavier modal copy keys for the current-device tier and the lighter inline keys for the non-current tier', () => {
    expect(source).toContain('sessions.revokeCurrentConfirmTitle');
    expect(source).toContain('sessions.revokeCurrentConfirmBody');
    expect(source).toContain('sessions.revokeCurrentConfirmCta');
    expect(source).toContain('sessions.revokeConfirmInline');
    expect(source).toContain('sessions.revokeConfirmCta');
  });

  it('never force-navigates after a current-device revoke — only one documented onAuthStateChange comment, no navigation.reset/navigate call added for sign-out', () => {
    expect(source).toContain('onAuthStateChange');
    expect(source).not.toMatch(/navigation\.(navigate|reset|replace)\(/);
  });
});

/**
 * T-14-07 contrast obligation (14-UI-SPEC.md § Accessibility Contract): the
 * raw-user-agent text on `colors.subtleFill` is a NEW colour pairing this
 * phase introduces. `colors.subtleFill` is a translucent fill that only
 * ever renders nested on a concrete card surface (`colors.surface`), so it
 * is flattened with `compositeOver` first (12-07/13-04 precedent,
 * LockAffordance.test.tsx) rather than measured against `contrastRatio`'s
 * default white backdrop.
 *
 * Computed ratios (recorded here and in the plan's SUMMARY):
 *   light: textSecondary (#5C6B85) vs subtleFill-on-surface (#F1F2F3) = ~4.81:1
 *   dark:  textSecondary (#A9B4CC) vs subtleFill-on-surface (#28334A) = ~6.07:1
 * Both clear the 4.5:1 AA floor.
 */
describe('user-agent block contrast floor (T-14-07-Task2)', () => {
  it('textSecondary vs the subtleFill block clears 4.5:1 in light theme', () => {
    const colors = getColors('light');
    const blockBackground = compositeOver(colors.subtleFill, colors.surface);
    expect(contrastRatio(colors.textSecondary, blockBackground)).toBeGreaterThanOrEqual(4.5);
  });

  it('textSecondary vs the subtleFill block clears 4.5:1 in dark theme', () => {
    const colors = getColors('dark');
    const blockBackground = compositeOver(colors.subtleFill, colors.surface);
    expect(contrastRatio(colors.textSecondary, blockBackground)).toBeGreaterThanOrEqual(4.5);
  });
});
