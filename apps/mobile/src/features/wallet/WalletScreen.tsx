import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { AbstractPowerSyncDatabase } from '@powersync/common';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { radius, spacing, typography, walletStateColor } from '../../design/tokens';
import { type TranslationKey, t } from '../../i18n';
import { Card } from '../../ui/Card';
import { MonoChip } from '../../ui/MonoChip';
import { EmptyState } from '../../components/EmptyState';
import { getSupabase } from '../../lib/auth/supabase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { formatSignedAt } from '../checkout/ContractListScreen';
import {
  type ServerTimeAnchor,
  getServerTimeAnchorFromSession,
} from '../flow-runner/FlowRunnerScreen';
import { aggregateWallet } from './aggregateWallet';
import { type WalletDeal, createWalletRepo } from './db/walletRepo';
import { type WalletState, deriveWalletState } from './deriveWalletState';
import { formatEur } from './formatEur';

/** Placeholder for an unresolvable/absent commission (mirrors formatEur's null
 * contract) — a null rate renders "—", never "NaN €". */
const EMPTY_AMOUNT = '—';

/** Per-state chip copy key (D-01). Keeps "Widerruf" untranslated (legal term). */
export const WALLET_STATE_LABEL_KEY: Record<WalletState, TranslationKey> = {
  in_review: 'wallet.stateInReview',
  secured: 'wallet.stateSecured',
  reversed: 'wallet.stateReversed',
};

/**
 * Per-state MaterialCommunityIcons glyph (Foundations SSOT: status is ALWAYS
 * icon + label, never colour alone). Mirrors the traffic-light semantics —
 * secured→check, in_review→clock, reversed→cancel.
 */
const WALLET_STATE_ICON: Record<WalletState, React.ComponentProps<typeof MaterialCommunityIcons>['name']> = {
  in_review: 'clock-outline',
  secured: 'check-circle',
  reversed: 'cancel',
};

/** One list row, already reduced to display strings + its derived state. */
export interface WalletRowView {
  id: string;
  dealReference: string;
  customerName: string;
  signedAtLabel: string;
  /** de-DE formatted commission, or "—" for a null amount. */
  commissionLabel: string;
  state: WalletState;
}

export interface WalletViewModel {
  kpis: {
    dealsThisMonth: number;
    /** de-DE formatted secured commission total (D-10). */
    securedEur: string;
    /** de-DE formatted under-review commission total (D-10). */
    underReviewEur: string;
  };
  rows: WalletRowView[];
}

/**
 * Pure view-model builder (WALT-01/D-01/D-03/D-04/D-10). Deterministic in
 * `nowMs` so it is unit-testable without touching the device clock.
 *
 * Every deal becomes a row — a `reversed` deal is classified and DISPLAYED,
 * never filtered out (D-01 transparency). The three KPI figures come from the
 * pure `aggregateWallet` (reversed deals count toward `dealsThisMonth` but
 * toward NEITHER euro total). The 14-day secured/under-review boundary is
 * evaluated against `nowMs` — the caller anchors that to the server-time JWT
 * `iat`, not the raw device clock (Pitfall 2 / T-06-09).
 */
export function buildWalletView(deals: WalletDeal[], nowMs: number): WalletViewModel {
  // Derive each deal's state ONCE (single source), then project both the rows
  // and the aggregate input from it — no parallel-index lookup, no re-derive.
  const enriched = deals.map((deal) => ({
    deal,
    state: deriveWalletState(deal.signedAtIso, nowMs, deal.cancelledAtIso),
  }));

  const rows: WalletRowView[] = enriched.map(({ deal, state }) => ({
    id: deal.id,
    dealReference: deal.dealReference,
    customerName: deal.customerName,
    signedAtLabel: formatSignedAt(deal.signedAtIso),
    commissionLabel: deal.commissionEur === null ? EMPTY_AMOUNT : formatEur(deal.commissionEur),
    state,
  }));

  const totals = aggregateWallet(
    enriched.map(({ deal, state }) => ({
      signedAtIso: deal.signedAtIso,
      commissionEur: deal.commissionEur,
      state,
    })),
    new Date(nowMs),
  );

  return {
    kpis: {
      dealsThisMonth: totals.dealsThisMonth,
      securedEur: formatEur(totals.securedEur),
      underReviewEur: formatEur(totals.underReviewEur),
    },
    rows,
  };
}

export interface WalletScreenProps {
  db: AbstractPowerSyncDatabase;
  /** The rep whose wallet to show (MapScreen passes `userId`). UI narrowing on
   * top of RLS/sync-scoped local rows — not the security boundary (T-06-07). */
  repId: string;
  onClose: () => void;
  /** Injectable server-time anchor resolver (defaults to the shared Supabase-JWT
   * `iat` reader) — the test seam that keeps `nowMs` deterministic without
   * mocking the global clock. */
  getServerTimeAnchor?: () => Promise<ServerTimeAnchor | null>;
}

const defaultGetServerTimeAnchor = (): Promise<ServerTimeAnchor | null> =>
  getServerTimeAnchorFromSession(() => getSupabase().auth.getSession());

/**
 * Read-only wallet (WALT-01/WALT-02, D-03/D-05). A 3-KPI header over an
 * expandable per-deal list, reactive to every sync landing via
 * `walletRepo.watchWallet`. Reversed (Widerruf) deals render as a visible
 * reversal row — never silently dropped (D-01). Mirrors ContractListScreen's
 * read-only skeleton (header + empty-state + FlatList of non-interactive rows).
 */
export function WalletScreen({ db, repId, onClose, getServerTimeAnchor }: WalletScreenProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Applied at the CALL SITE, never baked into the memoized styles — the
  // inset is a device property, the stylesheet is not (ContractListScreen's
  // precedent). Without it this screen's back button and title drew under
  // the status bar clock on a notched iPhone.
  const insets = useSafeAreaInsets();
  const [deals, setDeals] = useState<WalletDeal[]>([]);
  // nowMs anchor resolved once on mount; starts at the device clock and is
  // bumped to the server-time floor once the JWT `iat` lands (a fast-forwarded
  // device clock can only ever RAISE nowMs, never lower it — T-06-09).
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const repo = createWalletRepo({ db });
    return repo.watchWallet(repId, setDeals);
  }, [db, repId]);

  useEffect(() => {
    let cancelled = false;
    const resolve = getServerTimeAnchor ?? defaultGetServerTimeAnchor;
    void resolve().then((anchor) => {
      if (cancelled) return;
      // Server-time floor: max(deviceNow, iat*1000). Never trust a device clock
      // running BEHIND the server to leave a deal "in_review" longer.
      setNowMs(Math.max(Date.now(), (anchor?.iat ?? 0) * 1000));
    });
    return () => {
      cancelled = true;
    };
  }, [getServerTimeAnchor]);

  const view = buildWalletView(deals, nowMs);

  return (
    <View style={styles.container} testID="wallet-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.lg }]}>
        <Pressable
          style={styles.closeButton}
          accessibilityRole="button"
          accessibilityLabel={t('cta.cancel')}
          onPress={onClose}
        >
          <MaterialCommunityIcons name="chevron-left" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('wallet.title')}</Text>
      </View>

      <View style={styles.kpiRow}>
        <KpiTile label={t('wallet.dealsThisMonth')} value={String(view.kpis.dealsThisMonth)} />
        <KpiTile label={t('wallet.secured')} value={view.kpis.securedEur} />
        <KpiTile label={t('wallet.underReview')} value={view.kpis.underReviewEur} />
      </View>

      {view.rows.length === 0 ? (
        <EmptyState
          testID="wallet-empty-state"
          icon="wallet-outline"
          title={t('wallet.emptyHeading')}
          description={t('wallet.emptyBody')}
        />
      ) : (
        <FlatList
          data={view.rows}
          keyExtractor={(row) => row.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => <WalletRow row={item} />}
          ItemSeparatorComponent={() => <View style={styles.rowGap} />}
        />
      )}
    </View>
  );
}

function KpiTile({ label, value }: { label: string; value: string }) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Card style={styles.kpiTile}>
      <Text style={styles.kpiValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </Card>
  );
}

/**
 * Non-interactive wallet row in the FrontDoorSales card language: mono deal-ref
 * chip, customer name, signed-at on the left; commission (Space-Grotesk-700
 * price) and an icon+label state chip on the right. The state chip carries a
 * glyph AND a label (Foundations: status is never colour alone); reversed rows
 * stay visible (D-01), never filtered out.
 */
function WalletRow({ row }: { row: WalletRowView }) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Card style={styles.rowCard}>
      <View style={styles.rowInner} accessibilityRole="none">
        <View style={styles.rowMain}>
          <Text style={styles.customerName} numberOfLines={1}>
            {row.customerName}
          </Text>
          <MonoChip bare style={styles.dealReference}>
            {row.dealReference}
          </MonoChip>
          <Text style={styles.signedAt}>{row.signedAtLabel}</Text>
        </View>
        <View style={styles.rowSide}>
          <Text style={styles.commission}>{row.commissionLabel}</Text>
          <View style={[styles.stateChip, { backgroundColor: walletStateColor[row.state] }]}>
            <MaterialCommunityIcons
              name={WALLET_STATE_ICON[row.state]}
              size={13}
              color={colors.onAccent}
              style={styles.stateChipIcon}
            />
            <Text style={styles.stateChipText}>{t(WALLET_STATE_LABEL_KEY[row.state])}</Text>
          </View>
        </View>
      </View>
    </Card>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    // Overridden at the call site with the real inset; this is the floor for a
    // device that reports none.
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
  headerTitle: { ...typography.display, color: colors.textPrimary, marginLeft: spacing.md },
  kpiRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  kpiTile: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
  },
  kpiValue: { ...typography.heading, color: colors.textPrimary, textAlign: 'center' },
  kpiLabel: {
    ...typography.label,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
  rowGap: { height: spacing.sm + spacing.xs },
  rowCard: { padding: spacing.md + 2 },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  rowMain: { flex: 1, marginRight: spacing.sm },
  rowSide: { alignItems: 'flex-end' },
  dealReference: { marginTop: spacing.xs - 1 },
  customerName: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  signedAt: { ...typography.label, color: colors.textSecondary, marginTop: spacing.xs - 1 },
  commission: { ...typography.price, color: colors.textPrimary },
  stateChip: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
  },
  stateChipIcon: { marginRight: spacing.xs },
  stateChipText: { ...typography.label, fontWeight: '600', color: colors.onAccent },
  });
}
