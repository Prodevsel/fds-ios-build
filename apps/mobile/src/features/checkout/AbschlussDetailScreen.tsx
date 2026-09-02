import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AbstractPowerSyncDatabase } from '@powersync/common';
import type { AbschluesseStackParamList } from '../../app/navigation';
import { DbBoundary } from '../../app/DbBoundary';
import {
  createContractsRepo,
  deriveContractSyncState,
  type ContractDetailRow,
} from '../flow-runner/db/contractsRepo';
import { formatEur } from '../wallet/formatEur';
import { extractPendingContractIds, widerrufDeadlineIso } from './ContractListScreen';
import { type TranslationKey, t } from '../../i18n';
import { radius, spacing, statusColor, typography } from '../../design/tokens';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { Card } from '../../ui/Card';
import { MonoChip } from '../../ui/MonoChip';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../components/EmptyState';
import { ContractPdfSheet } from './ContractPdfSheet';

type DetailState = 'pending' | 'transferred' | 'cancelled';

/** Verlauf timeline step (design SSOT 10b). */
interface VerlaufStep {
  label: string;
  sublabel: string | null;
  /** 'done' → green check, 'waiting' → amber clock. */
  status: 'done' | 'waiting';
}

/** Derives the lifecycle state shown in the banner + timeline. Pure. */
export function deriveDetailState(detail: ContractDetailRow, pending: boolean): DetailState {
  if (detail.cancelledAtIso) return 'cancelled';
  return pending ? 'pending' : 'transferred';
}

/** Minutes-ago copy for the pending banner (design SSOT "vor 2 Min."). Pure. */
export function pendingBannerText(signedAtIso: string, nowMs: number): string {
  const signedMs = new Date(signedAtIso).getTime();
  if (Number.isNaN(signedMs)) return t('abschlussDetail.syncPendingBannerJustNow');
  const minutes = Math.max(0, Math.floor((nowMs - signedMs) / 60_000));
  if (minutes < 1) return t('abschlussDetail.syncPendingBannerJustNow');
  if (minutes < 60) return t('abschlussDetail.syncPendingBanner').replace('{minutes}', String(minutes));
  const hours = Math.floor(minutes / 60);
  return t('abschlussDetail.syncPendingBannerHours').replace('{hours}', String(hours));
}

/** Builds the three-step Verlauf timeline (design SSOT 10b). Pure. */
export function buildVerlauf(detail: ContractDetailRow, state: DetailState): VerlaufStep[] {
  return [
    {
      label: t('abschlussDetail.verlaufSigned'),
      sublabel: detail.gpsPresent
        ? t('abschlussDetail.verlaufSignedGps')
        : t('abschlussDetail.verlaufSignedNoGps'),
      status: 'done',
    },
    { label: t('abschlussDetail.verlaufEncrypted'), sublabel: null, status: 'done' },
    state === 'pending'
      ? { label: t('abschlussDetail.verlaufWaitingNet'), sublabel: null, status: 'waiting' }
      : { label: t('abschlussDetail.verlaufTransferred'), sublabel: null, status: 'done' },
  ];
}

/** `DD.MM.YYYY` — locale-free full date for the Widerrufsfrist note. Pure. */
export function formatFullDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

/** One rendered row of the data card: label and value are both already resolved and non-null. */
export interface DetailRowSpec {
  label: string;
  /** Never null and never the em-dash placeholder — a row with no value is not built at all. */
  value: string;
  mono?: boolean;
  emphasise?: boolean;
  /** Set on the final surviving row so the card draws no dangling divider. */
  last?: boolean;
}

/**
 * Pure: the data card, built from what this contract can actually say.
 *
 * The card used to render six fixed rows and blank the empty ones with an
 * em-dash, which on a direct-sign contract produced an "Adresse —", a
 * "Bankverbindung —", a "Berater —" and a "0,00 € mtl." — four statements
 * about a legally binding contract that the data does not support
 * (CLAUDE.md, no faked data). A row with no reachable source is now ABSENT.
 *
 * Row by row, and why:
 * - Produkt: from the product_definitions slug, when one is joined.
 * - Adresse: ALWAYS omitted. `houses.address` exists (0083) but is
 *   unreachable from a contract — `contracts` carries no `house_id` and no
 *   draft reference, and only `flow_drafts.house_id` links a draft to a
 *   house. There is no query that could fill this row, so it is not built.
 * - Bankverbindung: from the flow IBAN-scan answer. The direct-sign path has
 *   no IBAN block at all, so the row is omitted there.
 * - Berater: `app_users.full_name` for the contract own `rep_id`
 *   (`contractsRepo.CONTRACT_DETAIL_QUERY`). Omitted only when no name has
 *   synced down.
 * - Monatlich: omitted on the direct-sign path, which writes a doorPrice
 *   sentinel rather than a price (`contractsRepo.toContractDetailRow` reads
 *   that sentinel back as null, which is why this row sees null and not 0).
 * - Provision: omitted when no commission snapshot was frozen.
 */
export function buildDetailRows(detail: ContractDetailRow): DetailRowSpec[] {
  const rows: DetailRowSpec[] = [];

  if (detail.productName) {
    rows.push({ label: t('abschlussDetail.dataProduct'), value: detail.productName });
  }
  if (!detail.isDirectSign && detail.ibanMasked) {
    rows.push({ label: t('abschlussDetail.dataBank'), value: detail.ibanMasked, mono: true });
  }
  if (detail.advisorName) {
    rows.push({ label: t('abschlussDetail.dataAdvisor'), value: detail.advisorName });
  }
  if (!detail.isDirectSign && detail.doorPriceEur !== null) {
    rows.push({
      label: t('abschlussDetail.dataMonthly'),
      value: `${formatEur(detail.doorPriceEur)} ${t('abschluesse.perMonth')}`,
      emphasise: true,
    });
  }
  if (detail.commissionEur !== null) {
    rows.push({ label: t('abschlussDetail.dataCommission'), value: formatEur(detail.commissionEur) });
  }

  const lastIndex = rows.length - 1;
  return rows.map((row, index) => (index === lastIndex ? { ...row, last: true } : row));
}

export interface AbschlussDetailViewProps {
  db: AbstractPowerSyncDatabase;
  contractId: string;
  onBack: () => void;
}

/**
 * Abschluss-Detail — design SSOT screen 10b. Presentational, reused both as a
 * pushed Abschluesse-tab route and as a nested map overlay. Reads a single
 * frozen contract via getContractDetail (append-only local row + status events)
 * and derives its sync state from the local CRUD upload queue (D-22), exactly
 * like the list. Fully offline; no server round-trip.
 */
export function AbschlussDetailView({ db, contractId, onBack }: AbschlussDetailViewProps) {
  const [detail, setDetail] = useState<ContractDetailRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [pdfSheetOpen, setPdfSheetOpen] = useState(false);
  // Re-anchored whenever the detail re-loads so the "vor N Min." banner ages.
  const nowMs = useMemo(() => Date.now(), [detail]);
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // `AbschluesseStack` runs `headerShown: false`, so this screen owns both
  // insets itself: without the top one the header title sits under the
  // iPhone status-bar clock. Unconditional hook call at the top of the
  // component — the early returns below (`!loaded`, `!detail`) all render
  // `header`, so the inset has to be resolved before them. Applied inline
  // rather than inside makeStyles(colors), which is memoized per theme.
  const insets = useSafeAreaInsets();

  const refresh = useMemo(
    () => async () => {
      const repo = createContractsRepo({ db });
      const [row, batch] = await Promise.all([
        repo.getContractDetail(contractId),
        db.getCrudBatch(1000),
      ]);
      const pendingIds = extractPendingContractIds(batch?.crud ?? []);
      setDetail(row);
      setPending(deriveContractSyncState(contractId, pendingIds) === 'pending');
      setLoaded(true);
    },
    [db, contractId],
  );

  useEffect(() => {
    void refresh();
    const unsubscribe = db.registerListener({ statusChanged: () => void refresh() });
    return unsubscribe;
  }, [db, refresh]);

  // The honest "Jetzt synchronisieren" action: a REAL reconnect via the
  // PowerSync client (draining the CRUD upload queue on (re)connect), not just
  // a read-only queue peek. `connect()` is not awaited — failures surface via
  // the status listener, which re-runs `refresh` and re-derives the banner.
  const handleSyncNow = () => {
    const connector = db.connector;
    if (connector) {
      void db.connect(connector).catch(() => {
        // Reflected by the status listener (pending banner); nothing to do here.
      });
    }
    void refresh();
  };

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + spacing.lg }]}>
      <Button
        title=""
        variant="secondary"
        fullWidth={false}
        onPress={onBack}
        accessibilityLabel={t('common.back')}
        leadingIcon={<MaterialCommunityIcons name="chevron-left" size={24} color={colors.textPrimary} />}
        style={styles.backButton}
      />
      <View style={styles.headerText}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {detail?.customerName ?? t('abschlussDetail.title')}
        </Text>
        {detail ? (
          <MonoChip bare style={styles.headerRef}>
            {detail.dealReference}
          </MonoChip>
        ) : null}
      </View>
    </View>
  );

  if (!loaded) {
    return (
      <View style={styles.container} testID="abschluss-detail-loading">
        {header}
      </View>
    );
  }

  if (!detail) {
    return (
      <View style={styles.container} testID="abschluss-detail-notfound">
        {header}
        <EmptyState
          icon="file-remove-outline"
          title={t('abschlussDetail.title')}
          description={t('abschlussDetail.notFound')}
          action={<Button title={t('common.back')} onPress={onBack} fullWidth={false} />}
        />
      </View>
    );
  }

  const state = deriveDetailState(detail, pending);
  const verlauf = buildVerlauf(detail, state);
  const widerrufDate = formatFullDate(widerrufDeadlineIso(detail.signedAtIso));

  return (
    <View style={styles.container} testID="abschluss-detail-screen">
      {header}
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <StatusBanner state={state} detail={detail} nowMs={nowMs} colors={colors} styles={styles} />

        <Card style={styles.dataCard}>
          {buildDetailRows(detail).map((row) => (
            <DataRow key={row.label} row={row} styles={styles} />
          ))}
        </Card>

        <Text style={styles.sectionLabel}>{t('abschlussDetail.verlaufTitle').toUpperCase()}</Text>
        <Card style={styles.timelineCard}>
          {verlauf.map((step, index) => (
            <VerlaufRow
              key={step.label}
              step={step}
              last={index === verlauf.length - 1}
              colors={colors}
              styles={styles}
            />
          ))}
        </Card>

        <View style={[styles.legalNote, state === 'cancelled' && styles.legalNoteCancelled]}>
          <MaterialCommunityIcons
            name={state === 'cancelled' ? 'cancel' : 'shield-check-outline'}
            size={18}
            color={state === 'cancelled' ? colors.brick : colors.accentText}
          />
          <Text style={[styles.legalNoteText, state === 'cancelled' && styles.legalNoteTextCancelled]}>
            {state === 'cancelled'
              ? t('abschlussDetail.cancelledNote').replace(
                  '{date}',
                  formatFullDate(detail.cancelledAtIso ?? detail.signedAtIso),
                )
              : t('abschlussDetail.widerrufNote').replace('{date}', widerrufDate)}
          </Text>
        </View>

      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button
          title={t('abschlussDetail.syncNowCta')}
          variant="ink"
          onPress={handleSyncNow}
          disabled={state !== 'pending'}
          style={styles.syncButton}
          leadingIcon={<MaterialCommunityIcons name="cloud-sync-outline" size={20} color={colors.onAccent} />}
        />
        <Button
          title={t('abschlussDetail.pdfCta')}
          variant="secondary"
          fullWidth={false}
          onPress={() => setPdfSheetOpen(true)}
          style={styles.pdfButton}
          leadingIcon={<MaterialCommunityIcons name="file-pdf-box" size={20} color={colors.textPrimary} />}
        />
      </View>

      {/* The whole document surface lives in the sheet, including the honest
          non-ready states (QUICK-F99). This screen only opens it. */}
      <ContractPdfSheet
        contractId={detail.id}
        visible={pdfSheetOpen}
        onRequestClose={() => setPdfSheetOpen(false)}
      />
    </View>
  );
}

/** `pending`/`cancelled` mix an invariant statusColor with a themed tone —
 * becomes a function of colors (mirrors ContractListScreen's
 * `buildRowTint(colors)` / AktuellesScreen's `buildKindTint(colors)`, 12-09). */
function buildBannerStyle(
  colors: ReturnType<typeof useThemeColors>,
): Record<
  DetailState,
  { bg: string; fg: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'] }
> {
  return {
    pending: { bg: 'rgba(217,119,6,0.12)', fg: colors.accentText, icon: 'cloud-upload-outline' },
    transferred: { bg: 'rgba(22,163,74,0.12)', fg: statusColor.success, icon: 'check-circle-outline' },
    cancelled: { bg: 'rgba(192,54,44,0.10)', fg: colors.brick, icon: 'cancel' },
  };
}

function StatusBanner({
  state,
  detail,
  nowMs,
  colors,
  styles,
}: {
  state: DetailState;
  detail: ContractDetailRow;
  nowMs: number;
  colors: ReturnType<typeof useThemeColors>;
  styles: ReturnType<typeof makeStyles>;
}) {
  const skin = buildBannerStyle(colors)[state];
  const text =
    state === 'pending'
      ? pendingBannerText(detail.signedAtIso, nowMs)
      : state === 'cancelled'
        ? t('abschlussDetail.cancelledNote').replace(
            '{date}',
            formatFullDate(detail.cancelledAtIso ?? detail.signedAtIso),
          )
        : t('abschlussDetail.transferredBanner');
  return (
    <View style={[styles.banner, { backgroundColor: skin.bg }]} testID="abschluss-detail-banner">
      <MaterialCommunityIcons name={skin.icon} size={18} color={skin.fg} />
      <Text style={[styles.bannerText, { color: skin.fg }]}>{text}</Text>
    </View>
  );
}

/**
 * Renders one already-resolved `DetailRowSpec`. `value` is narrowed to
 * `string`: the previous `?? t('abschlussDetail.placeholderUnknown')`
 * fallback is gone because `buildDetailRows` never builds a valueless row,
 * so nothing on this screen can reach it. (The key itself stays in both
 * locale files — it is not this screen private key to delete.)
 */
function DataRow({ row, styles }: { row: DetailRowSpec; styles: ReturnType<typeof makeStyles> }) {
  const { label, value, mono, emphasise, last } = row;
  return (
    <View style={[styles.dataRow, !last && styles.dataRowBorder]}>
      <Text style={styles.dataLabel}>{label}</Text>
      {mono ? (
        <MonoChip bare style={styles.dataValueMono}>
          {value}
        </MonoChip>
      ) : (
        <Text style={[styles.dataValue, emphasise && styles.dataValueEmphasis]} numberOfLines={1}>
          {value}
        </Text>
      )}
    </View>
  );
}

function VerlaufRow({
  step,
  last,
  colors,
  styles,
}: {
  step: VerlaufStep;
  last: boolean;
  colors: ReturnType<typeof useThemeColors>;
  styles: ReturnType<typeof makeStyles>;
}) {
  const done = step.status === 'done';
  return (
    <View style={styles.verlaufRow}>
      <View style={styles.verlaufRail}>
        <View style={[styles.verlaufDot, done ? styles.verlaufDotDone : styles.verlaufDotWaiting]}>
          <MaterialCommunityIcons
            name={done ? 'check' : 'clock-outline'}
            size={13}
            color={done ? colors.onAccent : colors.accentText}
          />
        </View>
        {!last ? <View style={styles.verlaufLine} /> : null}
      </View>
      <View style={styles.verlaufBody}>
        <Text style={styles.verlaufLabel}>{step.label}</Text>
        {step.sublabel ? <Text style={styles.verlaufSublabel}>{step.sublabel}</Text> : null}
      </View>
    </View>
  );
}

/**
 * Navigation wrapper (Abschluesse tab): reads the `contractId` route param and
 * opens the local DB via DbBoundary, then renders the presentational view.
 */
export function AbschlussDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<AbschluesseStackParamList, 'AbschlussDetail'>>();
  const contractId = route.params?.contractId;
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Unconditionally, above the `!contractId` early return — that branch
  // renders its own chrome and must clear the status bar too.
  const insets = useSafeAreaInsets();

  if (!contractId) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + spacing.lg }]}>
        <EmptyState
          icon="file-remove-outline"
          title={t('abschlussDetail.title')}
          description={t('abschlussDetail.notFound')}
          action={<Button title={t('common.back')} onPress={() => navigation.goBack()} fullWidth={false} />}
        />
      </View>
    );
  }

  return (
    <DbBoundary>
      {(db) => (
        <AbschlussDetailView db={db} contractId={contractId} onBack={() => navigation.goBack()} />
      )}
    </DbBoundary>
  );
}

// Type-completeness anchor for the i18n keys referenced dynamically above.
const _KEYS: TranslationKey[] = ['abschlussDetail.title', 'abschlussDetail.notFound'];
void _KEYS;

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.lg,
      paddingBottom: spacing.md,
    },
    backButton: { minHeight: spacing.touchTarget, minWidth: spacing.touchTarget, paddingHorizontal: 0 },
    headerText: { marginLeft: spacing.md, flex: 1 },
    headerTitle: { ...typography.heading, color: colors.textPrimary },
    headerRef: { marginTop: spacing.xs - 2 },
    scroll: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: radius.md,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.md,
      marginBottom: spacing.md,
    },
    bannerText: { ...typography.label, fontWeight: '600', marginLeft: spacing.sm },
    dataCard: { paddingVertical: spacing.xs, paddingHorizontal: spacing.md + 2 },
    dataRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm + 2,
    },
    dataRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
    dataLabel: { ...typography.label, color: colors.textSecondary, marginRight: spacing.md },
    dataValue: { ...typography.body, color: colors.textPrimary, flexShrink: 1, textAlign: 'right' },
    dataValueMono: { textAlign: 'right' },
    dataValueEmphasis: { ...typography.price },
    sectionLabel: {
      ...typography.label,
      fontWeight: '700',
      color: colors.textMuted,
      letterSpacing: 1,
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
      marginLeft: spacing.xs,
    },
    timelineCard: { paddingVertical: spacing.md, paddingHorizontal: spacing.md + 2 },
    verlaufRow: { flexDirection: 'row' },
    verlaufRail: { alignItems: 'center', width: 28 },
    verlaufDot: {
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    verlaufDotDone: { backgroundColor: statusColor.success },
    verlaufDotWaiting: { backgroundColor: 'rgba(217,119,6,0.16)' },
    verlaufLine: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
    verlaufBody: { flex: 1, paddingBottom: spacing.md, marginLeft: spacing.sm },
    verlaufLabel: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
    verlaufSublabel: { ...typography.label, color: colors.textSecondary, marginTop: 1 },
    legalNote: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: 'rgba(232,134,44,0.10)',
      borderRadius: radius.md,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.md,
      marginTop: spacing.lg,
    },
    legalNoteCancelled: { backgroundColor: 'rgba(192,54,44,0.08)' },
    legalNoteText: {
      ...typography.label,
      color: colors.accentText,
      flex: 1,
      marginLeft: spacing.sm,
      lineHeight: 18,
    },
    legalNoteTextCancelled: { color: colors.brick },
    footer: {
      flexDirection: 'row',
      gap: spacing.sm,
      padding: spacing.md,
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    syncButton: { flex: 1 },
    pdfButton: { paddingHorizontal: spacing.lg },
  });
}
