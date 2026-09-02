import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Application from 'expo-application';
import type { AbstractPowerSyncDatabase } from '@powersync/common';
import { radius, spacing, statusColor, typography } from '../../design/tokens';
import { t } from '../../i18n';
import { DbBoundary } from '../../app/DbBoundary';
import type { ProfilStackParamList } from '../../app/navigation';
import { getSupabase } from '../../lib/auth/supabase';
import { formatTimeHHmm } from '../../lib/datetime/format';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { createTerritoriesRepo, type AssignableTerritoryRow } from '../map/db/territoriesRepo';
import { useSessionIdentity } from '../profile/useSessionIdentity';
import { AUTO_LOCK_TIMEOUT_MINUTES_OPTIONS, type AutoLockTimeoutMinutes } from './autoLockOptions';
import { LockAffordance, type LockAffordanceState } from './LockAffordance';
import type { SettingRowState } from './settingRowState';
import { useThemeColors } from './theme/useThemeColors';
import { createSettingsCache } from './settingsCache';
import { createSettingsRepo, type TextSize } from './db/settingsRepo';
import type { Theme } from './db/settingsRepo';
import { createSettingsPolicyRepo } from './db/settingsPolicyRepo';
import { useSettings } from './useSettings';
import { useSyncStatus } from './useSyncStatus';

const TEXT_SIZE_OPTIONS: ReadonlyArray<{ value: TextSize; label: string }> = [
  { value: 'default', label: t('settings.textSizeDefault') },
  { value: 'large', label: t('settings.textSizeLarge') },
  { value: 'extra_large', label: t('settings.textSizeExtraLarge') },
];

/** Rep-facing UI language only (SET-02, D-05). Never conflated with document/
 * jurisdiction formatting — see the "reserved, unrendered" note below. */
const LANGUAGE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'de', label: t('settings.languageValueDe') },
  { value: 'en', label: t('settings.languageValueEn') },
];

/** System / Hell / Dunkel (SET-05, D-13) — wired to `useSettings().setTheme`. */
const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: 'system', label: t('settings.themeSystem') },
  { value: 'light', label: t('settings.themeLight') },
  { value: 'dark', label: t('settings.themeDark') },
];

/**
 * SET-07/D-01/D-18: the closed {1, 5, 15, 30, 60}-minute auto-lock value set
 * (`autoLockOptions.ts`, 13-02), rendered here as `SegmentedControl<string>`
 * options — `SegmentedControl` requires `T extends string`, so each numeric
 * minute value is stringified ONLY at this UI boundary; every derivation
 * below (`deriveAutoLockControl`) stays numeric internally, matching
 * `settingRowState.ts`'s own D-18 numeric-compare discipline.
 */
const AUTO_LOCK_TIMEOUT_LABELS: Record<AutoLockTimeoutMinutes, string> = {
  1: t('settings.autoLockTimeoutValue1'),
  5: t('settings.autoLockTimeoutValue5'),
  15: t('settings.autoLockTimeoutValue15'),
  30: t('settings.autoLockTimeoutValue30'),
  60: t('settings.autoLockTimeoutValue60'),
};

const AUTO_LOCK_TIMEOUT_OPTIONS: ReadonlyArray<{ value: string; label: string }> =
  AUTO_LOCK_TIMEOUT_MINUTES_OPTIONS.map((minutes) => ({
    value: String(minutes),
    label: AUTO_LOCK_TIMEOUT_LABELS[minutes],
  }));

/**
 * No rep-chosen value yet AND no org policy either (State 1: Free) — a
 * reasonable, documented middle-of-the-range default so the control always
 * has a selected option. Claude's discretion (13-UI-SPEC.md does not specify
 * one): 5 minutes, matching the value set's own second-shortest option.
 */
const DEFAULT_AUTO_LOCK_TIMEOUT_MINUTES: AutoLockTimeoutMinutes = 5;

export interface AutoLockControlDerivation {
  /** Drives `<LockAffordance state={...} />` above the control. */
  affordanceState: LockAffordanceState;
  /** `SegmentedControl`'s `disabledValues` — every option stricter-than-or-equal-to a ceiling is NEVER in this set. */
  disabledValues: readonly string[];
  /** `SegmentedControl`'s `markedValue` — the ceiling option itself, or undefined outside the ceiling state. */
  markedValue: string | undefined;
  /** Pre-selected value when the rep has never written their own choice yet (State 2/3's "pre-selected" rule). */
  fallbackValue: AutoLockTimeoutMinutes;
}

/**
 * Pure: turns this key's three-state `SettingRowState` (`settingRowState.ts`,
 * 13-03) into everything `<LockAffordance>` + the `SegmentedControl` row need
 * to render (13-UI-SPEC.md § Interaction Contract).
 *
 * - free: no icon/chip, no disabled options, no marked option.
 * - proposed (D-06 case 2 — never true for `auto_lock_timeout_minutes` in
 *   this phase per 13-UI-SPEC.md, but handled for completeness/future
 *   lockable keys reusing this same derivation shape): no disabled options
 *   EVER — a deviating write must never be blocked (D-06) — the proposed
 *   value is only the pre-selected fallback.
 * - ceiling: every option strictly greater than the ceiling (D-18: shorter
 *   minutes = stricter, numeric compare) is disabled; the ceiling option
 *   itself is `markedValue` and is the pre-selected fallback (always a safe,
 *   allowed choice).
 */
export function deriveAutoLockControl(rowState: SettingRowState): AutoLockControlDerivation {
  if (rowState.kind === 'free') {
    return {
      affordanceState: 'free',
      disabledValues: [],
      markedValue: undefined,
      fallbackValue: DEFAULT_AUTO_LOCK_TIMEOUT_MINUTES,
    };
  }

  if (rowState.kind === 'proposed') {
    return {
      affordanceState: 'proposed',
      disabledValues: [],
      markedValue: undefined,
      fallbackValue: (Number(rowState.value) as AutoLockTimeoutMinutes) || DEFAULT_AUTO_LOCK_TIMEOUT_MINUTES,
    };
  }

  const ceiling = Number(rowState.value) as AutoLockTimeoutMinutes;
  const disabledValues = AUTO_LOCK_TIMEOUT_MINUTES_OPTIONS.filter((minutes) => minutes > ceiling).map(String);
  return {
    affordanceState: 'locked',
    disabledValues,
    markedValue: String(ceiling),
    fallbackValue: ceiling,
  };
}

/**
 * Pure: the row-level `accessibilityLabel` combining the row title and the
 * chip text into ONE string, so a screen reader does not encounter the icon
 * and chip as disconnected elements (13-UI-SPEC.md § Accessibility Contract).
 */
export function resolveAutoLockAccessibilityLabel(affordanceState: LockAffordanceState): string {
  const label = t('settings.autoLockTimeoutLabel');
  if (affordanceState === 'free') return label;
  const badge =
    affordanceState === 'proposed' ? t('settings.proposedByOrgBadge') : t('settings.lockedByOrgBadge');
  return `${label}. ${badge}`;
}

/**
 * Einstellungen (design SSOT screen 15): SYNC status + "Jetzt synchronisieren",
 * OFFLINE-KARTEN, BENACHRICHTIGUNGEN toggles, Sprache & Region (SET-02),
 * Barrierefreiheit (SET-06), "Abmelden" (gated on a drained queue), and the
 * version footer. Real data: session email, live PowerSync pending-queue
 * count + last-sync time, the loaded territory name, and the
 * expo-application version/build. The map-tile size and notification
 * preferences have no backing store yet (honest placeholder / local-only
 * toggles). Abmelden calls the real `supabase.auth.signOut()` and is disabled
 * until every write is transferred (design: "Erst möglich, wenn alles
 * übertragen ist").
 */
export function EinstellungenScreen() {
  return <DbBoundary>{(db, userId) => <EinstellungenContent db={db} userId={userId} />}</DbBoundary>;
}

function EinstellungenContent({ db, userId }: { db: AbstractPowerSyncDatabase; userId: string | null }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<ProfilStackParamList, 'Einstellungen'>>();
  const identity = useSessionIdentity();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { pendingCount, lastSyncedAtIso, retryUpload } = useSyncStatus(db);
  const [territories, setTerritories] = useState<AssignableTerritoryRow[]>([]);
  const [signingOut, setSigningOut] = useState(false);
  const [settingsError, setSettingsError] = useState(false);
  const [autoLockTimeoutMinutes, setAutoLockTimeoutMinutes] = useState<AutoLockTimeoutMinutes | null>(null);
  const [autoLockError, setAutoLockError] = useState(false);

  useEffect(() => {
    const repo = createTerritoriesRepo({ db });
    return repo.watchAssignableTerritories(setTerritories);
  }, [db]);

  const settingsCache = useMemo(() => createSettingsCache(), []);
  const settingsRepo = useMemo(() => createSettingsRepo({ db }), [db]);
  const settingsPolicyRepo = useMemo(() => createSettingsPolicyRepo({ db }), [db]);
  const settings = useSettings({ cache: settingsCache, repo: settingsRepo, userId, policyRepo: settingsPolicyRepo });

  // The rep's OWN chosen `auto_lock_timeout_minutes` (never MMKV-cached,
  // mirroring `settings.policies`' own live-only discipline) — a second,
  // independent watch of the same synced `user_settings` row `settings`
  // above already subscribes to, since `SettingsSnapshot`/`useSettings()`
  // deliberately excludes this column (SET-01's cached snapshot is
  // theme/language/accessibility only). Coexists safely with the other
  // `db.watch` subscriptions on this screen (territories, sync status).
  useEffect(() => {
    if (!userId) return;
    return settingsRepo.watchSettings(userId, (row) => setAutoLockTimeoutMinutes(row?.autoLockTimeoutMinutes ?? null));
  }, [settingsRepo, userId]);

  const handleTextSizeChange = (value: TextSize) => {
    setSettingsError(false);
    try {
      settings.setTextSize(value);
    } catch {
      setSettingsError(true);
    }
  };

  const handleHighContrastChange = (value: boolean) => {
    setSettingsError(false);
    try {
      settings.setHighContrast(value);
    } catch {
      setSettingsError(true);
    }
  };

  const handleLanguageChange = (value: string) => {
    setSettingsError(false);
    try {
      settings.setLanguage(value);
    } catch {
      setSettingsError(true);
    }
  };

  const handleThemeChange = (value: Theme) => {
    setSettingsError(false);
    try {
      settings.setTheme(value);
    } catch {
      setSettingsError(true);
    }
  };

  // SET-07/T-13-04-02: a stale ceiling that tightened between render and
  // write must never strand the rep — `settings.ceilingRejected` surfaces
  // through the SAME error-text mechanism as `settingsError` above, and the
  // row re-renders with the now-current ceiling automatically the moment the
  // live policy subscription (`settings.rowState`, composed via
  // `settingsPolicyRepo` above) re-emits — no dead end, no second toast
  // mechanism invented here.
  const autoLockRowState = settings.rowState('auto_lock_timeout_minutes');
  const autoLockDerivation = deriveAutoLockControl(autoLockRowState);
  const selectedAutoLockValue = String(autoLockTimeoutMinutes ?? autoLockDerivation.fallbackValue);

  const handleAutoLockTimeoutChange = async (value: string) => {
    if (!userId) return;
    setAutoLockError(false);
    const minutes = Number(value) as AutoLockTimeoutMinutes;
    try {
      await settingsRepo.updateSettings(userId, { autoLockTimeoutMinutes: minutes });
    } catch {
      setAutoLockError(true);
    }
  };

  const isSynced = pendingCount === 0;
  const pendingWord = pendingCount === 1 ? t('settings.pendingOne') : t('settings.pendingMany');
  const syncTitle = isSynced
    ? t('settings.allSynced')
    : `${t('settings.offlineWord')} · ${pendingCount} ${pendingWord}`;
  const lastSyncValue = lastSyncedAtIso
    ? formatTimeHHmm(lastSyncedAtIso)
    : t('settings.lastSyncNever');
  const loadedTerritory = territories.find((tr) => tr.boundary) ?? territories[0] ?? null;
  const version = Application.nativeApplicationVersion ?? '—';
  const build = Application.nativeBuildVersion ?? '—';

  const handleSignOut = async () => {
    if (!isSynced || signingOut) return;
    setSigningOut(true);
    try {
      await getSupabase().auth.signOut();
      // The RootNavigator auth listener swaps to the Login screen on sign-out.
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <View style={styles.container} testID="einstellungen-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={() => navigation.goBack()}
          hitSlop={8}
        >
          <MaterialCommunityIcons name="chevron-left" size={26} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>{t('settings.title')}</Text>
          {identity.email ? <Text style={styles.email}>{identity.email}</Text> : null}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* SYNC */}
        <View style={styles.card}>
          <SectionLabel label={t('settings.syncSection')} />
          <View style={styles.syncRow}>
            <View style={[styles.iconTile, { backgroundColor: isSynced ? 'rgba(22,163,74,0.12)' : 'rgba(217,119,6,0.14)' }]}>
              <MaterialCommunityIcons
                name={isSynced ? 'check' : 'sync'}
                size={18}
                color={isSynced ? statusColor.success : statusColor.follow_up}
              />
            </View>
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle}>{syncTitle}</Text>
              <Text style={styles.rowMeta}>
                {`${t('settings.lastSyncLabel')} ${lastSyncValue}`}
              </Text>
            </View>
          </View>
          <View style={styles.syncCtaWrap}>
            <Pressable style={styles.syncButton} accessibilityRole="button" onPress={retryUpload}>
              <MaterialCommunityIcons name="sync" size={18} color={colors.onAccent} />
              <Text style={styles.syncButtonText}>{t('settings.syncNowCta')}</Text>
            </Pressable>
          </View>
        </View>

        {/* OFFLINE-KARTEN */}
        <View style={styles.card}>
          <SectionLabel label={t('settings.offlineMapsSection')} />
          <View style={styles.mapRow}>
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle}>{loadedTerritory?.name ?? t('settings.offlineMapEmpty')}</Text>
              <Text style={styles.rowMeta}>{t('settings.offlineMapSizeUnknown')}</Text>
            </View>
          </View>
        </View>

        {/* BENACHRICHTIGUNGEN — no notification pipeline exists yet, so these are
            honest disabled rows ("Noch nicht verfügbar") rather than live toggles
            that would imply an active pipeline and silently reset each mount. */}
        <View style={styles.card}>
          <SectionLabel label={t('settings.notificationsSection')} />
          <ToggleRow label={t('settings.notifToggleMain')} />
          <ToggleRow label={t('settings.notifQuietHours')} last />
        </View>

        {/* SPRACHE & REGION (SET-02, D-05/D-06). Rep-facing UI language only —
            writes through useSettings().setLanguage immediately, no Save
            button, matching every other toggle on this screen. Contract/
            jurisdiction formatting (D-09/D-10) is deliberately NOT rendered
            anywhere near this section: `companies.document_locale` is
            tenant-scoped and lives only on the server-side PDF renderer
            (MAND-02 keeps `companies` an unsynced table, so that value never
            reaches a device). The reserved `settings.document...` key group
            in de.json/en.json (see 12-UI-SPEC.md's Document-Formatting
            Display Contract) exists only as a naming reservation for a later
            phase and is intentionally unused here — do not wire it up
            without first reading a real tenant-scoped value server-side. */}
        <View style={styles.card}>
          <SectionLabel label={t('settings.languageSection')} />
          <View style={styles.accessibilityRow}>
            <Text style={styles.rowTitle}>{t('settings.languageLabel')}</Text>
            <SegmentedControl
              options={LANGUAGE_OPTIONS}
              value={settings.language}
              onChange={handleLanguageChange}
              accessibilityLabel={t('settings.languageLabel')}
            />
          </View>
        </View>

        {/* ERSCHEINUNGSBILD (SET-05, D-13). Writes through
            useSettings().setTheme immediately, no Save button, matching every
            other toggle on this screen. `ThemeProvider` (mounted app-wide in
            RootNavigator) resolves the persisted preference into the actual
            rendered scheme — see ThemeProvider.tsx's `resolveColorScheme`. */}
        <View style={styles.card}>
          <SectionLabel label={t('settings.appearanceSection')} />
          <View style={styles.accessibilityRow}>
            <Text style={styles.rowTitle}>{t('settings.themeLabel')}</Text>
            <SegmentedControl
              options={THEME_OPTIONS}
              value={settings.theme}
              onChange={handleThemeChange}
              accessibilityLabel={t('settings.themeLabel')}
            />
          </View>
        </View>

        {/* SICHERHEIT (SET-07, D-01/D-03/D-15/D-16/D-18). The one lockable row
            this phase ships end-to-end: `auto_lock_timeout_minutes`.
            Structurally copies the Barrierefreiheit block's `styles.card` +
            `SectionLabel` + `styles.accessibilityRow` idiom (NOT
            `styles.toggleRow`, which is Switch-only) plus a `LockAffordance`
            decoration above the control, per 13-UI-SPEC.md's Interaction
            Contract. D-15: the row is ALWAYS visible and labelled — a
            ceiling dims individual past-boundary options via
            `SegmentedControl`'s `disabledValues`, it never disables the
            control as a whole. */}
        <View style={styles.card}>
          <SectionLabel label={t('settings.securitySection')} />
          <View
            style={styles.accessibilityRow}
            accessibilityLabel={resolveAutoLockAccessibilityLabel(autoLockDerivation.affordanceState)}
          >
            <Text style={styles.rowTitle}>{t('settings.autoLockTimeoutLabel')}</Text>
            <LockAffordance state={autoLockDerivation.affordanceState} />
            <SegmentedControl
              options={AUTO_LOCK_TIMEOUT_OPTIONS}
              value={selectedAutoLockValue}
              onChange={(value) => void handleAutoLockTimeoutChange(value)}
              accessibilityLabel={t('settings.autoLockTimeoutLabel')}
              disabledValues={autoLockDerivation.disabledValues}
              disabledHint={t('settings.ceilingOptionHint')}
              markedValue={autoLockDerivation.markedValue}
            />
          </View>
          {autoLockError ? <Text style={styles.settingsErrorText}>{t('settings.ceilingRejected')}</Text> : null}

          {/* SEC-03 (plan 15-06): App-Sperre entry row — the SAME `menuRow`
              treatment as its neighbours below (64dp, chevron,
              colors.textSecondary, no accent, no badge). Placed ABOVE
              "Passwort ändern" per 15-UI-SPEC.md §9's Screen Inventory row
              order. Navigates to PIN setup/biometric enrollment
              (AppLockSetupScreen), never itself shows "gesperrt" copy. */}
          <Pressable
            style={[styles.menuRow, styles.rowBordered]}
            accessibilityRole="button"
            accessibilityLabel={t('sec.appLockEntryLabel')}
            onPress={() => navigation.navigate('AppSperre')}
          >
            <MaterialCommunityIcons name="shield-lock-outline" size={20} color={colors.textPrimary} />
            <Text style={styles.menuRowLabel}>{t('sec.appLockEntryLabel')}</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textSecondary} />
          </Pressable>
          {/* SEC-02/SEC-06 (plan 14-08): two plain navigation rows into the
              SAME Sicherheit card — rep-owned actions (change password /
              manage sessions), never governed settings. NO lock glyph, NO
              LockAffordance chip, NO "managed by your organisation" copy and
              NO disabled state: the SET-06/D-17 discipline the
              Barrierefreiheit block below already establishes applies here
              identically, and the `lockable_setting_key` Postgres enum
              structurally excludes both anyway (neither key exists in it). */}
          <Pressable
            style={[styles.menuRow, styles.rowBordered]}
            accessibilityRole="button"
            accessibilityLabel={t('settings.changePasswordEntryLabel')}
            onPress={() => navigation.navigate('PasswortAendern')}
          >
            <MaterialCommunityIcons name="lock-reset" size={20} color={colors.textPrimary} />
            <Text style={styles.menuRowLabel}>{t('settings.changePasswordEntryLabel')}</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            style={[styles.menuRow, styles.rowBordered]}
            accessibilityRole="button"
            accessibilityLabel={t('settings.sessionsEntryLabel')}
            onPress={() => navigation.navigate('Sitzungen')}
          >
            <MaterialCommunityIcons name="cellphone-link" size={20} color={colors.textPrimary} />
            <Text style={styles.menuRowLabel}>{t('settings.sessionsEntryLabel')}</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textSecondary} />
          </Pressable>
          {/* SEC-07 (plan 15-10, D-01/D-04): local drain-then-purge wipe entry
              — SAME menuRow treatment as its neighbours (64dp, chevron,
              colors.textSecondary, no accent, no badge). The row itself is
              never disabled-looking (Phase 13's fixed "reads as coming soon"
              defect) — tapping it always navigates; LocalWipeScreen itself
              renders the blocked/blocked-unverified-path states honestly. */}
          <Pressable
            style={[styles.menuRow, styles.rowBordered]}
            accessibilityRole="button"
            accessibilityLabel={t('sec.wipeEntryLabel')}
            onPress={() => navigation.navigate('GeraetZuruecksetzen')}
          >
            <MaterialCommunityIcons name="cellphone-remove" size={20} color={colors.textPrimary} />
            <Text style={styles.menuRowLabel}>{t('sec.wipeEntryLabel')}</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textSecondary} />
          </Pressable>
          {/* SEC-09 (plan 15-13): account-deletion REQUEST entry — the fifth
              and LAST row in the Sicherheit card. SAME menuRow treatment as
              every row above (64dp, chevron, colors.textSecondary, no
              accent, no destructive tint) — an entry point is never accent-
              or destructive-coloured in this app; the honesty/consequence
              lives entirely on AccountDeletionRequestScreen itself, not on
              this row. This is NOT a delete button — it opens a screen that
              files a request and states the org-managed/retention facts. */}
          <Pressable
            style={styles.menuRow}
            accessibilityRole="button"
            accessibilityLabel={t('sec.deletionRequestTitle')}
            onPress={() => navigation.navigate('KontoLoeschenAnfrage')}
          >
            <MaterialCommunityIcons name="account-remove-outline" size={20} color={colors.textPrimary} />
            <Text style={styles.menuRowLabel}>{t('sec.deletionRequestTitle')}</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>

        {/* BARRIEREFREIHEIT (SET-06, D-14). BOTH rows below are rep-owned and
            structurally unlockable: the `lockable_setting_key` Postgres enum
            (0070_user_settings.sql) has NO value for text_size/high_contrast,
            so no future admin ceiling can ever apply to them. Per the
            Admin-Lock Affordance Contract, these rows must ALWAYS render at
            full opacity with no lock glyph, no "managed by" chip and no
            `disabled` prop — if a future diff adds any of that here, it is a
            regression to catch in review, not an intended feature. */}
        <View style={styles.card}>
          <SectionLabel label={t('settings.accessibilitySection')} />
          <View style={[styles.accessibilityRow, styles.rowBordered]}>
            <Text style={styles.rowTitle}>{t('settings.textSizeLabel')}</Text>
            <SegmentedControl
              options={TEXT_SIZE_OPTIONS}
              value={settings.textSize}
              onChange={handleTextSizeChange}
              accessibilityLabel={t('settings.textSizeLabel')}
            />
          </View>
          <View style={styles.toggleRow}>
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle}>{t('settings.contrastLabel')}</Text>
              <Text style={styles.rowMeta}>{t('settings.contrastHint')}</Text>
            </View>
            <Switch
              value={settings.highContrast}
              onValueChange={handleHighContrastChange}
              accessibilityLabel={t('settings.contrastLabel')}
              accessibilityState={{ checked: settings.highContrast }}
              trackColor={{ true: colors.accent, false: colors.borderStrong }}
              thumbColor={colors.surface}
            />
          </View>
          {settingsError ? <Text style={styles.settingsErrorText}>{t('settings.saveErrorGeneric')}</Text> : null}
        </View>

        {/* Abmelden */}
        <Pressable
          style={[styles.signOutCard, !isSynced ? styles.signOutDisabled : null]}
          accessibilityRole="button"
          accessibilityState={{ disabled: !isSynced }}
          disabled={!isSynced || signingOut}
          onPress={() => void handleSignOut()}
        >
          <View style={styles.signOutIcon}>
            <MaterialCommunityIcons name="logout" size={18} color={colors.destructive} />
          </View>
          <View style={styles.rowMain}>
            <Text style={[styles.rowTitle, styles.signOutText]}>{t('settings.signOut')}</Text>
            <Text style={styles.rowMeta}>
              {isSynced ? t('settings.signOutReady') : t('settings.signOutBlocked')}
            </Text>
          </View>
        </Pressable>

        <Text style={styles.version}>{`${t('auth.wordmark')} ${version} · Build ${build}`}</Text>
      </ScrollView>
    </View>
  );
}

function SectionLabel({ label }: { label: string }) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.sectionLabelWrap}>
      <Text style={styles.sectionLabel}>{label}</Text>
    </View>
  );
}

/**
 * A notification preference row. There is no notification pipeline yet, so the
 * row is deliberately disabled with a "Noch nicht verfügbar" note — an honest
 * placeholder, never a live toggle implying an active (nonexistent) pipeline.
 */
function ToggleRow({ label, last }: { label: string; last?: boolean }) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.toggleRow, last ? null : styles.rowBordered]}>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle}>{label}</Text>
        <Text style={styles.rowMeta}>{t('settings.notifNotAvailable')}</Text>
      </View>
      <Switch
        value={false}
        disabled
        trackColor={{ true: statusColor.success, false: colors.borderStrong }}
        thumbColor={colors.surface}
      />
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  backButton: {
    width: spacing.touchTarget,
    height: spacing.touchTarget,
    borderRadius: radius.input,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, minWidth: 0 },
  title: { ...typography.display, color: colors.textPrimary },
  email: { ...typography.label, color: colors.textSecondary, marginTop: spacing.xs - 2 },
  content: { paddingHorizontal: spacing.md + spacing.xs, paddingBottom: spacing.xl, gap: spacing.md - 2 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  sectionLabelWrap: {
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm + spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sectionLabel: {
    ...typography.label,
    fontWeight: '600',
    color: colors.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md - 4,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iconTile: { width: 36, height: 36, borderRadius: radius.md - 1, alignItems: 'center', justifyContent: 'center' },
  rowMain: { flex: 1, minWidth: 0 },
  rowTitle: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  rowMeta: { ...typography.label, color: colors.textSecondary, marginTop: 1 },
  syncCtaWrap: { padding: spacing.md },
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm + 2,
    height: 52,
    borderRadius: radius.input,
    backgroundColor: colors.ink,
  },
  syncButtonText: { ...typography.heading, fontSize: 16, color: colors.onAccent },
  mapRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md - 4, padding: spacing.md },
  toggleRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowBordered: { borderBottomWidth: 1, borderBottomColor: colors.border },
  accessibilityRow: {
    minHeight: 64,
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: spacing.sm + spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  menuRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md - 2,
    paddingHorizontal: spacing.md,
  },
  menuRowLabel: { ...typography.body, fontWeight: '600', color: colors.textPrimary, flex: 1, minWidth: 0 },
  settingsErrorText: {
    ...typography.label,
    color: colors.destructive,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm + spacing.xs,
  },
  signOutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md - 4,
    minHeight: 64,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  signOutDisabled: { opacity: 0.55 },
  signOutIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md - 1,
    backgroundColor: 'rgba(220,38,38,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutText: { color: colors.textPrimary },
  version: { ...typography.mono, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
  });
}
