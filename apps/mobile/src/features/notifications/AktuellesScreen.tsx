import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { AbstractPowerSyncDatabase } from '@powersync/common';
import { radius, spacing, statusColor, typography } from '../../design/tokens';
import { t } from '../../i18n';
import { Card } from '../../ui/Card';
import { MonoChip } from '../../ui/MonoChip';
import { EmptyState } from '../../components/EmptyState';
import { DbBoundary } from '../../app/DbBoundary';
import { formatRelative, formatTimeHHmm } from '../../lib/datetime/format';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { createContractsRepo, type ContractListRow } from '../flow-runner/db/contractsRepo';
import { createAppointmentsRepo, type Appointment } from '../termine/db/appointmentsRepo';
import {
  createAktuellesRepo,
  type StornoEvent,
  type TerritoryEvent,
} from './db/aktuellesRepo';
import { buildActivityFeed, countNew, type FeedItem, type FeedItemKind } from './activityFeed';

type MciName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/**
 * Aktuelles (design SSOT screen 16) — the activity feed, DERIVED from real
 * synced data (never a fabricated notifications table): Folgetermin heute
 * (today's appointments), Storno (contract_status_events + customer name),
 * Vertrag abgeschlossen (contracts), Neues Gebiet zugewiesen (own-locked
 * territories). "3 neu · 4 insgesamt" counts real events; "Alle gelesen" marks
 * every item read (local session state — no persisted last-seen store yet).
 */
export function AktuellesScreen() {
  return <DbBoundary>{(db, userId) => <AktuellesContent db={db} repId={userId ?? ''} />}</DbBoundary>;
}

const KIND_ICON: Record<FeedItemKind, MciName> = {
  followup: 'calendar-blank-outline',
  storno: 'alert-outline',
  contract: 'check',
  territory: 'map-outline',
};

/**
 * Per-kind tint. `followup`/`contract` reuse the theme-invariant `statusColor`
 * hues; `storno`/`territory` resolve through the theme (destructive/
 * territory-outline shift between light and dark) — a function of `colors`
 * rather than a module constant, so it stays theme-aware.
 */
function buildKindTint(colors: ReturnType<typeof useThemeColors>): Record<FeedItemKind, string> {
  return {
    followup: statusColor.follow_up,
    storno: colors.destructive,
    contract: statusColor.success,
    territory: colors.ownTerritoryOutline,
  };
}

function AktuellesContent({ db, repId }: { db: AbstractPowerSyncDatabase; repId: string }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [nowMs] = useState<number>(() => Date.now());
  const [contracts, setContracts] = useState<ContractListRow[]>([]);
  const [stornos, setStornos] = useState<StornoEvent[]>([]);
  const [territories, setTerritories] = useState<TerritoryEvent[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!repId) return;
    const aktuelles = createAktuellesRepo({ db });
    const unsubs = [
      createContractsRepo({ db }).watchContracts(setContracts),
      aktuelles.watchStornoEvents(repId, setStornos),
      aktuelles.watchTerritoryEvents(repId, setTerritories),
      createAppointmentsRepo({ db }).watchAppointments(repId, setAppointments),
    ];
    return () => unsubs.forEach((u) => u());
  }, [db, repId]);

  const feed = useMemo(
    () => buildActivityFeed({ contracts, stornos, territories, appointments }, nowMs),
    [contracts, stornos, territories, appointments, nowMs],
  );
  const newCount = countNew(feed, readIds);
  const subtitle = `${newCount} ${t('aktuelles.newSuffix')} · ${feed.length} ${t('aktuelles.totalSuffix')}`;

  return (
    <View style={styles.container} testID="aktuelles-screen">
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
          <Text style={styles.title}>{t('notifications.title')}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        {newCount > 0 ? (
          <Pressable
            accessibilityRole="button"
            style={styles.markAll}
            onPress={() => setReadIds(new Set(feed.map((f) => f.id)))}
          >
            <Text style={styles.markAllText}>{t('aktuelles.markAllRead')}</Text>
          </Pressable>
        ) : null}
      </View>

      {feed.length === 0 ? (
        <EmptyState
          testID="aktuelles-empty-state"
          icon="bell-outline"
          title={t('aktuelles.emptyHeading')}
          description={t('aktuelles.emptyBody')}
        />
      ) : (
        <FlatList
          data={feed}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => <FeedRow item={item} read={readIds.has(item.id)} />}
          ItemSeparatorComponent={() => <View style={styles.rowGap} />}
        />
      )}
    </View>
  );
}

function feedTitle(item: FeedItem): string {
  switch (item.kind) {
    case 'followup':
      return `${t('aktuelles.followupTitle')} ${t('termine.todaySuffix')} ${formatTimeHHmm(item.appointmentTimeIso ?? '')}`;
    case 'storno':
      return `${t('aktuelles.stornoTitle')}: ${item.customerName ?? ''}`;
    case 'contract':
      return t('aktuelles.contractTransferredTitle');
    case 'territory':
      return t('aktuelles.territoryAssignedTitle');
  }
}

function FeedRow({ item, read }: { item: FeedItem; read: boolean }) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const kindTint = useMemo(() => buildKindTint(colors), [colors]);
  const unread = item.isNew && !read;
  return (
    <Card style={[styles.row, unread ? styles.rowUnread : null]}>
      <View style={[styles.iconTile, { backgroundColor: `${kindTint[item.kind]}1F` }]}>
        <MaterialCommunityIcons name={KIND_ICON[item.kind]} size={18} color={kindTint[item.kind]} />
      </View>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {feedTitle(item)}
        </Text>
        <FeedBody item={item} />
      </View>
      <Text style={styles.rowTime}>{formatRelative(Date.now(), item.iso)}</Text>
    </Card>
  );
}

function FeedBody({ item }: { item: FeedItem }) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (item.kind === 'followup') {
    const parts = [item.address, item.floorLabel].filter(Boolean).join(' · ');
    return <Text style={styles.rowBody}>{parts}</Text>;
  }
  if (item.kind === 'territory') {
    return <Text style={styles.rowBody}>{item.territoryName}</Text>;
  }
  // storno + contract both lead with the mono deal reference.
  return (
    <View style={styles.rowBodyInline}>
      <MonoChip bare style={styles.rowRef}>
        {item.dealReference ?? ''}
      </MonoChip>
      {item.kind === 'contract' && item.customerName ? (
        <Text style={styles.rowBody}> · {item.customerName}</Text>
      ) : null}
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
    paddingHorizontal: spacing.md + spacing.xs,
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
  subtitle: { ...typography.label, color: colors.textSecondary, marginTop: spacing.xs },
  markAll: { minHeight: spacing.touchTarget, justifyContent: 'center', paddingHorizontal: spacing.sm },
  markAllText: { ...typography.label, fontWeight: '600', color: colors.accent },
  listContent: { paddingHorizontal: spacing.md + spacing.xs, paddingBottom: spacing.lg },
  rowGap: { height: spacing.sm + spacing.xs },
  row: { flexDirection: 'row', gap: spacing.md - 4, padding: spacing.md },
  rowUnread: { borderColor: 'rgba(232,134,44,0.35)' },
  iconTile: { width: 36, height: 36, borderRadius: radius.md - 1, alignItems: 'center', justifyContent: 'center' },
  rowMain: { flex: 1, minWidth: 0 },
  rowTitle: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  rowBody: { ...typography.label, color: colors.textSecondary, marginTop: spacing.xs - 2 },
  rowBodyInline: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs - 2 },
  rowRef: { fontSize: 12, color: colors.textSecondary },
  rowTime: { ...typography.label, color: colors.textSecondary },
  });
}
