import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { radius, spacing, typography } from '../../../design/tokens';
import { t } from '../../../i18n';
import { getSupabase } from '../../../lib/auth/supabase';
import { useThemeColors } from '../../settings/theme/useThemeColors';
import {
  createDefaultWipeDeps,
  readWipeReadiness,
  runDrainThenPurge,
  type WipeDeps,
  type WipeEntryPoint,
  type WipePhase,
} from './wipeMachinery';

/**
 * LocalWipeScreen — SEC-07 (D-01/D-02/D-04), 15-UI-SPEC.md §5. The ONE wipe
 * screen this phase ships (D-04: "Do not build a second wipe screen/component
 * for the PIN-lockout entry point"). Reached two ways:
 *   - `entry="local"` (default, `skipConfirm=false`) — the "Gerät
 *     zurücksetzen" row in Einstellungen's Sicherheit card (plan 15-10 Task 3).
 *   - `entry="pin-lockout"` (`skipConfirm=true`) — rendered directly by
 *     `AppLockGate.tsx`'s attempt-10 branch (plan 15-10 Task 3); the rep is
 *     already locked out, so there is nothing left to confirm, but the
 *     blocked/blocked-unverified-path states are NOT skipped — D-12 inherits
 *     D-01 without exception.
 *
 * Five rendered states, driven by `WipePhase` (plus a local `'loading'` meta
 * state before the first readiness check resolves):
 *   - `blocked` — informational only, single "Verstanden" dismiss, NO
 *     destructive action reachable (SEC-07's local wipe has no D-03-style
 *     escape hatch — that exists only on the org-admin's remote path).
 *   - `blocked-unverified-path` — its OWN terminal state, visually identical
 *     in weight to `blocked` (informational, no accent/destructive color), NO
 *     retry (retrying changes nothing until plan 15-01's probe resolves the
 *     path on a real device) and NEVER rendered as a generic error.
 *   - `ready` — the heavier two-tier confirm (`SessionsScreen.tsx`'s modal
 *     structure, reused verbatim), skipped entirely when `skipConfirm`.
 *   - `purging` — never claims completion before `runDrainThenPurge` resolves
 *     (`onPhase`-driven, mirrors `SessionsScreen.tsx`'s refresh-confirms-truth
 *     discipline escalated to the whole screen).
 *   - `complete` — then returns to Login through the EXISTING sign-out
 *     transition in `RootNavigator` (calling `supabase.auth.signOut()`
 *     here, not a bespoke success screen — `RootNavigator`'s
 *     `onAuthStateChange` listener does the actual navigation).
 *   - `failed` — surfaces the message; NEVER falls through to `complete`.
 *
 * Deliberately takes `onDismiss` as a PROP rather than calling
 * `useNavigation()` itself: `AppLockGate.tsx` mounts this component OUTSIDE
 * `NavigationContainer` entirely (`RootNavigator.tsx` replaces the whole nav
 * tree with `AppLockGate` while locked — see its own header comment), so a
 * `useNavigation()` call inside this file would throw the instant the
 * pin-lockout entry point rendered it. The `local` entry point (registered as
 * an ordinary `ProfilStack` screen, WHERE a `NavigationContainer` DOES exist)
 * supplies `onDismiss={() => navigation.goBack()}` via a thin route wrapper —
 * the SAME "resolve navigation/db at the route level, pass it down as a prop"
 * shape `ProfilStack.tsx`'s existing `WalletRoute`/`LeaderboardRoute` already
 * use, not a new pattern.
 */

export interface LocalWipeScreenProps {
  /** 'local' (default) or 'pin-lockout' (AppLockGate's attempt-10 branch). */
  entry?: WipeEntryPoint;
  /** True only for the pin-lockout entry point — D-04: "the confirmation step is skipped". */
  skipConfirm?: boolean;
  /** Called from the header back button, a `blocked`/`blocked-unverified-path`
   * dismiss, or Cancel in the confirm modal. Defaults to a no-op — the
   * pin-lockout entry point has nowhere to go back to (gateState 'wipe' is
   * terminal, `pinAttempts.ts`'s own header comment), so it simply omits this
   * prop rather than reaching for a `useNavigation()` this file cannot call. */
  onDismiss?: () => void;
  /**
   * True when the MOUNT already applied the safe-area inset, so this screen
   * must not apply it again.
   *
   * This screen has two mounts with OPPOSITE requirements, which is why this
   * is an explicit prop and not a removed line:
   *
   *   - `ProfilStack`'s `GeraetZuruecksetzenRoute` — an ordinary navigator
   *     route with the header hidden, nothing above it pads anything. The
   *     inset here is CORRECT and load-bearing: without it the back chevron
   *     sits under the clock.
   *
   *   - `AppLockGate` — renders this screen INSIDE its own ScrollView, whose
   *     contentContainerStyle already carries
   *     `paddingTop: insets.top + spacing.lg`. Applying the inset again there
   *     pushed the whole wipe screen down by a second status bar.
   *
   * Whoever owns the padded container passes this; nobody else does. Naming
   * it after the mount's behaviour rather than a screen-level layout flag is
   * deliberate — the answer belongs to the mount, and only the mount knows it.
   */
  embeddedInPaddedContainer?: boolean;
  /** Injected in tests; defaults to the real native wiring in production. */
  deps?: WipeDeps;
  /** Injected in tests; defaults to `getSupabase().auth.signOut()`. */
  signOut?: () => Promise<unknown>;
}

/** Pure: the screen's initial phase from the two READ-ONLY checks — never
 * itself destructive. `dbPathVerified` is checked first (T-15-10-09), mirroring
 * `runDrainThenPurge`'s own gate order exactly, so the screen never shows a
 * confirm dialog for a purge that would immediately refuse to run. */
export function deriveInitialWipePhase(dbPathVerified: boolean, readiness: WipePhase): WipePhase {
  if (!dbPathVerified) {
    return { kind: 'blocked-unverified-path' };
  }
  return readiness;
}

/** Pure: the pin-lockout entry point has nothing left to confirm — it starts
 * the purge itself the instant the (read-only) checks say `ready`. */
export function shouldAutoStartPurge(phase: WipePhase, skipConfirm: boolean): boolean {
  return skipConfirm && phase.kind === 'ready';
}

type ScreenPhase = { kind: 'loading' } | WipePhase;

const NOOP = () => undefined;

export function LocalWipeScreen({
  entry = 'local',
  skipConfirm = false,
  onDismiss = NOOP,
  embeddedInPaddedContainer = false,
  deps,
  signOut,
}: LocalWipeScreenProps) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const wipeDeps = useMemo(() => deps ?? createDefaultWipeDeps(), [deps]);
  const [phase, setPhase] = useState<ScreenPhase>({ kind: 'loading' });
  const purgeStartedRef = useRef(false);
  const signOutFiredRef = useRef(false);

  const startPurge = useCallback(async () => {
    if (purgeStartedRef.current) return;
    purgeStartedRef.current = true;
    await runDrainThenPurge(entry, { ...wipeDeps, onPhase: setPhase });
  }, [entry, wipeDeps]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const readiness = await readWipeReadiness(wipeDeps);
      if (cancelled) return;
      const initial = deriveInitialWipePhase(wipeDeps.dbPathVerified, readiness);
      setPhase(initial);
      if (shouldAutoStartPurge(initial, skipConfirm)) {
        void startPurge();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wipeDeps, skipConfirm, startPurge]);

  // Completion (D-02: never before the purge promise resolves — `phase`
  // only reaches 'complete' via runDrainThenPurge's own onPhase callback
  // above, never optimistically) returns to Login through the EXISTING
  // sign-out transition in RootNavigator's onAuthStateChange listener.
  useEffect(() => {
    if (phase.kind !== 'complete' || signOutFiredRef.current) return;
    signOutFiredRef.current = true;
    const doSignOut = signOut ?? (() => getSupabase().auth.signOut());
    void doSignOut().catch(() => undefined);
  }, [phase.kind, signOut]);

  // No header back button when the caller supplied no real onDismiss (the
  // pin-lockout entry point, mounted outside NavigationContainer — see the
  // header comment) — there is nowhere for it to go.
  const canGoBack = onDismiss !== NOOP && phase.kind !== 'purging' && phase.kind !== 'complete';

  return (
    // The inset is applied HERE only when nothing above already did — see
    // `embeddedInPaddedContainer`. `spacing.lg` is the screen's own breathing
    // room and stays in both cases; only the safe-area part is conditional,
    // because only the safe-area part is what the container duplicated.
    <View
      style={[
        styles.container,
        {
          paddingTop: (embeddedInPaddedContainer ? 0 : insets.top) + spacing.lg,
          paddingBottom: (embeddedInPaddedContainer ? 0 : insets.bottom) + spacing.lg,
        },
      ]}
    >
      {canGoBack ? (
        <Pressable
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={onDismiss}
          hitSlop={8}
        >
          <MaterialCommunityIcons name="chevron-left" size={26} color={colors.textPrimary} />
        </Pressable>
      ) : null}

      <View style={styles.content}>
        {phase.kind === 'loading' ? (
          <ActivityIndicator color={colors.accent} testID="wipe-loading" />
        ) : phase.kind === 'blocked' ? (
          <BlockedBlock
            title={t('sec.wipeBlockedTitle')}
            body={t('sec.wipeBlockedBody').replace('{{n}}', String(phase.pendingCount))}
            styles={styles}
            onDismiss={onDismiss}
          />
        ) : phase.kind === 'blocked-unverified-path' ? (
          <BlockedBlock
            title={t('sec.wipeBlockedTitle')}
            body={t('sec.wipeUnverifiedPath')}
            styles={styles}
            onDismiss={onDismiss}
          />
        ) : phase.kind === 'ready' && !skipConfirm ? (
          <ConfirmBlock styles={styles} colors={colors} onConfirm={() => void startPurge()} onCancel={onDismiss} />
        ) : phase.kind === 'ready' ? (
          // skipConfirm entry (pin-lockout) — startPurge already fired from
          // the effect above; render the purging copy while it resolves.
          <ProgressBlock styles={styles} colors={colors} />
        ) : phase.kind === 'purging' ? (
          <ProgressBlock styles={styles} colors={colors} />
        ) : phase.kind === 'complete' ? (
          <Text style={styles.statusText} testID="wipe-complete">
            {t('sec.wipeComplete')}
          </Text>
        ) : (
          <View style={styles.failedBlock}>
            <MaterialCommunityIcons name="alert-circle-outline" size={28} color={colors.destructive} />
            <Text style={styles.failedText}>{phase.message}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function BlockedBlock({
  title,
  body,
  styles,
  onDismiss,
}: {
  title: string;
  body: string;
  styles: ReturnType<typeof makeStyles>;
  onDismiss: () => void;
}) {
  return (
    <View style={styles.blockedBlock}>
      <Text style={styles.blockedTitle}>{title}</Text>
      <Text style={styles.blockedBody}>{body}</Text>
      <Pressable style={styles.dismissButton} accessibilityRole="button" onPress={onDismiss}>
        <Text style={styles.dismissButtonText}>{t('sec.wipeBlockedDismiss')}</Text>
      </Pressable>
    </View>
  );
}

function ProgressBlock({
  styles,
  colors,
}: {
  styles: ReturnType<typeof makeStyles>;
  colors: ReturnType<typeof useThemeColors>;
}) {
  return (
    <View style={styles.progressBlock}>
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.statusText}>{t('sec.wipeInProgress')}</Text>
    </View>
  );
}

function ConfirmBlock({
  styles,
  colors,
  onConfirm,
  onCancel,
}: {
  styles: ReturnType<typeof makeStyles>;
  colors: ReturnType<typeof useThemeColors>;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <Pressable style={styles.modalBackdrop} accessibilityRole="button" onPress={onCancel} />
      <View style={styles.modalAnchor} pointerEvents="box-none">
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{t('sec.wipeConfirmTitle')}</Text>
          <Text style={styles.modalBody}>{t('sec.wipeConfirmBody')}</Text>
          <View style={styles.modalActions}>
            <Pressable style={styles.modalCancelButton} accessibilityRole="button" onPress={onCancel}>
              <Text style={styles.modalCancelText}>{t('cta.cancel')}</Text>
            </Pressable>
            <Pressable style={styles.modalConfirmButton} accessibilityRole="button" onPress={onConfirm}>
              <Text style={[styles.modalConfirmText, { color: colors.onAccent }]}>{t('sec.wipeConfirmCta')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.xl },
    backButton: {
      width: spacing.touchTarget,
      height: spacing.touchTarget,
      borderRadius: radius.input,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.lg,
    },
    content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
    // Deliberately NO accent/destructive color anywhere in this block
    // (15-UI-SPEC.md §5/"Visual Anchor by Screen" — the quietest screen this
    // phase adds, informational, not actionable).
    blockedBlock: { alignItems: 'center', gap: spacing.md, width: '100%' },
    blockedTitle: { ...typography.heading, color: colors.textPrimary, textAlign: 'center' },
    blockedBody: { ...typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },
    dismissButton: {
      minHeight: spacing.touchTarget,
      minWidth: 160,
      borderRadius: radius.input,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
      marginTop: spacing.sm,
    },
    dismissButtonText: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
    progressBlock: { alignItems: 'center', gap: spacing.md },
    statusText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
    failedBlock: { alignItems: 'center', gap: spacing.sm },
    failedText: { ...typography.body, color: colors.destructive, textAlign: 'center' },
    modalBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(13,22,38,0.45)' },
    modalAnchor: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
    modalCard: { width: '100%', backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.lg, gap: spacing.md },
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
    modalConfirmText: { ...typography.body, fontWeight: '600', textAlign: 'center' },
  });
}
