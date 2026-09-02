import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { radius, spacing, typography } from '../../design/tokens';
import { t } from '../../i18n';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { useAppLock } from './AppLockProvider';
import { biometricLabelFor, defaultBiometricDeps } from './biometrics';
import { createPinCredential, defaultPinDeps } from './pin/pinHash';
import { PinKeypad } from './pin/PinKeypad';

/**
 * AppLockSetupScreen — reached from the Sicherheit card's `sec.appLockEntryLabel`
 * row (SEC-03, 15-UI-SPEC.md §"Screen Inventory"). Reuses
 * `ChangePasswordScreen.tsx`'s header/back-chevron/scroll shell structurally.
 *
 * Heading is `sec.appLockSetupHeading` ("App-Sperre einrichten") — NEVER
 * "gesperrt" (15-UI-SPEC.md §9): nothing is locked yet while setting up.
 *
 * Two steps in one screen, both rendered with `PinKeypad` (never a
 * `TextField`, so the setup targets match the unlock targets exactly): enter
 * a 6-digit PIN, then confirm it. A mismatch clears BOTH entries, shows an
 * inline error, and writes nothing — `createPinCredential` is only ever
 * called once both entries agree (`handleSetupPinComplete` below is the pure
 * core this discipline lives in, directly unit-testable without a renderer).
 */

const PIN_LENGTH = 6; // mirrors pin/pinHash.ts's PIN_LENGTH (not exported there — pinHash.ts is 15-05's file, out of this plan's scope)

export type SetupPinStep = 'enter' | 'confirm';

export type SetupStepResult =
  | { kind: 'advance-to-confirm'; firstPin: string }
  | { kind: 'mismatch' }
  | { kind: 'ready-to-create'; pin: string };

/**
 * Pure orchestration for a completed keypad entry during setup. The "enter"
 * step never writes anything — it only advances to "confirm". The "confirm"
 * step either matches (ready to persist) or mismatches (clear both entries,
 * no write at all — never a partial/guessed credential).
 */
export function handleSetupPinComplete(
  step: SetupPinStep,
  pin: string,
  firstPin: string | null,
): SetupStepResult {
  if (step === 'enter') {
    return { kind: 'advance-to-confirm', firstPin: pin };
  }
  if (pin === firstPin) {
    return { kind: 'ready-to-create', pin };
  }
  return { kind: 'mismatch' };
}

/** Pure: the biometric enrollment toggle renders only when the device is ACTUALLY capable — never a disabled placeholder (Phase 13's "reads as coming soon" defect). */
export function shouldShowBiometricToggle(hasHardware: boolean, isEnrolled: boolean): boolean {
  return hasHardware && isEnrolled;
}

export function AppLockSetupScreen() {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation();
  const { refreshCredentialState } = useAppLock();

  const [step, setStep] = useState<SetupPinStep>('enter');
  const [firstPin, setFirstPin] = useState<string | null>(null);
  const [pinValue, setPinValue] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState('');
  const [biometricEnabled, setBiometricEnabled] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const hasHardware = await defaultBiometricDeps.hasHardwareAsync();
      const isEnrolled = hasHardware && (await defaultBiometricDeps.isEnrolledAsync());
      if (cancelled) return;
      setBiometricAvailable(shouldShowBiometricToggle(hasHardware, isEnrolled));
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

  const handleComplete = async (pin: string) => {
    const result = handleSetupPinComplete(step, pin, firstPin);
    if (result.kind === 'advance-to-confirm') {
      setFirstPin(result.firstPin);
      setPinValue('');
      setStep('confirm');
      return;
    }
    if (result.kind === 'mismatch') {
      setMismatch(true);
      setFirstPin(null);
      setPinValue('');
      setStep('enter');
      return;
    }
    // ready-to-create
    setSaving(true);
    try {
      await createPinCredential(result.pin, defaultPinDeps);
      await refreshCredentialState();
      setDone(true);
      navigation.goBack();
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (next: string) => {
    setPinValue(next);
    if (mismatch) setMismatch(false);
  };

  const heading = t('sec.appLockSetupHeading');
  const stepLabel = step === 'enter' ? t('sec.appLockEntryLabel') : t('sec.appLockSetupHeading');

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.xl },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        {/* KEIN Zurueck-Pfeil, wenn es kein Zurueck gibt. Als
            `AppSperreEinrichten` ist dies die erste und einzige Route ihrer
            Stack-Gruppe (RootNavigator), `goBack()` also ein No-op — ein
            sichtbarer Knopf, der nichts tut, auf dem allerersten Bildschirm
            nach der Anmeldung auf einem frisch installierten Geraet.
            `navigation.canGoBack()` ist die ehrliche Bedingung. */}
        {navigation.canGoBack() ? (
          <Pressable
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            onPress={() => navigation.goBack()}
            hitSlop={8}
          >
            <MaterialCommunityIcons name="chevron-left" size={26} color={colors.textPrimary} />
          </Pressable>
        ) : null}
        <Text style={styles.title}>{heading}</Text>
      </View>

      <Text style={styles.stepLabel}>{stepLabel}</Text>
      {mismatch ? <Text style={styles.errorText}>{t('sec.pinIncorrect')}</Text> : null}

      <PinKeypad
        value={pinValue}
        pinLength={PIN_LENGTH}
        disabled={saving || done}
        onChange={handleChange}
        onComplete={(pin) => void handleComplete(pin)}
      />

      {biometricAvailable ? (
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>{t('sec.biometricUnlockCta').replace('{{biometricLabel}}', biometricLabel)}</Text>
          <Switch value={biometricEnabled} onValueChange={setBiometricEnabled} />
        </View>
      ) : null}
    </ScrollView>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.background },
    content: { flexGrow: 1, paddingHorizontal: spacing.xl, alignItems: 'center' },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginBottom: spacing.lg,
      width: '100%',
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
    stepLabel: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg, textAlign: 'center' },
    errorText: { ...typography.label, color: colors.destructive, marginBottom: spacing.sm, textAlign: 'center' },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      marginTop: spacing.xl,
      width: '100%',
    },
    toggleLabel: { ...typography.body, color: colors.textPrimary, flex: 1, minWidth: 0 },
  });
}
