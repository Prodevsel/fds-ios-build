import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// Node test environment (vitest.config.ts): ThemeProvider.tsx pulls in
// react-native (Flow-syntax source, unparseable under vitest/node) directly
// (for `Appearance`), and useThemeColors.ts transitively pulls in
// AccessibilityProvider.tsx (-> useSessionDb.ts -> native PowerSync/op-sqlite,
// settingsCache.ts -> react-native-mmkv, expo-localization) — mock every
// native import at the module boundary, mirroring ThemeProvider.test.tsx's /
// AccessibilityProvider.test.tsx's own precedent (this file imports the same
// pure exports, never mounting a provider or component — no
// react-native-testing-library in this repo).
//
// 13-04 addition: this file now ALSO imports pure functions directly from
// `EinstellungenScreen.tsx` itself (`deriveAutoLockControl`,
// `resolveAutoLockAccessibilityLabel`) — that module additionally imports
// react-native-safe-area-context, @react-navigation/native, @expo/vector-
// icons, expo-application and lib/auth/supabase at module scope for its JSX/
// hooks (never invoked here, this file never mounts a component), so those
// are stubbed too (ProfileEditScreen.test.tsx / FlowRunnerScreen.test.tsx
// precedent for importing a heavy screen module for its pure exports only).
vi.mock('react-native', () => ({
  Pressable: () => null,
  ScrollView: () => null,
  StyleSheet: { create: (styles: unknown) => styles },
  Switch: () => null,
  Text: () => null,
  View: () => null,
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: vi.fn() }) }));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
vi.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0', nativeBuildVersion: '1' }));
vi.mock('../../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('./settingsCache', () => ({
  createSettingsCache: () => ({ get: () => null, set: () => {} }),
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));
vi.mock('../../lib/auth/supabase', () => ({ getSupabase: vi.fn() }));

import { attachSettingsWatch, createSettingsSetters } from './useSettings';
import type { SettingsCache, SettingsSnapshot } from './settingsCache';
import type { SettingsRepo, UserSettings } from './db/settingsRepo';
import { resolveColorScheme } from './theme/ThemeProvider';
import { resolveThemeColors } from './theme/useThemeColors';
import { darkColors, lightColors } from '../../design/tokens';
import { deriveAutoLockControl, resolveAutoLockAccessibilityLabel } from './EinstellungenScreen';
import { AUTO_LOCK_TIMEOUT_MINUTES_OPTIONS } from './autoLockOptions';
import type { SettingRowState } from './settingRowState';

// Node test environment (vitest.config.ts): no react-native-testing-library in
// this repo (see useSettings.test.ts / ThemeProvider.test.tsx precedent) — the
// Erscheinungsbild picker's end-to-end wiring (SegmentedControl onChange ->
// setTheme -> repo.updateSettings -> watchSettings emission -> ThemeProvider's
// resolveColorScheme -> useThemeColors' resolveThemeColors) is exercised here
// by composing the exported pure/DI'd functions from useSettings.ts and
// ThemeProvider.tsx/useThemeColors.ts directly against fakes — this is a
// RENDERING assertion (asserts the resolved color object), not merely that a
// setter was called, so a break anywhere in that chain fails this suite
// (T-12-09-03).

function fakeCache(): SettingsCache {
  let stored: SettingsSnapshot | null = null;
  return {
    get: () => stored,
    set: (snapshot) => {
      stored = snapshot;
    },
  };
}

function fakeSettingsRow(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    id: 'rep-1',
    language: 'de',
    theme: 'system',
    textSize: 'default',
    highContrast: false,
    autoLockTimeoutMinutes: null,
    updatedAt: '2026-08-11T00:00:00.000Z',
    ...overrides,
  };
}

function fakeRepo(): SettingsRepo & {
  emit: (settings: UserSettings | null) => void;
  lastPatch: () => Record<string, unknown> | undefined;
} {
  let onChangeCb: ((settings: UserSettings | null) => void) | null = null;
  const updateSettings = vi.fn(async (_userId: string, patch: Record<string, unknown>) => {
    // Simulate the server round-trip landing back through watchSettings —
    // exactly what the real PowerSync-backed repo does once the write syncs.
    onChangeCb?.(fakeSettingsRow(patch as Partial<UserSettings>));
  });
  return {
    emit: (settings) => onChangeCb?.(settings),
    lastPatch: () => updateSettings.mock.calls.at(-1)?.[1] as Record<string, unknown> | undefined,
    getSettings: vi.fn(async () => null),
    ensureSettingsRow: vi.fn(async () => undefined),
    updateSettings,
    watchSettings: vi.fn((_userId, onChange) => {
      onChangeCb = onChange;
      return () => {
        onChangeCb = null;
      };
    }),
  };
}

describe('Erscheinungsbild picker wiring (SET-05): setTheme(dark) -> resolved dark palette', () => {
  it('picking "dark" resolves useThemeColors() to darkColors end-to-end', () => {
    const cache = fakeCache();
    const repo = fakeRepo();
    let snapshot: SettingsSnapshot | undefined;

    attachSettingsWatch({ cache, repo, userId: 'rep-1' }, (next) => {
      snapshot = next;
    });
    const setters = createSettingsSetters(repo, 'rep-1');

    // The SegmentedControl's onChange handler in EinstellungenScreen.tsx
    // calls exactly this setter.
    setters.setTheme('dark');

    expect(repo.lastPatch()).toEqual({ theme: 'dark' });
    expect(snapshot?.theme).toBe('dark');

    // ThemeProvider composes the persisted preference with the OS scheme —
    // an explicit 'dark' preference always wins, regardless of the OS value.
    const resolvedScheme = resolveColorScheme(snapshot?.theme ?? 'system', 'light');
    expect(resolvedScheme).toBe('dark');

    // useThemeColors() composes the resolved scheme (no force-light, no
    // high-contrast boost here) into the final rendered color object.
    const resolved = resolveThemeColors(resolvedScheme, false, false);
    expect(resolved).toBe(darkColors);
    expect(resolved).not.toBe(lightColors);
    expect(resolved.background).toBe(darkColors.background);
  });

  it('picking "light" resolves to lightColors even when the OS scheme is dark', () => {
    const cache = fakeCache();
    const repo = fakeRepo();
    let snapshot: SettingsSnapshot | undefined;

    attachSettingsWatch({ cache, repo, userId: 'rep-1' }, (next) => {
      snapshot = next;
    });
    const setters = createSettingsSetters(repo, 'rep-1');
    setters.setTheme('light');

    const resolvedScheme = resolveColorScheme(snapshot?.theme ?? 'system', 'dark');
    expect(resolvedScheme).toBe('light');
    expect(resolveThemeColors(resolvedScheme, false, false)).toBe(lightColors);
  });
});

describe('EinstellungenScreen.tsx source contract', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./EinstellungenScreen.tsx', import.meta.url)),
    'utf-8',
  );

  it('contains the Erscheinungsbild section key and wires setTheme', () => {
    expect(source).toContain('settings.appearanceSection');
    expect(source).toContain('setTheme');
  });

  it('does not import the deprecated flat `color` constant from design/tokens', () => {
    expect(source).not.toMatch(/import\s*\{[^}]*\bcolor\b[^}]*\}\s*from\s*'\.\.\/\.\.\/design\/tokens'/);
  });

  it('uses useThemeColors() + makeStyles(colors), matching the wave-6 convention', () => {
    expect(source).toContain('useThemeColors');
    expect(source).toMatch(/useMemo\(\(\) => makeStyles\(colors\)/);
  });

  // 13-04/SET-07 acceptance criteria — source-level structural proofs.
  it('contains the Sicherheit section key and the auto-lock row label', () => {
    expect(source).toContain('settings.securitySection');
    expect(source).toContain('settings.autoLockTimeoutLabel');
  });

  it('never applies a whole-control `disabled` prop to the auto-lock SegmentedControl — only disabledValues/disabledHint', () => {
    const securityBlockStart = source.indexOf('SICHERHEIT');
    const barrierefreiheitBlockStart = source.indexOf('BARRIEREFREIHEIT');
    expect(securityBlockStart).toBeGreaterThan(-1);
    expect(barrierefreiheitBlockStart).toBeGreaterThan(securityBlockStart);
    const securityBlock = source.slice(securityBlockStart, barrierefreiheitBlockStart);
    // `disabledValues`/`disabledHint` are expected; a bare `disabled={...}`
    // prop (whole-control disable) on the auto-lock SegmentedControl is not.
    expect(securityBlock).toContain('disabledValues');
    expect(securityBlock).not.toMatch(/\bdisabled=\{/);
  });

  // 14-08/T-14-08-04 acceptance criteria — the two new rep-owned navigation
  // rows (PasswortAendern/Sitzungen) live inside the SAME Sicherheit card as
  // the governed auto-lock row, but carry none of its lock-affordance
  // surface — the SET-06/D-17 discipline Phase 12/13 established for the
  // Barrierefreiheit block, structurally proven here for the new rows too.
  it('renders both new rows (change password, sessions) inside the Sicherheit card', () => {
    const securityBlockStart = source.indexOf('SICHERHEIT');
    const barrierefreiheitBlockStart = source.indexOf('BARRIEREFREIHEIT');
    const securityBlock = source.slice(securityBlockStart, barrierefreiheitBlockStart);
    expect(securityBlock).toContain("t('settings.changePasswordEntryLabel')");
    expect(securityBlock).toContain("t('settings.sessionsEntryLabel')");
    expect(securityBlock).toContain("navigation.navigate('PasswortAendern')");
    expect(securityBlock).toContain("navigation.navigate('Sitzungen')");
  });

  // SEC-03 (plan 15-06) acceptance criteria — the new App-Sperre entry row.
  it('renders exactly one new App-Sperre row, using the SAME menuRow style as "Passwort ändern", above it, with no accent color and no lock chip', () => {
    const securityBlockStart = source.indexOf('SICHERHEIT');
    const barrierefreiheitBlockStart = source.indexOf('BARRIEREFREIHEIT');
    const securityBlock = source.slice(securityBlockStart, barrierefreiheitBlockStart);

    expect(securityBlock).toContain("t('sec.appLockEntryLabel')");
    expect(securityBlock).toContain("navigation.navigate('AppSperre')");

    // Exactly one App-Sperre row (one `navigate('AppSperre')` call site),
    // positioned BEFORE the "Passwort ändern" row.
    const appLockRowIndex = securityBlock.indexOf("t('sec.appLockEntryLabel')");
    const changePasswordRowIndex = securityBlock.indexOf("t('settings.changePasswordEntryLabel')");
    expect(appLockRowIndex).toBeGreaterThan(-1);
    expect(changePasswordRowIndex).toBeGreaterThan(appLockRowIndex);
    const navigateCallCount = securityBlock.split("navigation.navigate('AppSperre')").length - 1;
    expect(navigateCallCount).toBe(1);

    // Same `menuRow`/`rowBordered` style pair as "Passwort ändern" — extract
    // the JSX block for each Pressable and compare their `style` props.
    const appLockPressableStart = securityBlock.lastIndexOf('<Pressable', appLockRowIndex);
    const appLockBlock = securityBlock.slice(appLockPressableStart, appLockRowIndex);
    const changePasswordPressableStart = securityBlock.lastIndexOf('<Pressable', changePasswordRowIndex);
    const changePasswordBlock = securityBlock.slice(changePasswordPressableStart, changePasswordRowIndex);
    expect(appLockBlock).toContain('style={[styles.menuRow, styles.rowBordered]}');
    expect(changePasswordBlock).toContain('style={[styles.menuRow, styles.rowBordered]}');

    // No accent color, no lock chip/affordance on the new row.
    const appLockRowEnd = securityBlock.indexOf('</Pressable>', appLockRowIndex);
    const appLockRowBlock = securityBlock.slice(appLockPressableStart, appLockRowEnd);
    for (const forbidden of ['LockAffordance', 'colors.accent', 'disabled={']) {
      expect(appLockRowBlock).not.toContain(forbidden);
    }
  });

  it('the two new navigation rows carry no lock/ceiling affordance, no disabled prop and no lock-copy key (D-17/SET-06)', () => {
    const changePasswordRowStart = source.indexOf("t('settings.changePasswordEntryLabel')");
    const barrierefreiheitBlockStart = source.indexOf('BARRIEREFREIHEIT');
    expect(changePasswordRowStart).toBeGreaterThan(-1);
    expect(barrierefreiheitBlockStart).toBeGreaterThan(changePasswordRowStart);
    // Slice from just before the first new row's opening <Pressable through
    // the end of the Sicherheit card (right up to the Barrierefreiheit
    // block) — covers both new rows.
    const newRowsBlock = source.slice(source.lastIndexOf('<Pressable', changePasswordRowStart), barrierefreiheitBlockStart);
    for (const forbidden of ['LockAffordance', 'disabledValues', 'markedValue', 'disabledHint', 'disabled={']) {
      expect(newRowsBlock).not.toContain(forbidden);
    }
  });

  // SEC-07 (plan 15-10) acceptance criteria — the new "Gerät zurücksetzen" row.
  it('renders exactly one "Gerät zurücksetzen" row, using the SAME menuRow style as "App-Sperre"/"Passwort ändern", with no accent color', () => {
    const securityBlockStart = source.indexOf('SICHERHEIT');
    const barrierefreiheitBlockStart = source.indexOf('BARRIEREFREIHEIT');
    const securityBlock = source.slice(securityBlockStart, barrierefreiheitBlockStart);

    expect(securityBlock).toContain("t('sec.wipeEntryLabel')");
    expect(securityBlock).toContain("navigation.navigate('GeraetZuruecksetzen')");

    const navigateCallCount = securityBlock.split("navigation.navigate('GeraetZuruecksetzen')").length - 1;
    expect(navigateCallCount).toBe(1);

    const wipeRowIndex = securityBlock.indexOf("t('sec.wipeEntryLabel')");
    const wipePressableStart = securityBlock.lastIndexOf('<Pressable', wipeRowIndex);
    const wipeBlock = securityBlock.slice(wipePressableStart, wipeRowIndex);
    // 15-13 addition: this row is no longer the LAST row in the card (a
    // fifth "Konto löschen beantragen" row now follows it) — it now carries
    // the SAME `[styles.menuRow, styles.rowBordered]` pair as its neighbours
    // above it, matching App-Sperre/Passwort-ändern/Sitzungen exactly.
    expect(wipeBlock).toContain('style={[styles.menuRow, styles.rowBordered]}');

    const wipeRowEnd = securityBlock.indexOf('</Pressable>', wipeRowIndex);
    const wipeRowBlock = securityBlock.slice(wipePressableStart, wipeRowEnd);
    for (const forbidden of ['LockAffordance', 'colors.accent', 'colors.destructive', 'disabled={']) {
      expect(wipeRowBlock).not.toContain(forbidden);
    }
  });

  // SEC-09 (plan 15-13) acceptance criteria — the new "Konto löschen
  // beantragen" row, the fifth and FINAL row in the Sicherheit card.
  it('renders exactly one "Konto löschen beantragen" row, using the SAME menuRow style as "Passwort ändern", with no accent or destructive color, as the LAST row in the card', () => {
    const securityBlockStart = source.indexOf('SICHERHEIT');
    const barrierefreiheitBlockStart = source.indexOf('BARRIEREFREIHEIT');
    const securityBlock = source.slice(securityBlockStart, barrierefreiheitBlockStart);

    expect(securityBlock).toContain("t('sec.deletionRequestTitle')");
    expect(securityBlock).toContain("navigation.navigate('KontoLoeschenAnfrage')");

    const navigateCallCount = securityBlock.split("navigation.navigate('KontoLoeschenAnfrage')").length - 1;
    expect(navigateCallCount).toBe(1);

    // Positioned AFTER "Gerät zurücksetzen" — the five-row order this plan's
    // own acceptance criteria fixes: App-Sperre, Passwort ändern, Sitzungen,
    // Gerät zurücksetzen, Konto löschen beantragen.
    const wipeRowIndex = securityBlock.indexOf("t('sec.wipeEntryLabel')");
    const deletionRowIndex = securityBlock.indexOf("t('sec.deletionRequestTitle')");
    expect(deletionRowIndex).toBeGreaterThan(wipeRowIndex);

    const deletionPressableStart = securityBlock.lastIndexOf('<Pressable', deletionRowIndex);
    const deletionBlock = securityBlock.slice(deletionPressableStart, deletionRowIndex);
    // Last row in the card — no trailing rowBordered, same style shape as
    // the OTHER rows' own `styles.menuRow` base object (App-Sperre/Passwort-
    // ändern/Sitzungen/Gerät-zurücksetzen all share this same object, only
    // this LAST row omits the trailing `rowBordered`).
    expect(deletionBlock).toContain('style={styles.menuRow}');

    const deletionRowEnd = securityBlock.indexOf('</Pressable>', deletionRowIndex);
    const deletionRowBlock = securityBlock.slice(deletionPressableStart, deletionRowEnd);
    for (const forbidden of ['LockAffordance', 'colors.accent', 'colors.destructive', 'disabled={']) {
      expect(deletionRowBlock).not.toContain(forbidden);
    }
  });

  // T-15-13 regression gate: the plan's own acceptance criteria assert the
  // Sicherheit card contains EXACTLY five rows in this exact order — a
  // future plan cannot silently add a sixth without this test failing.
  it('the Sicherheit card contains exactly five menuRow entries, in the fixed order: App-Sperre, Passwort ändern, Sitzungen, Gerät zurücksetzen, Konto löschen beantragen', () => {
    const securityBlockStart = source.indexOf('SICHERHEIT');
    const barrierefreiheitBlockStart = source.indexOf('BARRIEREFREIHEIT');
    const securityBlock = source.slice(securityBlockStart, barrierefreiheitBlockStart);

    const menuRowLabelKeys = [
      'sec.appLockEntryLabel',
      'settings.changePasswordEntryLabel',
      'settings.sessionsEntryLabel',
      'sec.wipeEntryLabel',
      'sec.deletionRequestTitle',
    ];

    const indices = menuRowLabelKeys.map((key) => {
      const label = `t('${key}')`;
      const first = securityBlock.indexOf(label);
      const occurrences = securityBlock.split(label).length - 1;
      return { key, first, occurrences };
    });

    // Every expected row is present exactly once as a menuRowLabel.
    for (const { key, first } of indices) {
      expect(first, `expected securityBlock to contain t('${key}')`).toBeGreaterThan(-1);
    }
    // No sixth row: exactly five distinct `<Pressable ... onPress={() =>
    // navigation.navigate(...)}` rows carrying a `menuRowLabel`-styled Text
    // inside the Sicherheit card.
    const pressableRowCount = (securityBlock.match(/style=\{(?:styles\.menuRow|\[styles\.menuRow, styles\.rowBordered\])\}/g) ?? []).length;
    expect(pressableRowCount).toBe(5);

    // Fixed order, ascending index.
    const sortedByPosition = [...indices].sort((a, b) => a.first - b.first);
    expect(sortedByPosition.map((entry) => entry.key)).toEqual(menuRowLabelKeys);
  });

  it('the Barrierefreiheit block itself carries no SET-07 lock-affordance surface (D-17 regression gate)', () => {
    const blockStart = source.indexOf('{/* BARRIEREFREIHEIT');
    const blockEnd = source.indexOf('{/* Abmelden */}');
    expect(blockStart).toBeGreaterThan(-1);
    expect(blockEnd).toBeGreaterThan(blockStart);
    const barrierefreiheitBlock = source.slice(blockStart, blockEnd);

    // Exactly the same two rows this block has always rendered (textSize
    // SegmentedControl + highContrast Switch) — no LockAffordance, no
    // disabledValues/markedValue/disabledHint, no rowState()/
    // deriveAutoLockControl call anywhere inside this block.
    expect(barrierefreiheitBlock).toContain("t('settings.textSizeLabel')");
    expect(barrierefreiheitBlock).toContain("t('settings.contrastLabel')");
    expect(barrierefreiheitBlock).toContain('settings.textSize');
    expect(barrierefreiheitBlock).toContain('settings.highContrast');
    for (const forbidden of [
      'LockAffordance',
      'disabledValues',
      'markedValue',
      'disabledHint',
      'rowState',
      'deriveAutoLockControl',
      'securitySection',
      'autoLockTimeoutLabel',
    ]) {
      expect(barrierefreiheitBlock).not.toContain(forbidden);
    }
  });
});

/**
 * 13-04/SET-07: `deriveAutoLockControl` composes `settingRowState.ts`'s
 * three-state derivation (13-03) into everything the Sicherheit row's
 * `<LockAffordance>` + `SegmentedControl` need — the SAME behaviors
 * documented in 13-UI-SPEC.md's Interaction Contract, tested here directly
 * against the pure function rather than a rendered component (no
 * react-native-testing-library in this repo).
 */
describe('deriveAutoLockControl (SET-07 Interaction Contract)', () => {
  it("state Free: every option at full opacity — no icon, no disabled options, no marked option", () => {
    const rowState: SettingRowState = { kind: 'free' };
    const derivation = deriveAutoLockControl(rowState);
    expect(derivation.affordanceState).toBe('free');
    expect(derivation.disabledValues).toEqual([]);
    expect(derivation.markedValue).toBeUndefined();
  });

  it("state Proposed: info-outline chip, but EVERY option (including looser ones) stays selectable — D-06 case 2", () => {
    const rowState: SettingRowState = { kind: 'proposed', value: '15' };
    const derivation = deriveAutoLockControl(rowState);
    expect(derivation.affordanceState).toBe('proposed');
    expect(derivation.disabledValues).toEqual([]);
    expect(derivation.markedValue).toBeUndefined();
    expect(derivation.fallbackValue).toBe(15);
  });

  it("state Ceiling/locked at 15 minutes: disabledValues is exactly ['30','60'] and markedValue is '15' (D-18 numeric compare)", () => {
    const rowState: SettingRowState = { kind: 'ceiling', value: '15' };
    const derivation = deriveAutoLockControl(rowState);
    expect(derivation.affordanceState).toBe('locked');
    expect(derivation.disabledValues).toEqual(['30', '60']);
    expect(derivation.markedValue).toBe('15');
    expect(derivation.fallbackValue).toBe(15);
  });

  it('the boundary option itself (the ceiling value) is NEVER in disabledValues — it stays selectable, only stricter/looser distinction applies', () => {
    const rowState: SettingRowState = { kind: 'ceiling', value: '15' };
    const derivation = deriveAutoLockControl(rowState);
    expect(derivation.disabledValues).not.toContain('15');
  });

  it('at the loosest ceiling (60 minutes) every option stays enabled — nothing is stricter than the loosest value', () => {
    const rowState: SettingRowState = { kind: 'ceiling', value: '60' };
    const derivation = deriveAutoLockControl(rowState);
    expect(derivation.disabledValues).toEqual([]);
    expect(derivation.markedValue).toBe('60');
  });

  it('at the strictest ceiling (1 minute) every OTHER option is disabled', () => {
    const rowState: SettingRowState = { kind: 'ceiling', value: '1' };
    const derivation = deriveAutoLockControl(rowState);
    expect(derivation.disabledValues).toEqual(
      AUTO_LOCK_TIMEOUT_MINUTES_OPTIONS.filter((minutes) => minutes > 1).map(String),
    );
  });
});

/**
 * D-17/SET-06 regression gate — the screen-level companion to 13-03's
 * `settingRowState.test.ts` proof: even a forged/hypothetical policy row
 * naming an accessibility key (text_size/high_contrast) can never reach
 * `deriveAutoLockControl`, because `deriveSettingRowState` (13-03) is typed
 * to accept ONLY a `LockableSettingKey` — `text_size`/`high_contrast` are
 * excluded from that type at compile time, so this screen's `rowState()`
 * call site (`settings.rowState('auto_lock_timeout_minutes')`) can never be
 * satisfied by an accessibility-keyed row's derived state in the first
 * place. This test proves the practical consequence at the UI-composition
 * layer this plan owns: even if a caller mistakenly fed an accessibility
 * row's-shaped ceiling/proposed state into `deriveAutoLockControl` (the one
 * function this screen actually renders through), the Barrierefreiheit rows
 * never call this function at all — `TEXT_SIZE_OPTIONS`/`highContrast`
 * render through the plain `settings.textSize`/`settings.highContrast`
 * values only, with no `rowState()`/`deriveAutoLockControl` call anywhere in
 * their JSX (proved structurally above, "Barrierefreiheit block is byte-
 * identical"). This test additionally proves the affordance itself renders
 * nothing when handed the SAME kind of state a forged accessibility row
 * would produce, so even a future refactor that accidentally wired the
 * Barrierefreiheit rows through this derivation would still render no icon,
 * no chip and no disabled options for the 'free' baseline case.
 */
describe('D-17/SET-06 regression gate — accessibility rows never gain a lock affordance', () => {
  it('a forged accessibility-shaped free state still resolves to the fully-open Free treatment', () => {
    const forgedFreeState: SettingRowState = { kind: 'free' };
    const derivation = deriveAutoLockControl(forgedFreeState);
    expect(derivation.affordanceState).toBe('free');
    expect(derivation.disabledValues).toEqual([]);
    expect(derivation.markedValue).toBeUndefined();
  });

  it('EinstellungenScreen.tsx never calls rowState()/deriveAutoLockControl anywhere inside the Barrierefreiheit block', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./EinstellungenScreen.tsx', import.meta.url)),
      'utf-8',
    );
    const blockStart = source.indexOf('{/* BARRIEREFREIHEIT');
    const blockEnd = source.indexOf('{/* Abmelden */}');
    const barrierefreiheitBlock = source.slice(blockStart, blockEnd);
    expect(barrierefreiheitBlock).not.toContain('rowState');
    expect(barrierefreiheitBlock).not.toContain('deriveAutoLockControl');
    expect(barrierefreiheitBlock).not.toContain('LockAffordance');
  });
});

describe('resolveAutoLockAccessibilityLabel (screen-reader icon+chip combination)', () => {
  it("state Free: just the row label, no chip text appended", () => {
    expect(resolveAutoLockAccessibilityLabel('free')).toBe('Automatische Sperre');
  });

  it("state Proposed: label + proposedByOrgBadge combined into ONE string", () => {
    expect(resolveAutoLockAccessibilityLabel('proposed')).toBe(
      'Automatische Sperre. von Ihrer Organisation vorgeschlagen',
    );
  });

  it("state Locked: label + lockedByOrgBadge combined into ONE string", () => {
    expect(resolveAutoLockAccessibilityLabel('locked')).toBe(
      'Automatische Sperre. von Ihrer Organisation vorgegeben',
    );
  });
});
