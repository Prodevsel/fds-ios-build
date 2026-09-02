import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AbstractPowerSyncDatabase } from '@powersync/common';
import {
  createContractsRepo,
  deriveContractSyncState,
  extractPendingContractIds,
  type ContractListRow,
} from '../flow-runner/db/contractsRepo';
import { formatEur } from '../wallet/formatEur';
import { type TranslationKey, t } from '../../i18n';
import { radius, spacing, statusColor, typography } from '../../design/tokens';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { Card } from '../../ui/Card';
import { MonoChip } from '../../ui/MonoChip';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../components/EmptyState';

export type ContractFilter = 'all' | 'open' | 'transferred';

/** Derived per-row lifecycle (design SSOT 10 status line): pending sync,
 * transferred (with a Widerruf deadline), or withdrawn (Widerruf recorded). */
export type ContractRowState = 'pending' | 'transferred' | 'cancelled';

export interface ContractListScreenProps {
  db: AbstractPowerSyncDatabase;
  onClose: () => void;
  /**
   * Row tap → open the Abschluss-Detail (design SSOT 10b). Optional: when
   * omitted (e.g. an embedded read-only context) rows stay non-interactive.
   * The Abschluesse tab wires this to a stack push; the map overlay wires it
   * to a nested detail overlay.
   */
  onOpenDetail?: (contractId: string) => void;
}

/**
 * Moved to `flow-runner/db/contractsRepo.ts`, next to `deriveContractSyncState`
 * — the two are one D-22 derivation and every caller needs both, but reaching
 * it here meant importing a screen module. Re-exported so this file's existing
 * importers and tests keep their import path.
 */
export { extractPendingContractIds };

/** Derives a row's lifecycle state (design SSOT 10): a recorded Widerruf wins
 * over sync state; otherwise pending-upload vs. transferred. Pure. */
export function deriveContractRowState(
  row: ContractListRow,
  pendingIds: ReadonlySet<string> | readonly string[],
): ContractRowState {
  if (row.cancelledAtIso) return 'cancelled';
  return deriveContractSyncState(row.id, pendingIds) === 'pending' ? 'pending' : 'transferred';
}

/** `false` for a row filtered out by the active segment. Pure. */
export function matchesFilter(state: ContractRowState, filter: ContractFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'open') return state === 'pending';
  // 'transferred' groups the settled deals (transferred + withdrawn).
  return state === 'transferred' || state === 'cancelled';
}

/**
 * D-18/D-11: "Meine Abschlüsse" list — design SSOT screen 10. A back header
 * with a "{Monat} · {n} Verträge · {k} offen" subtitle, an Alle/Offen/
 * Übertragen segmented filter, and status-tinted rows (avatar icon, name,
 * monthly amount €, FDS-ref, product·time, coloured status line). Rows tap
 * through to the Abschluss-Detail (10b) when `onOpenDetail` is wired.
 *
 * Sync chip (D-22): derived client-side from the local PowerSync CRUD upload
 * queue via `db.getCrudBatch` — a read-only peek, never `.complete()`d here.
 */
export function ContractListScreen({ db, onClose, onOpenDetail }: ContractListScreenProps) {
  const [rows, setRows] = useState<ContractListRow[]>([]);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState<ContractFilter>('all');
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // This is a tab root rendered with `headerShown: false`, so nothing above
  // it supplies the status-bar inset — the screen owns it, exactly like
  // `app/ScreenScaffold.tsx`'s ScreenHeader. Applied at the call site, not
  // baked into makeStyles(colors), because those styles are memoized per
  // theme and would not re-derive when the inset changes (rotation, a call
  // banner growing the status bar).
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const repo = createContractsRepo({ db });
    return repo.watchContracts(setRows);
  }, [db]);

  useEffect(() => {
    let cancelled = false;
    const refreshPendingIds = async () => {
      const batch = await db.getCrudBatch(1000);
      if (cancelled) return;
      setPendingIds(extractPendingContractIds(batch?.crud ?? []));
    };
    void refreshPendingIds();
    const unsubscribe = db.registerListener({ statusChanged: () => void refreshPendingIds() });
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, rows.length]);

  const openCount = useMemo(
    () => rows.filter((row) => deriveContractRowState(row, pendingIds) === 'pending').length,
    [rows, pendingIds],
  );

  const visibleRows = useMemo(
    () => rows.filter((row) => matchesFilter(deriveContractRowState(row, pendingIds), filter)),
    [rows, pendingIds, filter],
  );

  const subtitle = rows.length > 0 ? buildSubtitle(rows, openCount) : null;

  return (
    <View style={styles.container} testID="contract-list-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.lg }]}>
        <Pressable
          style={styles.closeButton}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={onClose}
        >
          <MaterialCommunityIcons name="chevron-left" size={26} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>{t('contracts.listTitle')}</Text>
          {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
        </View>
      </View>

      {rows.length === 0 ? (
        <EmptyState
          testID="contract-empty-state"
          icon="file-document-outline"
          title={t('emptyState.noContractsHeading')}
          description={t('emptyState.noContractsBody')}
          action={<Button title={t('abschluesse.emptyCta')} onPress={onClose} fullWidth={false} />}
        />
      ) : (
        <>
          <SegmentedFilter value={filter} onChange={setFilter} styles={styles} />
          <FlatList
            data={visibleRows}
            keyExtractor={(row) => row.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <ContractRow
                row={item}
                state={deriveContractRowState(item, pendingIds)}
                onPress={onOpenDetail ? () => onOpenDetail(item.id) : undefined}
                colors={colors}
                styles={styles}
              />
            )}
            ItemSeparatorComponent={() => <View style={styles.rowGap} />}
          />
        </>
      )}
    </View>
  );
}

const FILTER_KEYS: Record<ContractFilter, TranslationKey> = {
  all: 'abschluesse.filterAll',
  open: 'abschluesse.filterOpen',
  transferred: 'abschluesse.filterTransferred',
};

/** Alle / Offen / Übertragen segmented control (design SSOT 10) — neutral
 * track, the active segment lifted to a white surface. */
function SegmentedFilter({
  value,
  onChange,
  styles,
}: {
  value: ContractFilter;
  onChange: (next: ContractFilter) => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.segment} accessibilityRole="tablist">
      {(Object.keys(FILTER_KEYS) as ContractFilter[]).map((key) => {
        const active = key === value;
        return (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.segmentItem, active && styles.segmentItemActive]}
            onPress={() => onChange(key)}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
              {t(FILTER_KEYS[key])}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const ROW_ICON: Record<ContractRowState, React.ComponentProps<typeof MaterialCommunityIcons>['name']> = {
  pending: 'sync',
  transferred: 'check',
  cancelled: 'close-circle-outline',
};

/** `cancelled` is the only entry that varies with the theme (destructive/brick
 * tone) — mirrors AktuellesScreen.tsx's `buildKindTint(colors)` pattern
 * (12-09): a colour-lookup map that mixes invariant statusColor hues with a
 * themed one becomes a function of colors, not a module constant. */
function buildRowTint(colors: ReturnType<typeof useThemeColors>): Record<ContractRowState, string> {
  return {
    pending: statusColor.follow_up,
    transferred: statusColor.success,
    cancelled: colors.brick,
  };
}

/**
 * Row skinned 1:1 to design SSOT screen 10: status-tinted icon tile, customer
 * name, the monthly amount € on the right, the deal reference as a mono chip,
 * a product·time meta line, and a coloured status line ("Sync ausstehend" /
 * "Übertragen · Widerruf bis DD.MM." / "Widerruf am DD.MM."). Tappable when an
 * `onPress` is wired (→ Abschluss-Detail 10b).
 */
function ContractRow({
  row,
  state,
  onPress,
  colors,
  styles,
}: {
  row: ContractListRow;
  state: ContractRowState;
  onPress?: () => void;
  colors: ReturnType<typeof useThemeColors>;
  styles: ReturnType<typeof makeStyles>;
}) {
  const tint = buildRowTint(colors)[state];
  const body = (
    <Card style={styles.rowCard}>
      <View style={styles.rowInner}>
        <View style={[styles.iconTile, { backgroundColor: withAlpha(tint) }]}>
          <MaterialCommunityIcons name={ROW_ICON[state]} size={19} color={tint} />
        </View>
        <View style={styles.rowMain}>
          <View style={styles.rowTopLine}>
            <Text style={styles.customerName} numberOfLines={1}>
              {row.customerName || t('contracts.unknownCustomer')}
            </Text>
            {row.doorPriceEur !== null ? (
              <Text style={styles.amount}>{formatEur(row.doorPriceEur)}</Text>
            ) : null}
          </View>
          <MonoChip bare style={styles.dealReference}>
            {row.dealReference}
          </MonoChip>
          <Text style={styles.metaLine} numberOfLines={1}>
            {[row.productName, formatSignedAt(row.signedAtIso)].filter(Boolean).join(' · ')}
          </Text>
          <Text style={[styles.statusLine, { color: tint }]}>{statusLineFor(row, state)}</Text>
        </View>
        {onPress ? (
          <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textMuted} />
        ) : null}
      </View>
    </Card>
  );

  if (!onPress) return body;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => (pressed ? styles.rowPressed : null)}>
      {body}
    </Pressable>
  );
}

/** Status line copy for a row (design SSOT 10). Pure. */
export function statusLineFor(row: ContractListRow, state: ContractRowState): string {
  if (state === 'cancelled') {
    return t('abschluesse.statusCancelled').replace(
      '{date}',
      formatShortDate(row.cancelledAtIso ?? row.signedAtIso),
    );
  }
  if (state === 'pending') return t('abschluesse.statusPending');
  return `${t('abschluesse.statusTransferred')} · ${t('abschluesse.statusWiderrufUntil').replace(
    '{date}',
    formatShortDate(widerrufDeadlineIso(row.signedAtIso)),
  )}`;
}

/** Builds the "{Monat} · {n} Verträge · {k} offen" subtitle. Pure. */
export function buildSubtitle(rows: ContractListRow[], openCount: number): string {
  const total = rows.length;
  const month = monthLabel(rows[0]?.signedAtIso);
  const contractsPart = (
    total === 1 ? t('abschluesse.subtitleContractsSingular') : t('abschluesse.subtitleContractsPlural')
  ).replace('{count}', String(total));
  const openPart = t('abschluesse.subtitleOpen').replace('{count}', String(openCount));
  return [month, contractsPart, openPart].filter(Boolean).join(' · ');
}

const MONTH_KEYS: TranslationKey[] = [
  'abschluesse.monthJanuary',
  'abschluesse.monthFebruary',
  'abschluesse.monthMarch',
  'abschluesse.monthApril',
  'abschluesse.monthMay',
  'abschluesse.monthJune',
  'abschluesse.monthJuly',
  'abschluesse.monthAugust',
  'abschluesse.monthSeptember',
  'abschluesse.monthOctober',
  'abschluesse.monthNovember',
  'abschluesse.monthDecember',
];

/** German month name from an ISO date, or '' if unparseable. Pure. */
export function monthLabel(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const key = MONTH_KEYS[date.getMonth()];
  return key ? t(key) : '';
}

/** signed_at + 14 days (§ 355 BGB Widerrufsfrist), as an ISO string. Pure. */
export function widerrufDeadlineIso(signedAtIso: string): string {
  const date = new Date(signedAtIso);
  if (Number.isNaN(date.getTime())) return signedAtIso;
  date.setDate(date.getDate() + 14);
  return date.toISOString();
}

/** `DD.MM.` — the short date used in the row status line. Pure. */
export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.`;
}

/** `DD.MM.YYYY HH:MM` — plain manual formatting, no `Intl` locale-data
 * dependency on Hermes (mirrors StatusSheet's formatFollowUpDate). Pure. */
export function formatSignedAt(signedAtIso: string): string {
  const date = new Date(signedAtIso);
  if (Number.isNaN(date.getTime())) return signedAtIso;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function syncPillKeyFor(state: 'pending' | 'synced'): Parameters<typeof t>[0] {
  return `syncPill.${state}` as Parameters<typeof t>[0];
}

/** ~12% status-tinted fill for the row icon tile (design SSOT). */
function withAlpha(hex: string): string {
  return `${hex}1F`;
}

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
    closeButton: {
      width: spacing.touchTarget,
      height: spacing.touchTarget,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerText: { marginLeft: spacing.md, flex: 1 },
    headerTitle: { ...typography.display, color: colors.textPrimary },
    headerSubtitle: { ...typography.label, color: colors.textSecondary, marginTop: spacing.xs - 2 },
    segment: {
      flexDirection: 'row',
      marginHorizontal: spacing.md,
      marginBottom: spacing.md,
      padding: spacing.xs - 1,
      backgroundColor: colors.secondary,
      borderRadius: radius.pill,
    },
    segmentItem: {
      flex: 1,
      paddingVertical: spacing.sm + 1,
      borderRadius: radius.pill,
      alignItems: 'center',
    },
    segmentItemActive: {
      backgroundColor: colors.surface,
      shadowColor: colors.ink,
      shadowOpacity: 0.12,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
    segmentText: { ...typography.label, fontWeight: '600', color: colors.textSecondary },
    segmentTextActive: { color: colors.textPrimary },
    listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
    rowGap: { height: spacing.sm + spacing.xs },
    rowPressed: { opacity: 0.7 },
    rowCard: { padding: spacing.md + 2 },
    rowInner: { flexDirection: 'row', alignItems: 'flex-start' },
    iconTile: {
      width: 38,
      height: 38,
      borderRadius: radius.md - 1,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.md - 2,
    },
    rowMain: { flex: 1 },
    rowTopLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    customerName: {
      ...typography.body,
      fontWeight: '600',
      color: colors.textPrimary,
      flex: 1,
      marginRight: spacing.sm,
    },
    amount: { ...typography.price, color: colors.textPrimary },
    dealReference: { marginTop: spacing.xs - 1 },
    metaLine: { ...typography.label, color: colors.textSecondary, marginTop: spacing.xs - 1 },
    statusLine: { ...typography.label, fontWeight: '600', marginTop: spacing.xs + 2 },
  });
}
