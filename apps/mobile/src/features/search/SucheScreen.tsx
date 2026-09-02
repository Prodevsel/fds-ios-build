import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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
import { formatTimeHHmm } from '../../lib/datetime/format';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { createContractsRepo, type ContractListRow } from '../flow-runner/db/contractsRepo';
import { createAppointmentsRepo, type Appointment } from '../termine/db/appointmentsRepo';
import { buildSearchResults, type ContractHit, type HouseHit } from './searchView';

/**
 * Suche (design SSOT screen 17) — local-only search across the rep's real synced
 * data: appointment addresses (the "Häuser" group — houses carry no address
 * column, so the follow-up address is the searchable house label) and contracts
 * by customer name / deal reference (the "Abschlüsse" group). The offline-honest
 * footer ("es wird nur lokal gesucht") is literally true: no network query.
 */
export function SucheScreen() {
  return <DbBoundary>{(db, userId) => <SucheContent db={db} repId={userId ?? ''} />}</DbBoundary>;
}

function SucheContent({ db, repId }: { db: AbstractPowerSyncDatabase; repId: string }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [query, setQuery] = useState('');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [contracts, setContracts] = useState<ContractListRow[]>([]);

  useEffect(() => {
    if (!repId) return;
    const unsubs = [
      createAppointmentsRepo({ db }).watchAppointments(repId, setAppointments),
      createContractsRepo({ db }).watchContracts(setContracts),
    ];
    return () => unsubs.forEach((u) => u());
  }, [db, repId]);

  const results = useMemo(
    () => buildSearchResults(query, { appointments, contracts }),
    [query, appointments, contracts],
  );
  const hasQuery = query.trim().length > 0;

  return (
    <View style={styles.container} testID="suche-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.searchField}>
          <MaterialCommunityIcons name="magnify" size={18} color={colors.textPrimary} />
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder={t('suche.placeholder')}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            returnKeyType="search"
          />
        </View>
        <Pressable
          accessibilityRole="button"
          style={styles.cancel}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.cancelText}>{t('suche.cancel')}</Text>
        </Pressable>
      </View>

      {!hasQuery ? (
        <EmptyState
          testID="suche-prompt"
          icon="magnify"
          title={t('suche.promptHeading')}
          description={t('suche.promptBody')}
        />
      ) : results.total === 0 ? (
        <EmptyState
          testID="suche-empty"
          icon="magnify-close"
          title={t('suche.emptyHeading')}
          description={t('suche.emptyBody')}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.results}>
          {results.haeuser.length > 0 ? (
            <ResultGroup label={t('suche.groupHaeuser')}>
              {results.haeuser.map((hit, index) => (
                <HouseRow key={hit.id} hit={hit} first={index === 0} />
              ))}
            </ResultGroup>
          ) : null}
          {results.abschluesse.length > 0 ? (
            <ResultGroup label={t('suche.groupAbschluesse')}>
              {results.abschluesse.map((hit, index) => (
                <ContractRow key={hit.id} hit={hit} first={index === 0} />
              ))}
            </ResultGroup>
          ) : null}

          <View style={styles.offlineHint}>
            <MaterialCommunityIcons name="wifi-off" size={16} color={colors.textSecondary} />
            <Text style={styles.offlineHintText}>{t('suche.offlineHint')}</Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function ResultGroup({ label, children }: { label: string; children: React.ReactNode }) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>{label}</Text>
      <Card style={styles.groupCard} padded={false}>
        {children}
      </Card>
    </View>
  );
}

function HouseRow({ hit, first }: { hit: HouseHit; first: boolean }) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const meta = [hit.floorLabel, formatTimeHHmm(hit.scheduledAtIso)].filter(Boolean).join(' · ');
  return (
    <View style={[styles.resultRow, first ? null : styles.resultRowBordered]}>
      <View style={[styles.dot, { backgroundColor: statusColor.follow_up }]} />
      <View style={styles.resultMain}>
        <Text style={styles.resultTitle} numberOfLines={1}>
          {hit.address}
        </Text>
        {meta ? <Text style={styles.resultMeta}>{meta}</Text> : null}
      </View>
      {/* KEIN Chevron. Diese Zeile ist eine `View`, kein `Pressable` — sie
          fuehrt nirgendwohin. Ein Chevron verspricht dem Berater, dass er das
          gefundene Haus oder den Abschluss oeffnen kann, und liess ihn vor dem
          Kunden dagegen tippen. ContractListScreen macht es richtig: Chevron
          nur, wenn ein onPress existiert. Das Oeffnen aus der Suche heraus ist
          ein eigener Schritt und steht im Handoff. */}
    </View>
  );
}

function ContractRow({ hit, first }: { hit: ContractHit; first: boolean }) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.resultRow, first ? null : styles.resultRowBordered]}>
      <View style={[styles.dot, { backgroundColor: colors.ink }]} />
      <View style={styles.resultMain}>
        <Text style={styles.resultTitle} numberOfLines={1}>
          {hit.customerName}
        </Text>
        <MonoChip bare style={styles.resultRef}>
          {hit.dealReference}
        </MonoChip>
      </View>
      {/* KEIN Chevron. Diese Zeile ist eine `View`, kein `Pressable` — sie
          fuehrt nirgendwohin. Ein Chevron verspricht dem Berater, dass er das
          gefundene Haus oder den Abschluss oeffnen kann, und liess ihn vor dem
          Kunden dagegen tippen. ContractListScreen macht es richtig: Chevron
          nur, wenn ein onPress existiert. Das Oeffnen aus der Suche heraus ist
          ein eigener Schritt und steht im Handoff. */}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + spacing.xs,
    paddingHorizontal: spacing.md + spacing.xs,
    paddingBottom: spacing.md,
  },
  searchField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    minHeight: spacing.touchTarget + spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: radius.input,
    paddingHorizontal: spacing.md - 2,
  },
  input: { flex: 1, ...typography.body, color: colors.textPrimary, paddingVertical: 0 },
  cancel: { minHeight: spacing.touchTarget, justifyContent: 'center' },
  cancelText: { ...typography.body, fontWeight: '600', color: colors.accent },
  results: { paddingHorizontal: spacing.md + spacing.xs, paddingBottom: spacing.lg },
  group: { marginBottom: spacing.lg - 4 },
  groupLabel: {
    ...typography.label,
    fontWeight: '600',
    color: colors.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: spacing.sm + 2,
  },
  groupCard: { paddingHorizontal: spacing.md },
  resultRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md - 4,
    paddingVertical: spacing.md - 4,
  },
  resultRowBordered: { borderTopWidth: 1, borderTopColor: colors.border },
  dot: { width: 11, height: 11, borderRadius: radius.pill },
  resultMain: { flex: 1, minWidth: 0 },
  resultTitle: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  resultMeta: { ...typography.label, color: colors.textSecondary, marginTop: 1 },
  resultRef: { fontSize: 12, color: colors.textSecondary, marginTop: spacing.xs - 2 },
  offlineHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.sm + 3,
    backgroundColor: colors.subtleFill,
    borderRadius: radius.md,
  },
  offlineHintText: { ...typography.label, color: colors.textSecondary },
  });
}
