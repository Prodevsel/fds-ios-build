import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { AbstractPowerSyncDatabase } from '@powersync/common';
import type { MainTabsParamList } from '../../app/navigation';
import { radius, spacing, statusColor, typography } from '../../design/tokens';
import { t } from '../../i18n';
import { Card } from '../../ui/Card';
import { EmptyState } from '../../components/EmptyState';
import { DbBoundary } from '../../app/DbBoundary';
import { formatTimeHHmm } from '../../lib/datetime/format';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { createAppointmentsRepo, type Appointment } from './db/appointmentsRepo';
import { buildTermineView, type TermineRowView } from './termineView';

/**
 * Termine tab (design SSOT screen 12) — the rep's follow-up calendar. Wires the
 * synced `appointments` table (0058) via `appointmentsRepo.watchAppointments`
 * (own-rows-only) and renders each row 1:1 to the mockup: a date-pill (ink when
 * today, neutral otherwise) with the time, the door address + floor, the note,
 * and — for a Haustürkodex call-back — the "Rückruf-Verifizierung (N J.)" chip.
 * Tapping a linked card jumps to the Karte tab (the house lives on the map).
 * Empty → the shared EmptyState (honest: the table is real, populated once
 * follow-ups are scheduled).
 */
export function TermineScreen() {
  return <DbBoundary>{(db, userId) => <TermineContent db={db} repId={userId ?? ''} />}</DbBoundary>;
}

interface TermineContentProps {
  db: AbstractPowerSyncDatabase;
  repId: string;
}

function TermineContent({ db, repId }: TermineContentProps) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [nowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!repId) return;
    const repo = createAppointmentsRepo({ db });
    return repo.watchAppointments(repId, setAppointments);
  }, [db, repId]);

  const view = buildTermineView(appointments, nowMs);
  const appointmentWord =
    view.total === 1 ? t('termine.appointmentOne') : t('termine.appointmentMany');
  const subtitle = `${view.total} ${appointmentWord} · ${view.todayCount} ${t('termine.todaySuffix')}`;
  const asOf = `${t('termine.asOf')} ${formatTimeHHmm(new Date(nowMs).toISOString())}`;

  const openHouse = (houseId: string | null) => {
    if (!houseId) return;
    // Jump to the Karte tab AND open that house's StatusSheet on arrival
    // (mockup promise) — the house lives on the map. `getParent` is the tab
    // navigator; the nested Karte screen reads `focusHouseId`.
    navigation.getParent<NavigationProp<MainTabsParamList>>()?.navigate('KarteTab', {
      screen: 'Karte',
      params: { focusHouseId: houseId },
    });
  };

  return (
    <View style={styles.container} testID="termine-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{t('termine.title')}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <View style={styles.asOfPill}>
          <View style={styles.asOfDot} />
          <Text style={styles.asOfText}>{asOf}</Text>
        </View>
      </View>

      {view.rows.length === 0 ? (
        <EmptyState
          testID="termine-empty-state"
          icon="calendar-blank-outline"
          title={t('termine.emptyHeading')}
          description={t('termine.emptyBody')}
        />
      ) : (
        <FlatList
          data={view.rows}
          keyExtractor={(row) => row.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <AppointmentCard row={item} onPress={() => openHouse(item.houseId)} />
          )}
          ItemSeparatorComponent={() => <View style={styles.rowGap} />}
        />
      )}
    </View>
  );
}

function AppointmentCard({ row, onPress }: { row: TermineRowView; onPress: () => void }) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" disabled={!row.houseId}>
      <Card style={styles.card}>
        <View style={[styles.datePill, row.isToday ? styles.datePillToday : styles.datePillDefault]}>
          <Text style={[styles.pillDay, row.isToday ? styles.pillTextToday : styles.pillTextDefault]}>
            {row.pill}
          </Text>
          <Text style={[styles.pillTime, row.isToday ? styles.pillTextToday : styles.pillTextDefault]}>
            {row.time}
          </Text>
        </View>
        <View style={styles.cardMain}>
          {row.address ? (
            <Text style={styles.address} numberOfLines={1}>
              {row.address}
            </Text>
          ) : null}
          {row.floorLabel ? <Text style={styles.meta}>{row.floorLabel}</Text> : null}
          {row.callbackLabel ? (
            <View style={styles.callbackChip}>
              <MaterialCommunityIcons
                name="shield-lock-outline"
                size={13}
                color={colors.ownTerritoryOutline}
              />
              <Text style={styles.callbackText}>{row.callbackLabel}</Text>
            </View>
          ) : row.note ? (
            <Text style={styles.note}>{row.note}</Text>
          ) : null}
        </View>
        <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textSecondary} />
      </Card>
    </Pressable>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md + spacing.xs,
    paddingBottom: spacing.md,
  },
  headerText: { flex: 1 },
  title: { ...typography.display, color: colors.textPrimary },
  subtitle: { ...typography.label, color: colors.textSecondary, marginTop: spacing.xs },
  asOfPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.subtleFill,
    paddingHorizontal: spacing.sm + spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  asOfDot: { width: 9, height: 9, borderRadius: radius.pill, backgroundColor: statusColor.follow_up },
  asOfText: { ...typography.label, fontWeight: '600', color: colors.textSecondary },
  listContent: { paddingHorizontal: spacing.md + spacing.xs, paddingBottom: spacing.lg },
  rowGap: { height: spacing.sm + spacing.xs },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  datePill: {
    width: 80,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + spacing.xs,
    alignItems: 'center',
  },
  datePillToday: { backgroundColor: colors.ink },
  datePillDefault: { backgroundColor: colors.subtleFill },
  pillDay: { ...typography.label, fontWeight: '600' },
  pillTime: { ...typography.price, marginTop: spacing.xs - 2 },
  pillTextToday: { color: colors.onAccent },
  pillTextDefault: { color: colors.textPrimary },
  cardMain: { flex: 1, minWidth: 0 },
  address: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  meta: { ...typography.label, color: colors.textSecondary, marginTop: spacing.xs - 2 },
  note: { ...typography.label, color: colors.textSecondary, marginTop: spacing.xs + 2 },
  callbackChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    alignSelf: 'flex-start',
    marginTop: spacing.sm - 1,
    paddingVertical: spacing.xs + 1,
    paddingHorizontal: spacing.sm + 1,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(37,99,235,0.08)',
  },
  callbackText: { ...typography.label, fontWeight: '600', color: colors.ownTerritoryOutline },
  });
}
