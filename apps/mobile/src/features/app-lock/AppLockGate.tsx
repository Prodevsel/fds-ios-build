import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { radius, spacing, typography } from '../../design/tokens';
import { t } from '../../i18n';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { TenantBadge } from '../profile/TenantBadge';
import { useSessionIdentity } from '../profile/useSessionIdentity';
import { useTenantIdentity } from '../profile/useTenantIdentity';
import { useAppLock } from './AppLockProvider';
import {
  attemptBiometricUnlock,
  biometricLabelFor,
  defaultBiometricDeps,
  type BiometricOutcome,
} from './biometrics';
import { defaultPinDeps, verifyPin } from './pin/pinHash';
import {
  attemptsUntilWipe,
  CLEARED_ATTEMPT_STATE,
  deriveGateState,
  loadAttemptState,
  recordFailure,
  saveAttemptState,
  shouldShowWipeWarning,
  type AttemptState,
} from './pin/pinAttempts';
import { PinKeypad } from './pin/PinKeypad';
import { LocalWipeScreen } from './wipe/LocalWipeScreen';
import { createDefaultWipeDeps } from './wipe/wipeMachinery';

/**
 * AppLockGate — the full-screen SEC-03 lock surface (15-UI-SPEC.md §1/§2),
 * mounted by `RootNavigator.tsx` INSTEAD OF the navigation subtree while
 * `useAppLock().isLocked` is true (T-15-06-02: it replaces, never overlays,
 * so nothing behind it is mounted or reachable by a back gesture).
 *
 * T-15-06-01 (Information Disclosure — the load-bearing threat this file
 * exists to close): the lock screen is reachable by anyone holding the
 * tablet before authenticating. It renders ONLY tenant + the signed-in
 * rep's own identity, the biometric CTA, and the PIN keypad. It must NEVER
 * import from `features/checkout`, `features/map`, `features/wallet`, or
 * `features/termine` — `AppLockGate.test.tsx` asserts this structurally by
 * scanning this file's own import statements (`useLeaderboard.test.ts`
 * precedent). Do not add such an import, even transitively re-exported
 * through another app-lock file — this file's OWN imports are the gate.
 *
 * D-10 (biometric failure is not a wrong PIN): a biometric `unavailable`/
 * `failed` outcome NEVER calls `recordFailure` — only a wrong PIN does. See
 * `handleBiometricOutcome` below, which makes that rule a pure, directly
 * testable function rather than inline component logic.
 *
 * 15-11 (SEC-08, D-01/D-02): `lockReason === 'remote-wipe'` renders the
 * wipe-pending surface INSTEAD of the biometric CTA and keypad — no unlock
 * affordance of any kind, matching `AppLockProvider.tsx`'s own `unlock()`
 * refusal for this reason (T-15-11-02). No acknowledge control, no
 * try-again affordance, no override-and-continue button exists here or
 * anywhere else in this file: the lock is a one-way door, and this surface
 * offers no way back. `sec.wipeInProgress`
 * renders once the pending count is known to be zero (the shared purge
 * machinery is running or about to); `sec.wipeBlockedBody` with the REAL
 * `{{n}}` renders while it is not, so the rep can see WHY the device is
 * stuck and reconnect to fix it (D-02: the count is reported verbatim,
 * never suppressed). This branch is checked BEFORE `gateState.kind ===
 * 'wipe'` below — remote-wipe is the more severe, unconditional lock.
 */

const PIN_LENGTH = 6; // mirrors pin/pinHash.ts's PIN_LENGTH (not exported there — pinHash.ts is 15-05's file, out of this plan's scope)

export interface PinSubmitResult {
  nextAttemptState: AttemptState;
  outcome: 'unlocked' | 'incorrect';
}

/**
 * Pure/DI'd orchestration for a completed PIN entry. A correct PIN clears
 * the attempt counter to `CLEARED_ATTEMPT_STATE`; a wrong PIN advances it
 * via `recordFailure`, clock-injected via `nowEpochMs` (never reads the
 * system clock itself — mirrors `pinAttempts.ts`'s own discipline).
 */
export async function handlePinSubmit(
  pin: string,
  attemptState: AttemptState,
  verify: (pin: string) => Promise<boolean>,
  nowEpochMs: number,
): Promise<PinSubmitResult> {
  const valid = await verify(pin);
  if (valid) {
    return { nextAttemptState: CLEARED_ATTEMPT_STATE, outcome: 'unlocked' };
  }
  return { nextAttemptState: recordFailure(attemptState, nowEpochMs), outcome: 'incorrect' };
}

export interface BiometricSubmitResult {
  nextAttemptState: AttemptState;
  outcome: 'unlocked' | 'fallback';
}

/**
 * Pure: a biometric `success` clears the counter and unlocks, exactly like a
 * correct PIN. Every other outcome (`unavailable`/`failed`) is a sensor
 * problem, NOT a wrong PIN (D-10) — `attemptState` passes through UNCHANGED,
 * and the caller routes to the keypad fallback with `sec.biometricFallbackHint`.
 */
export function handleBiometricOutcome(
  outcome: BiometricOutcome,
  attemptState: AttemptState,
): BiometricSubmitResult {
  if (outcome.kind === 'success') {
    return { nextAttemptState: CLEARED_ATTEMPT_STATE, outcome: 'unlocked' };
  }
  return { nextAttemptState: attemptState, outcome: 'fallback' };
}

/** Pure: the `{{n}}` count for `sec.pinWipeWarning`, or `null` outside the attempt-8/9 window. */
export function deriveWipeWarningCount(attemptState: AttemptState): number | null {
  return shouldShowWipeWarning(attemptState) ? attemptsUntilWipe(attemptState) : null;
}

/**
 * Pure: the copy KEY for the remote-wipe-pending surface (D-02) — never the
 * interpolated string itself, so this stays testable without `t()`.
 * `null`/`0` (queue not yet known, or genuinely drained) renders the
 * progress copy; a positive count renders the honest blocked copy naming it.
 */
export function deriveRemoteWipeSurfaceCopy(pendingCount: number | null): 'sec.wipeInProgress' | 'sec.wipeBlockedBody' {
  return pendingCount === null || pendingCount === 0 ? 'sec.wipeInProgress' : 'sec.wipeBlockedBody';
}

/**
 * Thin shell: reads the REAL PowerSync pending-upload queue depth
 * (`wipeMachinery.ts`'s own `getUploadQueueStats()`, never a parallel
 * counter — D-02) while `active`, polling every 5s so the rep sees the count
 * shrink as the queue drains. Starts at `null` (unknown) rather than a
 * guessed `0`; `deriveRemoteWipeSurfaceCopy` treats `null` the same as `0`
 * (render the progress copy, not a fabricated blocked count).
 */
function useRemoteWipePendingCount(active: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!active) {
      setCount(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const stats = await createDefaultWipeDeps().getUploadQueueStats();
        if (!cancelled) setCount(stats.count);
      } catch {
        // Keep the last-known count rather than flashing to a guessed value.
      }
    };
    void poll();
    const interval = setInterval(() => void poll(), 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [active]);

  return count;
}

export interface AppLockGateProps {
  /** The signed-in rep's own id — RootNavigator already holds the resolved
   * session when this gate is rendered, so it is threaded through as a prop
   * rather than re-resolved here (avoids a second auth-session read). */
  userId: string;
}

export function AppLockGate({ userId }: AppLockGateProps) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const styles = makeStyles(colors);
  const { unlock, lockReason } = useAppLock();

  const identity = useSessionIdentity();
  const tenant = useTenantIdentity({ userId });

  const isRemoteWipeLocked = lockReason === 'remote-wipe';
  const remoteWipePendingCount = useRemoteWipePendingCount(isRemoteWipeLocked);

  const [attemptState, setAttemptState] = useState<AttemptState>(CLEARED_ATTEMPT_STATE);
  const [pinValue, setPinValue] = useState('');
  const [pinError, setPinError] = useState(false);
  const [biometricCapable, setBiometricCapable] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState('');
  const [biometricFallbackShown, setBiometricFallbackShown] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const loadedRef = useRef(false);

  // Load the persisted D-12 attempt counter once on mount.
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void loadAttemptState(defaultPinDeps.store).then(setAttemptState);
  }, []);

  // Biometric capability probe (hardware + enrollment only — never prompts
  // on mount). The CTA renders only when the device is actually capable
  // (Phase 13's "reads as coming soon" defect — never a disabled control).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const hasHardware = await defaultBiometricDeps.hasHardwareAsync();
      const isEnrolled = hasHardware && (await defaultBiometricDeps.isEnrolledAsync());
      if (cancelled) return;
      setBiometricCapable(hasHardware && isEnrolled);
      if (hasHardware && isEnrolled) {
        const types = await defaultBiometricDeps.supportedTypesAsync();
        if (cancelled) return;
        setBiometricLabel(biometricLabelFor(types, Platform.OS === 'ios' ? 'ios' : 'android'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const gateState = deriveGateState(attemptState, now);

  // Live backoff countdown — ticks once per second only while a backoff
  // window is actually active, so the timer never runs in the 'ready' state.
  useEffect(() => {
    if (gateState.kind !== 'backoff') return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [gateState.kind]);

  const persistAndApply = (next: AttemptState) => {
    setAttemptState(next);
    void saveAttemptState(next, defaultPinDeps.store);
  };

  const handlePinComplete = async (pin: string) => {
    const result = await handlePinSubmit(pin, attemptState, (candidate) => verifyPin(candidate, defaultPinDeps), Date.now());
    persistAndApply(result.nextAttemptState);
    setPinValue('');
    setBiometricFallbackShown(false);
    if (result.outcome === 'unlocked') {
      setPinError(false);
      unlock();
    } else {
      setPinError(true);
    }
  };

  const handleBiometricPress = async () => {
    const outcome = await attemptBiometricUnlock(defaultBiometricDeps);
    const result = handleBiometricOutcome(outcome, attemptState);
    if (result.outcome === 'unlocked') {
      persistAndApply(result.nextAttemptState);
      setPinError(false);
      setBiometricFallbackShown(false);
      unlock();
    } else {
      // D-10: never persists/advances the attempt counter here.
      setBiometricFallbackShown(true);
    }
  };

  const wipeWarningCount = deriveWipeWarningCount(attemptState);
  const keypadDisabled = gateState.kind === 'backoff' || gateState.kind === 'wipe';

  return (
    // A plain flex:1 View clipped its own content on a small iPhone: tenant
    // badge + rep row + heading + biometric CTA + a twelve-key PIN pad do not
    // fit a 4.7"/SE viewport, and the bottom keys were simply unreachable — on
    // the ONE screen where being unable to reach a control locks the rep out of
    // the app entirely. The ScrollView keeps the centred layout while there is
    // room (flexGrow + justifyContent) and only scrolls once there is not.
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.contentContainer,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg },
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.identityBlock}>
        <TenantBadge ready={tenant.ready} tenantName={tenant.tenantName} />
        <View style={styles.repRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{identity.initials}</Text>
          </View>
          <Text style={styles.repName}>{identity.fullName ?? identity.email ?? ''}</Text>
        </View>
      </View>

      <Text style={styles.heading}>{t('sec.appLockedHeading')}</Text>

      {isRemoteWipeLocked ? (
        // 15-11 (D-01/D-02): no unlock affordance of any kind — see this
        // file's own header comment. Checked BEFORE gateState.kind === 'wipe'
        // below: remote-wipe is the more severe, unconditional lock.
        <View style={styles.remoteWipeBlock} accessibilityLiveRegion="polite">
          <MaterialCommunityIcons name="cellphone-lock" size={28} color={colors.textSecondary} />
          <Text style={styles.remoteWipeText}>
            {deriveRemoteWipeSurfaceCopy(remoteWipePendingCount) === 'sec.wipeInProgress'
              ? t('sec.wipeInProgress')
              : t('sec.wipeBlockedBody').replace('{{n}}', String(remoteWipePendingCount))}
          </Text>
        </View>
      ) : gateState.kind === 'wipe' ? (
        // D-04/D-12: the SAME wipe machinery/screen as the rep-triggered
        // local wipe — never a second implementation. `entry="pin-lockout"`
        // + `skipConfirm` (there is nothing left to confirm, the rep is
        // already locked out) but the blocked/blocked-unverified-path states
        // are NOT skipped: D-12 inherits D-01's drain-then-purge rule without
        // exception. No back/close callback is supplied here — this gate is
        // mounted OUTSIDE `NavigationContainer` (see LocalWipeScreen.tsx's
        // own header comment) and `gateState.kind === 'wipe'` is itself
        // terminal (`pinAttempts.ts`), so there is nowhere to return to.
        // `embeddedInPaddedContainer`: this gate renders the wipe screen
        // INSIDE its own ScrollView, whose contentContainerStyle already
        // carries `insets.top`/`insets.bottom` — the screen adding them again
        // shifted it down by a second status bar. The navigator-level mount
        // (ProfilStack's GeraetZuruecksetzenRoute) has no such container and
        // deliberately does NOT pass this.
        <LocalWipeScreen entry="pin-lockout" skipConfirm embeddedInPaddedContainer />
      ) : (
        <>
          {wipeWarningCount !== null ? (
            <View style={styles.wipeWarningBanner} accessibilityLiveRegion="polite">
              <MaterialCommunityIcons name="alert-outline" size={20} color={colors.destructive} />
              <Text style={styles.wipeWarningText}>
                {t('sec.pinWipeWarning').replace('{{n}}', String(wipeWarningCount))}
              </Text>
            </View>
          ) : null}

          {biometricCapable ? (
            <Pressable
              style={styles.biometricCta}
              accessibilityRole="button"
              accessibilityLabel={t('sec.biometricUnlockCta').replace('{{biometricLabel}}', biometricLabel)}
              onPress={() => void handleBiometricPress()}
            >
              <MaterialCommunityIcons name="fingerprint" size={22} color={colors.onAccent} />
              <Text style={styles.biometricCtaText}>
                {t('sec.biometricUnlockCta').replace('{{biometricLabel}}', biometricLabel)}
              </Text>
            </Pressable>
          ) : null}

          {biometricFallbackShown ? (
            <Text style={styles.fallbackHint}>{t('sec.biometricFallbackHint')}</Text>
          ) : null}

          {gateState.kind === 'backoff' ? (
            <Text style={styles.backoffText}>
              {t('sec.pinBackoffActive').replace('{{seconds}}', String(gateState.secondsRemaining))}
            </Text>
          ) : pinError ? (
            <Text style={styles.pinErrorText}>{t('sec.pinIncorrect')}</Text>
          ) : null}

          <PinKeypad
            value={pinValue}
            pinLength={PIN_LENGTH}
            disabled={keypadDisabled}
            onChange={setPinValue}
            onComplete={(pin) => void handlePinComplete(pin)}
          />
        </>
      )}
    </ScrollView>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    contentContainer: {
      flexGrow: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: spacing.xl,
    },
    identityBlock: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xl },
    repRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      backgroundColor: colors.secondary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { ...typography.label, fontWeight: '600', color: colors.textPrimary },
    repName: { ...typography.body, color: colors.textPrimary },
    heading: { ...typography.display, color: colors.textPrimary, marginBottom: spacing.xl, textAlign: 'center' },
    wipeWarningBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: `${colors.destructive}1A`,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.lg,
      width: '100%',
    },
    wipeWarningText: { ...typography.body, fontWeight: '600', color: colors.destructive, flex: 1, flexWrap: 'wrap' },
    remoteWipeBlock: { alignItems: 'center', gap: spacing.md, width: '100%' },
    remoteWipeText: { ...typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },
    biometricCta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      backgroundColor: colors.accent,
      borderRadius: radius.button,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.lg,
      width: '100%',
    },
    biometricCtaText: { ...typography.body, fontWeight: '600', color: colors.onAccent },
    fallbackHint: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.md, textAlign: 'center' },
    backoffText: { ...typography.body, color: colors.destructive, marginBottom: spacing.md, textAlign: 'center' },
    pinErrorText: { ...typography.label, color: colors.destructive, marginBottom: spacing.md, textAlign: 'center' },
  });
}
