import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { radius, spacing, typography } from '../../design/tokens';
import { t } from '../../i18n';
import { formatRelative } from '../../lib/datetime/format';
import { MonoChip } from '../../ui/MonoChip';
import { useThemeColors } from './theme/useThemeColors';
import { createSessionsRepo, type SessionRow, type SessionsRepo } from './db/sessionsRepo';
import { useAppLock, type LockReason } from '../app-lock/AppLockProvider';

/**
 * SessionsScreen — SEC-06, D-07/D-11/D-13/D-14/D-22. Every rep-facing
 * session on the account, with a two-tier revoke confirmation
 * (`deriveConfirmTier`) and an honest, non-instant post-revoke state
 * (`deriveRowState`'s `'revoking'` case — never a completed "Widerrufen").
 *
 * Composed from the existing `EinstellungenScreen.tsx` `card`/
 * `accessibilityRow` idiom (14-UI-SPEC.md: "Do not build a new list/row
 * primitive") — the one genuinely new visual element is the raw
 * user-agent inset block (`colors.subtleFill`).
 *
 * Deliberately NOT wrapped in `DbBoundary` — this screen reads exclusively
 * from the two SEC-06 RPCs via `sessionsRepo.ts`, never the local PowerSync
 * database (Iron Rule 1 does not apply to a live, server-authoritative
 * session list).
 *
 * Navigation into this screen is plan 14-08's job (`RootNavigator.tsx`/
 * `navigation.ts`) — this file only calls `navigation.goBack()` for its own
 * header back button, mirroring `EinstellungenScreen.tsx`'s header exactly.
 */

/** `deriveRowState`'s discriminated union — drives which revoke affordance renders per row. */
export type RevokeRowState = 'idle' | 'confirming' | 'revoking';

/** `deriveConfirmTier`'s discriminated union — 'modal' exactly when the row is the caller's own current session (D-22). */
export type ConfirmTier = 'inline' | 'modal';

/**
 * Pure: current-device sessions (`is_current`) get the heavier modal tier;
 * every other session gets the lighter inline tier. `is_current` is
 * UX-only (never a security boundary) — it selects a confirmation tier,
 * never an authorization outcome (sessionsRepo.ts header comment,
 * 14-RESEARCH.md Anti-Patterns).
 */
export function deriveConfirmTier(session: Pick<SessionRow, 'isCurrent'>): ConfirmTier {
  return session.isCurrent ? 'modal' : 'inline';
}

/**
 * Pure: derives a session row's revoke-affordance state from the two pieces
 * of screen-local state that can affect it. `pendingRevokeIds` wins over
 * `confirmingId` — a row already mid-revoke never reverts to a confirm
 * prompt. Used identically for BOTH the inline and modal confirm tiers
 * (`deriveConfirmTier` decides which WIDGET renders for `'confirming'`, not
 * this function).
 */
export function deriveRowState(
  session: Pick<SessionRow, 'id'>,
  pendingRevokeIds: ReadonlySet<string>,
  confirmingId: string | null,
): RevokeRowState {
  if (pendingRevokeIds.has(session.id)) return 'revoking';
  if (confirmingId === session.id) return 'confirming';
  return 'idle';
}

/**
 * D-16/WR-08: pure/DI'd core so the revoke->lock behavior is directly
 * testable without mounting `SessionsScreen` (this repo has no
 * react-native-testing-library, same posture as `performPasswordChange` in
 * `ChangePasswordScreen.tsx`). Revokes the session first; `lock('session-revoked')`
 * fires ONLY when `isCurrent` is true and ONLY after the revoke RPC resolves
 * — never before, never for a non-current session.
 */
export async function confirmRevokeSession({
  repo,
  lock,
  id,
  isCurrent,
}: {
  repo: Pick<SessionsRepo, 'revokeSession'>;
  lock: (reason: LockReason) => void;
  id: string;
  isCurrent: boolean;
}): Promise<void> {
  await repo.revokeSession(id);
  if (isCurrent) {
    lock('session-revoked');
  }
}

export function SessionsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const repo = useMemo<SessionsRepo>(() => createSessionsRepo(), []);
  const { lock } = useAppLock();

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [revokeError, setRevokeError] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pendingRevokeIds, setPendingRevokeIds] = useState<ReadonlySet<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const rows = await repo.listSessions();
      setSessions(rows);
      setLoadError(false);
    } catch {
      // Keep the last-known list on screen rather than clearing it to an
      // empty (falsely "no sessions") state — sessions.loadErrorGeneric
      // renders alongside whatever was last successfully loaded.
      setLoadError(true);
    }
  }, [repo]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refresh();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const handlePressRevoke = (session: SessionRow) => {
    setRevokeError(false);
    setConfirmingId(session.id);
  };

  const handleCancelConfirm = () => setConfirmingId(null);

  const handleConfirmRevoke = async (id: string) => {
    // D-16/WR-08: captured BEFORE the await — the row for `id` may or may
    // not still be present in `sessions` after `refresh()` below, but the
    // "was this the caller's own current session" fact is fixed at the
    // moment the revoke was confirmed.
    const isOwnCurrentSession = sessions.find((s) => s.id === id)?.isCurrent ?? false;
    setConfirmingId(null);
    setRevokeError(false);
    setPendingRevokeIds((prev) => new Set(prev).add(id));
    try {
      // D-16/WR-08: the heaviest confirmation dialog in the product must do
      // something visible on the ACTING device the instant it resolves —
      // today's row-delete-and-refetch alone leaves the local access token
      // valid for up to `jwt_expiry` (900s), so the app stays fully usable
      // for up to 15 minutes after this confirmation. `confirmRevokeSession`
      // calls `lock('session-revoked')` AFTER the revoke RPC resolves,
      // closing that gap by making this device unusable immediately.
      // `sessions.latencyExplainer` below is KEPT, not deleted — it still
      // states a true server-side fact (the revoked session's access token
      // remains cryptographically valid until it expires) that this lock
      // does not change; the lock only stops THIS device from using it.
      await confirmRevokeSession({ repo, lock, id, isCurrent: isOwnCurrentSession });
      // Honest bound (D-07): the row is NOT removed here. It stays visible
      // in the 'revoking' state (rendered via pendingRevokeIds) until this
      // refresh no longer returns it — a genuine DELETE (D-13) is expected
      // to drop it from the very next list, but the row never disappears
      // on the strength of "the call resolved" alone.
      await refresh();
    } catch {
      setRevokeError(true);
      setPendingRevokeIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const modalTarget =
    confirmingId != null ? sessions.find((s) => s.id === confirmingId && s.isCurrent) : undefined;

  return (
    <View style={styles.container} testID="sessions-screen">
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
        <Text style={styles.title}>{t('sessions.title')}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Standing explainer, shown on EVERY visit before any revoke happens
            (D-07) — never an after-the-fact toast. */}
        <Text style={styles.latencyExplainer}>{t('sessions.latencyExplainer')}</Text>

        {revokeError ? <Text style={styles.errorText}>{t('sessions.revokeErrorGeneric')}</Text> : null}
        {loadError ? <Text style={styles.errorText}>{t('sessions.loadErrorGeneric')}</Text> : null}

        {loading ? (
          <ActivityIndicator color={colors.accent} style={styles.loadingIndicator} />
        ) : sessions.length === 0 && !loadError ? (
          <View style={styles.card}>
            <View style={styles.emptyBlock}>
              <Text style={styles.emptyHeading}>{t('sessions.emptyHeading')}</Text>
              <Text style={styles.emptyBody}>{t('sessions.emptyBody')}</Text>
            </View>
          </View>
        ) : (
          <View style={styles.card}>
            {sessions.map((session, index) => (
              <SessionRowItem
                key={session.id}
                session={session}
                rowState={deriveRowState(session, pendingRevokeIds, confirmingId)}
                tier={deriveConfirmTier(session)}
                last={index === sessions.length - 1}
                colors={colors}
                onPressRevoke={() => handlePressRevoke(session)}
                onCancelConfirm={handleCancelConfirm}
                onConfirmRevoke={() => void handleConfirmRevoke(session.id)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {/* Heavier confirmation tier for the caller's own current session
          (D-22) — the action IS offered, never hidden or disabled, but
          gated behind an explicit modal rather than the lighter inline
          confirm every other row uses.
          After confirming, the row enters 'revoking' and the rep is NOT
          force-navigated anywhere here — the existing onAuthStateChange
          path (see EinstellungenScreen.tsx's handleSignOut comment) owns
          sign-out once the deleted session's refresh eventually fails.
          Do not add a second, competing sign-out here. */}
      <Modal
        visible={modalTarget != null}
        transparent
        animationType="fade"
        onRequestClose={handleCancelConfirm}
        statusBarTranslucent
      >
        <Pressable style={styles.modalBackdrop} accessibilityRole="button" onPress={handleCancelConfirm} />
        <View style={styles.modalAnchor} pointerEvents="box-none">
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('sessions.revokeCurrentConfirmTitle')}</Text>
            <Text style={styles.modalBody}>{t('sessions.revokeCurrentConfirmBody')}</Text>
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancelButton}
                accessibilityRole="button"
                onPress={handleCancelConfirm}
              >
                <Text style={styles.modalCancelText}>{t('cta.cancel')}</Text>
              </Pressable>
              <Pressable
                style={styles.modalConfirmButton}
                accessibilityRole="button"
                onPress={() => modalTarget && void handleConfirmRevoke(modalTarget.id)}
              >
                <Text style={styles.modalConfirmText}>{t('sessions.revokeCurrentConfirmCta')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

interface SessionRowItemProps {
  session: SessionRow;
  rowState: RevokeRowState;
  tier: ConfirmTier;
  last: boolean;
  colors: ReturnType<typeof useThemeColors>;
  onPressRevoke: () => void;
  onCancelConfirm: () => void;
  onConfirmRevoke: () => void;
}

function SessionRowItem({
  session,
  rowState,
  tier,
  last,
  colors,
  onPressRevoke,
  onCancelConfirm,
  onConfirmRevoke,
}: SessionRowItemProps) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const nowMs = Date.now();

  return (
    <View style={[styles.sessionRow, last ? null : styles.rowBordered]}>
      <View style={styles.sessionRowTop}>
        {session.isCurrent ? (
          <View
            style={styles.currentBadge}
            accessibilityLabel={t('sessions.currentDeviceBadge') + ' - aktuelle Sitzung'}
          >
            <MaterialCommunityIcons name="cellphone-check" size={14} color={colors.accent} />
            <Text style={styles.currentBadgeText}>{t('sessions.currentDeviceBadge')}</Text>
          </View>
        ) : null}
        <Text style={styles.lastActive}>
          {/* `refreshedAt` is NULL until a session's first token refresh —
              fall back to the session's own creation moment, which is the
              honest "last active" for a session that has not refreshed yet
              (never a fabricated date, never a blank). */}
          {`${t('sessions.lastActiveLabel')}: ${formatRelative(nowMs, session.refreshedAt ?? session.createdAt)}`}
        </Text>
      </View>

      <View style={styles.userAgentBlock}>
        <Text style={styles.userAgentCaption}>{t('sessions.userAgentCaption')}</Text>
        <Text style={styles.userAgentText}>{session.userAgent ?? ''}</Text>
      </View>

      <View style={styles.ipRow}>
        <Text style={styles.ipLabel}>{t('sessions.ipLabel')}</Text>
        {session.ip ? (
          <MonoChip bare>{session.ip}</MonoChip>
        ) : (
          <Text style={styles.ipUnavailable}>{t('sessions.ipUnavailable')}</Text>
        )}
      </View>

      {rowState === 'revoking' ? (
        <Text style={styles.revokingText}>{t('sessions.revokingState')}</Text>
      ) : rowState === 'confirming' && tier === 'inline' ? (
        <View style={styles.inlineConfirmBar}>
          <Text style={styles.inlineConfirmText}>{t('sessions.revokeConfirmInline')}</Text>
          <View style={styles.inlineConfirmActions}>
            <Pressable style={styles.inlineCancelButton} accessibilityRole="button" onPress={onCancelConfirm}>
              <Text style={styles.inlineCancelText}>{t('cta.cancel')}</Text>
            </Pressable>
            <Pressable style={styles.inlineConfirmButton} accessibilityRole="button" onPress={onConfirmRevoke}>
              <Text style={styles.inlineConfirmButtonText}>{t('sessions.revokeConfirmCta')}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        // rowState is 'idle', or ('confirming' with tier 'modal' — the modal
        // itself is the confirm affordance, rendered once at the screen
        // level; this row keeps showing its normal revoke CTA underneath.
        <Pressable
          style={styles.revokeButton}
          accessibilityRole="button"
          accessibilityLabel={t('sessions.revokeCta')}
          onPress={onPressRevoke}
        >
          <MaterialCommunityIcons name="close-circle-outline" size={16} color={colors.destructive} />
          <Text style={styles.revokeButtonText}>{t('sessions.revokeCta')}</Text>
        </Pressable>
      )}
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
    title: { ...typography.display, color: colors.textPrimary },
    content: { paddingHorizontal: spacing.md + spacing.xs, paddingBottom: spacing.xl, gap: spacing.md - 2 },
    latencyExplainer: { ...typography.label, color: colors.textSecondary, lineHeight: 20 },
    errorText: { ...typography.label, color: colors.destructive },
    loadingIndicator: { marginTop: spacing.lg },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    emptyBlock: { padding: spacing.lg, gap: spacing.xs },
    emptyHeading: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
    emptyBody: { ...typography.label, color: colors.textSecondary },
    sessionRow: {
      minHeight: 64,
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    rowBordered: { borderBottomWidth: 1, borderBottomColor: colors.border },
    sessionRowTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    currentBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      backgroundColor: colors.secondary,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: spacing.xs,
      minHeight: spacing.touchTarget,
    },
    currentBadgeText: { ...typography.label, fontWeight: '600', color: colors.accent },
    lastActive: { ...typography.label, color: colors.textSecondary, flexShrink: 1, textAlign: 'right' },
    userAgentBlock: {
      backgroundColor: colors.subtleFill,
      borderRadius: radius.input,
      padding: spacing.sm + spacing.xs,
      gap: spacing.xs,
    },
    userAgentCaption: { ...typography.label, color: colors.textSecondary },
    userAgentText: { ...typography.label, color: colors.textPrimary, lineHeight: 20 },
    ipRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    ipLabel: { ...typography.label, color: colors.textSecondary },
    ipUnavailable: { ...typography.mono, color: colors.textMuted },
    revokingText: { ...typography.label, color: colors.textSecondary, minHeight: spacing.touchTarget, textAlignVertical: 'center' },
    revokeButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs + 2,
      minHeight: spacing.touchTarget,
      borderRadius: radius.input,
      borderWidth: 1,
      borderColor: colors.destructive,
    },
    revokeButtonText: { ...typography.body, fontWeight: '600', color: colors.destructive },
    inlineConfirmBar: {
      borderWidth: 1.5,
      borderColor: colors.destructive,
      borderRadius: radius.input,
      padding: spacing.sm + spacing.xs,
      gap: spacing.sm,
    },
    inlineConfirmText: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
    inlineConfirmActions: { flexDirection: 'row', gap: spacing.sm },
    inlineCancelButton: {
      flex: 1,
      minHeight: spacing.touchTarget,
      borderRadius: radius.input,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    inlineCancelText: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
    inlineConfirmButton: {
      flex: 1,
      minHeight: spacing.touchTarget,
      borderRadius: radius.input,
      backgroundColor: colors.destructive,
      alignItems: 'center',
      justifyContent: 'center',
    },
    inlineConfirmButtonText: { ...typography.body, fontWeight: '600', color: colors.onAccent },
    modalBackdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(13,22,38,0.45)',
    },
    modalAnchor: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
    modalCard: {
      width: '100%',
      backgroundColor: colors.surface,
      borderRadius: radius.card,
      padding: spacing.lg,
      gap: spacing.md,
    },
    modalTitle: { ...typography.heading, color: colors.textPrimary },
    modalBody: { ...typography.body, color: colors.textSecondary, lineHeight: 22 },
    modalActions: { flexDirection: 'row', gap: spacing.sm },
    modalCancelButton: {
      flex: 1,
      minHeight: spacing.touchTarget,
      borderRadius: radius.input,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalCancelText: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
    modalConfirmButton: {
      flex: 1,
      minHeight: spacing.touchTarget,
      borderRadius: radius.input,
      backgroundColor: colors.destructive,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.sm,
    },
    modalConfirmText: { ...typography.body, fontWeight: '600', color: colors.onAccent, textAlign: 'center' },
  });
}
