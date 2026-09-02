import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { radius, spacing, typography } from '../../design/tokens';
import { Button } from '../../ui/Button';
import { TextField } from '../../ui/TextField';
import { t } from '../../i18n';
import { getSupabase } from '../../lib/auth/supabase';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { classifyAuthError } from './LoginScreen';
import { derivePasswordHint, PASSWORD_MIN_LENGTH } from './ResetPasswordScreen';

/**
 * AUTH in-app password change (SEC-02). Reached from Einstellungen's
 * Sicherheit card while already logged in — unlike ResetPasswordScreen (its
 * sibling, SEC-01) there is no deep link, no recovery session and no expiry
 * path: an ordinary authenticated session is already present, so the screen
 * mounts straight into the form.
 *
 * D-15/WR-12 (closes T-14-08-02): GoTrue's `secure_password_change` is now
 * enabled server-side (see
 * .planning/phases/15-app-lock-wipe-data-minimization/15-SECURE-PASSWORD-CHANGE-PROBE.md,
 * VERDICT: NONCE_REQUIRED). This screen calls `reauthenticate()` on mount to
 * send a 6-digit OTP nonce and requires it on `updateUser({ password, nonce })`
 * before a stolen-but-still-valid access token can change the password
 * within the ~15-minute `jwt_expiry` window. Per RESEARCH Pitfall 2, GoTrue
 * exempts sessions younger than 24h from this requirement — the residual for
 * that freshness window is accepted (T-15-14-02, `15-SECURITY.md`), not a
 * gap in this screen.
 */

export type ChangePasswordResult =
  | { kind: 'ok' }
  | { kind: 'reauthRejected' }
  | { kind: 'policyRejected' }
  | { kind: 'networkError' };

/** Narrow structural slice of `supabase.auth` this screen depends on —
 * mirrors `ResetPasswordScreen.tsx`'s `UpdatePasswordAuthClient`, avoiding a
 * second binding to supabase-js's full XOR-union `UserResponse` shape. */
export interface ChangePasswordAuthClient {
  reauthenticate: () => Promise<{ error: { message?: string; status?: number; code?: string } | null }>;
  updateUser: (attributes: {
    password: string;
    nonce?: string;
  }) => Promise<{ error: { message?: string; status?: number; code?: string } | null }>;
}

const REAUTH_ERROR_CODES = new Set([
  'reauthentication_needed',
  'reauthentication_not_valid',
  'reauth_nonce_missing',
]);

/**
 * Pure/DI'd core: `updateUser({ password, nonce })` against the rep's
 * already-live session, called exactly once per invocation. A rejected/wrong
 * reauthentication nonce (`error.code` in `REAUTH_ERROR_CODES`) is
 * distinguished from a server policy rejection (still short of the
 * 12-character floor per Supabase's own denylist/rules) and from a genuine
 * network failure, so the rep never sees the wrong copy for any of the three.
 */
export async function performPasswordChange({
  auth,
  password,
  nonce,
}: {
  auth: ChangePasswordAuthClient;
  password: string;
  nonce: string;
}): Promise<ChangePasswordResult> {
  try {
    const { error } = await auth.updateUser({ password, nonce });
    if (!error) return { kind: 'ok' };
    if (classifyAuthError(error) === 'offline') return { kind: 'networkError' };
    if (error.code && REAUTH_ERROR_CODES.has(error.code)) return { kind: 'reauthRejected' };
    return { kind: 'policyRejected' };
  } catch {
    return { kind: 'networkError' };
  }
}

export function ChangePasswordScreen() {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation();

  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [focused, setFocused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<ChangePasswordResult | null>(null);

  const hint = derivePasswordHint(password, focused);
  const OTP_LENGTH = 6;

  // D-15/WR-12: request the reauthentication nonce as soon as the screen
  // mounts, so the OTP field is never shown before a code has actually been
  // requested (15-UI-SPEC.md §8's delivery note). Failure to send is not
  // fatal here — the rep can still submit once a code arrives; a hard error
  // path is out of scope for this screen (mirrors ForgotPasswordScreen's
  // single-terminal-outcome posture for the request step).
  useEffect(() => {
    void getSupabase().auth.reauthenticate();
  }, []);

  const canSubmit = otp.length === OTP_LENGTH && password.length >= PASSWORD_MIN_LENGTH;

  const handleSubmit = async () => {
    if (submitting || !canSubmit) return;
    setSubmitting(true);
    setOutcome(null);
    try {
      const result = await performPasswordChange({ auth: getSupabase().auth, password, nonce: otp });
      setOutcome(result);
      if (result.kind === 'ok') {
        navigation.goBack();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Pressable
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            onPress={() => navigation.goBack()}
            hitSlop={8}
          >
            <MaterialCommunityIcons name="chevron-left" size={26} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.title}>{t('auth.changePasswordCta')}</Text>
        </View>

        <TextField
          label={t('auth.currentPasswordLabel')}
          value={otp}
          onChangeText={(value) => setOtp(value.replace(/[^0-9]/g, '').slice(0, OTP_LENGTH))}
          keyboardType="number-pad"
          helperText={t('auth.otpSentHint')}
          accessibilityLabel={t('auth.currentPasswordLabel')}
        />
        {outcome?.kind === 'reauthRejected' ? (
          <Text style={styles.rejectedText}>{t('auth.currentPasswordRejected')}</Text>
        ) : null}
        <TextField
          label={t('auth.passwordLabel')}
          value={password}
          onChangeText={setPassword}
          placeholder={t('auth.passwordPlaceholder')}
          secureTextEntry
          helperText={
            hint.key === 'auth.passwordTooShortHint'
              ? // `t()` has no values-interpolation support (mirrors
                // ResetPasswordScreen.tsx's established `{single-brace}` +
                // `.replace()` convention) — the key itself is authored
                // with `{{n}}`, so match that literal token.
                t('auth.passwordTooShortHint').replace('{{n}}', String(hint.count))
              : t('auth.passwordRequirementHint')
          }
          accessibilityLabel={t('auth.passwordLabel')}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {outcome?.kind === 'policyRejected' ? (
          <Text style={styles.rejectedText}>{t('auth.passwordRejectedByServer')}</Text>
        ) : null}
        {outcome?.kind === 'networkError' ? (
          <Text style={styles.rejectedText}>{t('settings.saveErrorGeneric')}</Text>
        ) : null}
        <Button
          title={
            submitting
              ? t('profile.editSaving')
              : outcome?.kind === 'ok'
                ? t('profile.editSaved')
                : t('auth.changePasswordCta')
          }
          onPress={() => void handleSubmit()}
          loading={submitting}
          disabled={!canSubmit}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.background },
    content: { flexGrow: 1, paddingHorizontal: spacing.xl },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginBottom: spacing.lg,
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
    rejectedText: { ...typography.label, color: colors.destructive, marginBottom: spacing.sm },
  });
}
