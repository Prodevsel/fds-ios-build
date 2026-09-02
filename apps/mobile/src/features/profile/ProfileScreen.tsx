import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { AbstractPowerSyncDatabase } from '@powersync/common';
import { lightColors, radius, spacing, statusColor, typography } from '../../design/tokens';
import { t } from '../../i18n';
import { Card } from '../../ui/Card';
import { MonoChip } from '../../ui/MonoChip';
import { DbBoundary } from '../../app/DbBoundary';
import { getSupabase } from '../../lib/auth/supabase';
import { monthNameDe } from '../../lib/datetime/format';
import { formatEur } from '../wallet/formatEur';
import { createAppointmentsRepo, type Appointment } from '../termine/db/appointmentsRepo';
import { createHousesRepo, type HouseRow } from '../map/db/housesRepo';
import { createTerritoriesRepo, type AssignableTerritoryRow } from '../map/db/territoriesRepo';
import type { ProfilStackParamList } from '../../app/navigation';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { AVATARS_BUCKET } from './db/avatarUpload';
import { createProfileRepo, type ContractStat } from './db/profileRepo';
import { buildProfileKpis, buildTerritoryRows, type TerritoryRowView } from './profileView';
import { useSessionIdentity } from './useSessionIdentity';

type ProfilNav = NativeStackNavigationProp<ProfilStackParamList, 'Profil'>;

/**
 * Profil tab (design SSOT screen 13). Header (JW avatar + name + role · Gebiet +
 * gear), four KPI tiles, the dark Haustürkodex "Pflichtangaben" card, and the
 * territory rows — all wired to real synced data (contracts, appointments,
 * houses, territories) plus the Supabase session identity. The two figures with
 * no backing data are honest placeholders, never faked: Ziel/target and Quote
 * ("Abschlussquote", BACKEND-GAP-CLOSURE 4.4 — no lost/attempted denominator),
 * and the Berater-ID/VPKN (no such column exists in the schema yet).
 */
export function ProfileScreen() {
  return <DbBoundary>{(db, userId) => <ProfileContent db={db} repId={userId ?? ''} />}</DbBoundary>;
}

function ProfileContent({ db, repId }: { db: AbstractPowerSyncDatabase; repId: string }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<ProfilNav>();
  const identity = useSessionIdentity();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [nowMs] = useState<number>(() => Date.now());
  const [contractStats, setContractStats] = useState<ContractStat[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [houses, setHouses] = useState<HouseRow[]>([]);
  const [territories, setTerritories] = useState<AssignableTerritoryRow[]>([]);
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [avatarSignedUrl, setAvatarSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!repId) return;
    const unsubs = [
      createProfileRepo({ db }).watchContractStats(repId, setContractStats),
      createAppointmentsRepo({ db }).watchAppointments(repId, setAppointments),
      createHousesRepo({ db }).watchHouses(setHouses),
      createTerritoriesRepo({ db }).watchAssignableTerritories(setTerritories),
    ];
    return () => unsubs.forEach((u) => u());
  }, [db, repId]);

  // avatar_url lives on the LOCAL synced app_users table (12-13/12-14) — a
  // reactive watch so an edit made on ProfileEditScreen shows up here
  // immediately, same idiom as the KPI/appointments/houses watches above.
  useEffect(() => {
    if (!repId) return;
    const controller = new AbortController();
    db.watch(
      'SELECT avatar_url FROM app_users WHERE id = ?',
      [repId],
      {
        onResult: (result) => {
          const rows = (result.rows?._array ?? []) as Array<{ avatar_url: string | null }>;
          setAvatarPath(rows[0]?.avatar_url || null);
        },
      },
      { signal: controller.signal },
    );
    return () => controller.abort();
  }, [db, repId]);

  // The avatars bucket is private (0073) — resolve a short-lived signed URL
  // at DISPLAY time only, never persist it (T-12-14-05).
  useEffect(() => {
    if (!avatarPath) {
      setAvatarSignedUrl(null);
      return;
    }
    let cancelled = false;
    void getSupabase()
      .storage.from(AVATARS_BUCKET)
      .createSignedUrl(avatarPath, 3600)
      .then(({ data }: { data: { signedUrl: string } | null }) => {
        if (!cancelled) setAvatarSignedUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [avatarPath]);

  const kpis = buildProfileKpis(contractStats, appointments, houses, repId, nowMs);
  const territoryRows = buildTerritoryRows(territories, houses, repId);
  const activeName = territoryRows.find((r) => r.isActive)?.name ?? null;
  const displayName = identity.fullName ?? identity.email ?? '';
  const roleLine = activeName ? `${t('profile.role')} · ${activeName}` : t('profile.role');
  const dash = t('profile.metricUnavailable');
  const followupSub =
    kpis.followupsToday > 0
      ? `${kpis.followupsToday} ${t('profile.followupsDueToday')}`
      : t('profile.followupsNoneToday');

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.sm }]}
      testID="profile-screen"
    >
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={styles.avatar}>
          {avatarSignedUrl ? (
            <Image source={{ uri: avatarSignedUrl }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarText}>{identity.initials}</Text>
          )}
        </View>
        <View style={styles.headerText}>
          <Text style={styles.name} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={styles.role} numberOfLines={1}>
            {roleLine}
          </Text>
        </View>
        <Pressable
          style={styles.gearButton}
          accessibilityRole="button"
          accessibilityLabel={t('profile.settingsLabel')}
          onPress={() => navigation.navigate('Einstellungen')}
        >
          <MaterialCommunityIcons name="cog-outline" size={21} color={colors.textPrimary} />
        </Pressable>
      </View>

      {/* KPI grid */}
      <View style={styles.kpiGrid}>
        <KpiTile
          label={`${t('profile.kpiDealsLabel')} ${monthNameDe(nowMs)}`}
          value={String(kpis.dealsThisMonth)}
          sub={`${t('profile.targetLabel')} ${dash}`}
        />
        <KpiTile
          label={t('profile.quoteLabel')}
          value={dash}
          sub={`${kpis.doorsWorked} ${t('profile.doorsWorked')}`}
        />
        <KpiTile
          label={t('profile.followupsLabel')}
          value={String(kpis.followupsTotal)}
          sub={followupSub}
          accent
        />
        <KpiTile
          label={t('profile.volumeLabel')}
          value={formatEur(kpis.monthlyVolumeEur)}
          sub={t('profile.volumeSubline')}
        />
      </View>

      {/* Haustürkodex · Pflichtangaben */}
      <View style={styles.kodexCard}>
        <View style={styles.kodexBadge}>
          <MaterialCommunityIcons name="shield-lock-outline" size={13} color="rgba(255,255,255,0.78)" />
          <Text style={styles.kodexBadgeText}>{t('profile.kodexTitle')}</Text>
        </View>
        <KodexRow label={t('profile.beraterIdLabel')} value={t('profile.identityMissing')} />
        <KodexRow label={t('profile.vpknLabel')} value={t('profile.identityMissing')} last />
        <Pressable
          style={styles.kodexCta}
          accessibilityRole="button"
          onPress={() => navigation.navigate('BeraterAusweis')}
        >
          <MaterialCommunityIcons name="badge-account-horizontal-outline" size={19} color={colors.onAccent} />
          <Text style={styles.kodexCtaText}>{t('profile.showAusweisCta')}</Text>
        </Pressable>
      </View>

      {/* Territories */}
      <Card style={styles.territoryCard} padded={false}>
        {territoryRows.length === 0 ? (
          <View style={styles.territoryEmpty}>
            <Text style={styles.territoryEmptyTitle}>{t('profile.territoriesEmptyHeading')}</Text>
            <Text style={styles.territoryEmptyBody}>{t('profile.territoriesEmptyBody')}</Text>
          </View>
        ) : (
          territoryRows.map((row, index) => (
            <TerritoryRow key={row.id} row={row} first={index === 0} />
          ))
        )}
      </Card>

      {/* Menu — the entry points into the screens reached from Profil (design
          SSOT screen 13 tab: Provisionen/Aktuelles/Suche/Einstellungen, plus
          the Phase-9 Bestenliste, plus the Phase-12 profile edit form,
          D-01/D-02/D-04). Without these rows the Wallet/Aktuelles/Suche/
          Leaderboard/ProfilEdit screens ship unreachable. */}
      <Card style={styles.menuCard} padded={false}>
        <MenuRow
          icon="account-edit-outline"
          label={t('settings.profileEntryLabel')}
          onPress={() => navigation.navigate('ProfilEdit')}
          first
        />
        <MenuRow
          icon="wallet-outline"
          label={t('profile.menuWallet')}
          onPress={() => navigation.navigate('Wallet')}
        />
        <MenuRow
          icon="trophy-outline"
          label={t('profile.menuLeaderboard')}
          onPress={() => navigation.navigate('Leaderboard')}
        />
        <MenuRow
          icon="bell-outline"
          label={t('profile.menuAktuelles')}
          onPress={() => navigation.navigate('Aktuelles')}
        />
        <MenuRow
          icon="magnify"
          label={t('profile.menuSuche')}
          onPress={() => navigation.navigate('Suche')}
        />
        <MenuRow
          icon="cog-outline"
          label={t('profile.menuEinstellungen')}
          onPress={() => navigation.navigate('Einstellungen')}
        />
      </Card>
    </ScrollView>
  );
}

function MenuRow({
  icon,
  label,
  onPress,
  first,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  onPress: () => void;
  first?: boolean;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      style={[styles.menuRow, first ? null : styles.menuRowBordered]}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
    >
      <MaterialCommunityIcons name={icon} size={20} color={colors.textPrimary} />
      <Text style={styles.menuLabel}>{label}</Text>
      <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textSecondary} />
    </Pressable>
  );
}

function KpiTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Card style={styles.kpiTile}>
      <Text style={styles.kpiLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.kpiValue, accent ? styles.kpiValueAccent : null]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.kpiSub} numberOfLines={1}>
        {sub}
      </Text>
    </Card>
  );
}

function KodexRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.kodexRow, last ? styles.kodexRowLast : null]}>
      <Text style={styles.kodexLabel}>{label}</Text>
      {/* Pinned like the card it sits on — a themed chip on a fixed dark card
          resolves its text from the wrong palette. */}
      <MonoChip palette={lightColors} bare style={styles.kodexValue}>
        {value}
      </MonoChip>
    </View>
  );
}

function TerritoryRow({ row, first }: { row: TerritoryRowView; first: boolean }) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const householdsLine =
    row.householdCount > 0
      ? `${row.householdCount} ${t('profile.householdsLabel')} · ${row.openCount} ${t('profile.openSuffix')}`
      : t('profile.householdsUnknown');
  return (
    <View style={[styles.territoryRow, first ? null : styles.territoryRowBordered]}>
      <View style={[styles.territoryDot, { backgroundColor: row.isActive ? statusColor.success : colors.accent }]} />
      <View style={styles.territoryMain}>
        <Text style={styles.territoryName}>{row.name}</Text>
        <Text style={styles.territoryMeta}>{householdsLine}</Text>
      </View>
      <Text style={[styles.territoryStatus, { color: row.isActive ? colors.pine : colors.accentText }]}>
        {t(row.isActive ? 'profile.statusActive' : 'profile.statusAssigned')}
      </Text>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.md + spacing.xs, paddingBottom: spacing.xl },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md - 2, marginBottom: spacing.md + 2 },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.card,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...typography.heading, color: colors.onAccent },
  avatarImage: { width: 56, height: 56, borderRadius: radius.card },
  headerText: { flex: 1, minWidth: 0 },
  name: { ...typography.heading, color: colors.textPrimary },
  role: { ...typography.label, color: colors.textSecondary, marginTop: spacing.xs - 2 },
  gearButton: {
    width: spacing.touchTarget,
    height: spacing.touchTarget,
    borderRadius: radius.input,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md - 4, marginBottom: spacing.md },
  kpiTile: { width: '48%', flexGrow: 1, padding: spacing.md - 2 },
  kpiLabel: { ...typography.label, color: colors.textSecondary },
  kpiValue: { ...typography.display, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.xs - 2 },
  kpiValueAccent: { color: colors.accentText },
  kpiSub: { ...typography.label, color: colors.textSecondary, marginTop: spacing.xs - 2 },
  // Pinned to lightColors, not the theme. This card is the Haustuerkodex badge
  // — the same always-dark Ink-Navy metaphor as BeraterAusweisScreen — and its
  // label/value colours are hardcoded whites. `ink` INVERTS between palettes
  // (near-white in dark mode), so following the theme turned the card white and
  // left white-on-white text: the "Beraterschein" preview was unreadable in
  // dark mode while the screen behind it was fine.
  kodexCard: {
    backgroundColor: lightColors.ink,
    borderRadius: radius.card,
    padding: spacing.md + 2,
    marginBottom: spacing.md,
  },
  kodexBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.10)',
    paddingVertical: spacing.xs + 1,
    paddingHorizontal: spacing.sm + 1,
    borderRadius: radius.pill,
    marginBottom: spacing.md - 2,
  },
  kodexBadgeText: { ...typography.label, fontWeight: '600', color: 'rgba(255,255,255,0.78)' },
  kodexRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm + 1,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  kodexRowLast: { marginBottom: spacing.md - 2 },
  kodexLabel: { ...typography.label, color: 'rgba(255,255,255,0.62)' },
  kodexValue: { color: lightColors.onAccent, fontSize: 14 },
  kodexCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm + 2,
    height: 56,
    borderRadius: radius.input,
    backgroundColor: colors.accent,
  },
  kodexCtaText: { ...typography.heading, fontSize: 16, color: colors.onAccent },
  territoryCard: { paddingHorizontal: spacing.md },
  menuCard: { paddingHorizontal: spacing.md, marginTop: spacing.md },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md - 2, minHeight: 56, paddingVertical: spacing.sm },
  menuRowBordered: { borderTopWidth: 1, borderTopColor: colors.border },
  menuLabel: { ...typography.body, fontWeight: '600', color: colors.textPrimary, flex: 1, minWidth: 0 },
  territoryEmpty: { padding: spacing.md },
  territoryEmptyTitle: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  territoryEmptyBody: { ...typography.label, color: colors.textSecondary, marginTop: spacing.xs },
  territoryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md - 4, paddingVertical: spacing.md - 4 },
  territoryRowBordered: { borderTopWidth: 1, borderTopColor: colors.border },
  territoryDot: { width: 10, height: 10, borderRadius: radius.pill },
  territoryMain: { flex: 1, minWidth: 0 },
  territoryName: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  territoryMeta: { ...typography.label, color: colors.textSecondary, marginTop: 1 },
  territoryStatus: { ...typography.label, fontWeight: '600' },
  });
}
