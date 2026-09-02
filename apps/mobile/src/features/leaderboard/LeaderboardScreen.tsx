import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { radius, spacing, typography } from '../../design/tokens';
import { type TranslationKey, t } from '../../i18n';
import { Card } from '../../ui/Card';
import { EmptyState } from '../../components/EmptyState';
import { useRoleScope, type RoleScopeTeam } from '../auth/useRoleScope';
import { useDealClosedBroadcast } from '../notifications/useDealClosedBroadcast';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { formatEur } from '../wallet/formatEur';
import {
  useLeaderboard,
  type LeaderboardEntry,
  type LeaderboardPeriod,
  type LeaderboardScope,
} from './useLeaderboard';

/**
 * LeaderboardScreen — GAMI-01/03, revised D-01/D-05. Outcome-only ranked list
 * (rank, name, deals, commission when the org opted in) for a team the rep
 * SELECTS from their own `useRoleScope().teams` membership list — there is NO
 * engineering-chosen default team (revised D-01): a single-team rep sees
 * their one team pre-selected; a multi-team rep must pick before any data
 * fetches. The org-wide scope toggle only ever renders when
 * `useRoleScope().isOrgAdminOf(team.salesOrgId)` is true for the SELECTED
 * team (UX gate only — `leaderboard_entries` re-checks the opt-in
 * server-side regardless, T-09-04). Reuses WalletScreen's header/card/chip
 * design language — no new visual language.
 */

const PERIOD_KEYS: Record<LeaderboardPeriod, TranslationKey> = {
  day: 'leaderboard.periodDay',
  week: 'leaderboard.periodWeek',
  month: 'leaderboard.periodMonth',
};

const PERIOD_ORDER: LeaderboardPeriod[] = ['day', 'week', 'month'];

export interface LeaderboardScreenProps {
  onClose: () => void;
  /** The signed-in rep's own id — used ONLY for the "my rank" highlight (a UI
   * convenience). Never sent to the RPC as a filter (the server derives the
   * caller from the JWT). */
  repId: string | null;
}

export function LeaderboardScreen({ onClose, repId }: LeaderboardScreenProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Applied at the CALL SITE, never baked into the memoized styles — the
  // inset is a device property, the stylesheet is not (ContractListScreen's
  // precedent). Without it this screen's back button and title drew under
  // the status bar clock on a notched iPhone.
  const insets = useSafeAreaInsets();
  const roleScope = useRoleScope();
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [scope, setScope] = useState<LeaderboardScope>('team');
  const [period, setPeriod] = useState<LeaderboardPeriod>('week');

  // Single-team rep: pre-select their one team once useRoleScope() resolves
  // it (never a hardcoded/engineering-chosen default — revised D-01). A
  // multi-team rep sees no pre-selection and must tap one below.
  useEffect(() => {
    if (selectedTeamId !== null) return;
    if (roleScope.teams.length === 1) {
      setSelectedTeamId(roleScope.teams[0]?.id ?? null);
    }
  }, [roleScope.teams, selectedTeamId]);

  // If the rep-selected team no longer opts into org-wide scope (or the rep
  // switches to a team where they're not an org admin), fall back to 'team'
  // scope rather than silently keeping an org-scope request the UI can no
  // longer justify showing the toggle for.
  const selectedTeam = roleScope.teams.find((team) => team.id === selectedTeamId) ?? null;
  const canToggleScope =
    selectedTeam?.salesOrgId != null && roleScope.isOrgAdminOf(selectedTeam.salesOrgId);
  useEffect(() => {
    if (!canToggleScope && scope === 'org') setScope('team');
  }, [canToggleScope, scope]);

  // GAMI-04: bumped on every live "teammate closed a deal" broadcast so the
  // useLeaderboard effect below re-fetches the ranking while this screen is
  // focused — the notification itself is dispatched by useDealClosedBroadcast,
  // this is purely the live-refresh trigger.
  const [dealClosedRefreshToken, setDealClosedRefreshToken] = useState(0);
  const leaderboard = useLeaderboard(selectedTeamId, scope, period, dealClosedRefreshToken);

  // Foreground-only Realtime subscription on the rep's OWN scoped team topic
  // (D-03/GAMI-04) — active only while this screen holds a selected team;
  // unsubscribed automatically on unmount or whenever the team/scope/period
  // selection changes (no leaked channel, no background listener, T-09-15).
  useDealClosedBroadcast({
    teamId: selectedTeamId,
    scope,
    period,
    onDealClosed: () => setDealClosedRefreshToken((token) => token + 1),
  });

  return (
    <View style={styles.container} testID="leaderboard-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.lg }]}>
        <Pressable
          style={styles.closeButton}
          accessibilityRole="button"
          accessibilityLabel={t('cta.cancel')}
          onPress={onClose}
        >
          <MaterialCommunityIcons name="chevron-left" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('leaderboard.title')}</Text>
      </View>

      <TeamSelector
        teams={roleScope.teams}
        selectedTeamId={selectedTeamId}
        onSelect={setSelectedTeamId}
      />

      {selectedTeamId ? (
        <>
          <PeriodSegment value={period} onChange={setPeriod} />
          {canToggleScope ? <ScopeSegment value={scope} onChange={setScope} /> : null}

          {leaderboard.stale ? (
            <View style={styles.staleBanner} testID="leaderboard-stale-banner">
              <MaterialCommunityIcons name="cloud-off-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.staleBannerText}>{t('leaderboard.staleBanner')}</Text>
            </View>
          ) : null}

          {leaderboard.entries.length === 0 && !leaderboard.loading ? (
            <EmptyState
              testID="leaderboard-empty-state"
              icon="trophy-outline"
              title={t('leaderboard.emptyHeading')}
              description={t('leaderboard.emptyBody')}
            />
          ) : (
            <FlatList
              data={leaderboard.entries}
              keyExtractor={(entry) => entry.repId}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => (
                <LeaderboardRow entry={item} isSelf={repId !== null && item.repId === repId} />
              )}
              ItemSeparatorComponent={() => <View style={styles.rowGap} />}
            />
          )}
        </>
      ) : (
        <EmptyState
          testID="leaderboard-pick-team-state"
          icon="account-group-outline"
          title={t('leaderboard.pickTeamHeading')}
          description={t('leaderboard.pickTeamBody')}
        />
      )}
    </View>
  );
}

/**
 * Team-selector row (design mirrors AssignRepSheet's picker rows). Sourced
 * EXCLUSIVELY from `useRoleScope().teams` — the rep's own membership list,
 * never an engineering-chosen default. When the rep belongs to exactly one
 * team the picker collapses to a single non-interactive label (there is
 * nothing to choose between); otherwise every membership is a tappable chip.
 */
function TeamSelector({
  teams,
  selectedTeamId,
  onSelect,
}: {
  teams: RoleScopeTeam[];
  selectedTeamId: string | null;
  onSelect: (teamId: string) => void;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (teams.length === 0) return null;

  if (teams.length === 1) {
    return (
      <View style={styles.teamSelectorSingle} testID="leaderboard-team-label">
        <Text style={styles.teamSelectorSingleText}>{teams[0]?.name}</Text>
      </View>
    );
  }

  return (
    <View style={styles.teamSelectorWrap} testID="leaderboard-team-selector">
      <Text style={styles.teamSelectorLabel}>{t('leaderboard.teamSelectorLabel')}</Text>
      <View style={styles.teamChipRow}>
        {teams.map((team) => {
          const selected = team.id === selectedTeamId;
          return (
            <Pressable
              key={team.id}
              style={[styles.teamChip, selected ? styles.teamChipSelected : null]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onSelect(team.id)}
              testID={`leaderboard-team-option-${team.id}`}
            >
              <Text style={[styles.teamChipText, selected ? styles.teamChipTextSelected : null]}>
                {team.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Day / Woche / Monat segmented control (mirrors ContractListScreen's SegmentedFilter). */
function PeriodSegment({
  value,
  onChange,
}: {
  value: LeaderboardPeriod;
  onChange: (next: LeaderboardPeriod) => void;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.segment} accessibilityRole="tablist" testID="leaderboard-period-segment">
      {PERIOD_ORDER.map((key) => {
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
              {t(PERIOD_KEYS[key])}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Team vs. company-wide segmented control — rendered by the caller ONLY when
 * `useRoleScope().isOrgAdminOf(selectedTeam.salesOrgId)` is true for the
 * currently selected team (UX gate; `leaderboard_entries` is the real
 * authority and re-checks the org's `leaderboard_config` opt-in regardless).
 */
function ScopeSegment({
  value,
  onChange,
}: {
  value: LeaderboardScope;
  onChange: (next: LeaderboardScope) => void;
}) {
  const options: Array<{ key: LeaderboardScope; labelKey: TranslationKey }> = [
    { key: 'team', labelKey: 'leaderboard.scopeTeam' },
    { key: 'org', labelKey: 'leaderboard.scopeOrg' },
  ];
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.segment} accessibilityRole="tablist" testID="leaderboard-scope-segment">
      {options.map(({ key, labelKey }) => {
        const active = key === value;
        return (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.segmentItem, active && styles.segmentItemActive]}
            onPress={() => onChange(key)}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{t(labelKey)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** One ranked row: rank badge, name, deals count, commission (only when
 * present — a null commission_eur renders as absent, never "0 €"). The
 * rep's own row is highlighted ("my rank", design mirrors WalletRow's card
 * language). */
function LeaderboardRow({ entry, isSelf }: { entry: LeaderboardEntry; isSelf: boolean }) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Card style={[styles.rowCard, isSelf ? styles.rowCardSelf : null]}>
      <View style={styles.rowInner} testID={`leaderboard-row-${entry.repId}`}>
        <View style={styles.rankBadge}>
          <Text style={styles.rankBadgeText}>{entry.rank}</Text>
        </View>
        <View style={styles.rowMain}>
          <Text style={styles.rowName} numberOfLines={1}>
            {entry.displayName}
          </Text>
          <Text style={styles.rowDeals}>
            {entry.dealsCount} {t('leaderboard.dealsSuffix')}
          </Text>
        </View>
        {entry.commissionEur !== null ? (
          <Text style={styles.rowCommission}>{formatEur(entry.commissionEur)}</Text>
        ) : null}
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
  teamSelectorSingle: { paddingHorizontal: spacing.md, marginBottom: spacing.md },
  teamSelectorSingleText: { ...typography.heading, color: colors.textPrimary },
  teamSelectorWrap: { paddingHorizontal: spacing.md, marginBottom: spacing.md },
  teamSelectorLabel: {
    ...typography.label,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  teamChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  teamChip: {
    minHeight: spacing.touchTarget - 8,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  teamChipSelected: { borderColor: colors.accent, backgroundColor: colors.subtleFill },
  teamChipText: { ...typography.body, color: colors.textPrimary },
  teamChipTextSelected: { fontWeight: '600' },
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
  staleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.secondary,
  },
  staleBannerText: { ...typography.label, color: colors.textSecondary },
  listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
  rowGap: { height: spacing.sm + spacing.xs },
  rowCard: { padding: spacing.md + 2 },
  rowCardSelf: { borderWidth: 1.5, borderColor: colors.accent },
  rowInner: { flexDirection: 'row', alignItems: 'center' },
  rankBadge: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.subtleFill,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md - 2,
  },
  rankBadgeText: { ...typography.label, fontWeight: '700', color: colors.textPrimary },
  rowMain: { flex: 1, minWidth: 0 },
  rowName: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  rowDeals: { ...typography.label, color: colors.textSecondary, marginTop: spacing.xs - 1 },
  rowCommission: { ...typography.price, color: colors.textPrimary, marginLeft: spacing.sm },
  });
}
