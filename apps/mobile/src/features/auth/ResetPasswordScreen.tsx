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
import { radius, spacing, typography } from '../../design/tokens';
import { Button } from '../../ui/Button';
import { TextField } from '../../ui/TextField';
import { t } from '../../i18n';
import { getSupabase } from '../../lib/auth/supabase';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { classifyAuthError } from './LoginScreen';

/**
 * AUTH reset-completion screen (SEC-01, D-08/D-10). Reached via
 * `RootNavigator` after `useDeepLinkRecovery`'s `onRecovery` fires (a valid
 * recovery session already exists by the time this mounts). Guards against
 * being reached WITHOUT a valid session too (e.g. re-navigated to after the
 * recovery session's own natural expiry) via `deriveResetPasswordViewState`.
 */

export const PASSWORD_MIN_LENGTH = 12;

export type PasswordHint =
  | { key: 'auth.passwordRequirementHint' }
  | { key: 'auth.passwordTooShortHint'; count: number };

/**
 * Pure: which of the two D-10 hint keys to render, plus the interpolation
 * count. Visible at zero characters (before any typing/submit) and reverts
 * to the requirement hint on blur or once the 12-character floor is met —
 * the countdown only ever shows while focused AND under the floor.
 */
export function derivePasswordHint(value: string, focused: boolean): PasswordHint {
  if (focused && value.length < PASSWORD_MIN_LENGTH) {
    return { key: 'auth.passwordTooShortHint', count: PASSWORD_MIN_LENGTH - value.length };
  }
  return { key: 'auth.passwordRequirementHint' };
}

export type ResetViewState = 'loading' | 'expired' | 'form';

/**
 * Pure: resolves which of the three screen states to render from the
 * session-presence check below — never a bare TextInput with no explanation
 * when the recovery session has gone stale.
 */
export function deriveResetPasswordViewState(sessionChecked: boolean, hasSession: boolean): ResetViewState {
  if (!sessionChecked) return 'loading';
  return hasSession ? 'form' : 'expired';
}

export type UpdatePasswordResult = { kind: 'success' } | { kind: 'rejected' } | { kind: 'offline' };

/** Narrow structural slice of `supabase.auth` this screen depends on
 * (injectable for tests — avoids binding to supabase-js's full XOR-union
 * `UserResponse` return shape, which a fake only needs to approximate). */
export interface UpdatePasswordAuthClient {
  updateUser: (attributes: {
    password: string;
  }) => Promise<{ error: { message?: string; status?: number } | null }>;
}

/**
 * Pure/DI'd core: `updateUser({ password })` against the already-established
 * recovery session. A server rejection (still-invalid password per
 * Supabase's own denylist/rules) is distinguished from a genuine offline
 * failure so the rep never sees a bare "invalid password."
 */
export async function performPasswordUpdate({
  auth,
  password,
}: {
  auth: UpdatePasswordAuthClient;
  password: string;
}): Promise<UpdatePasswordResult> {
  try {
    const { error } = await auth.updateUser({ password });
    if (!error) return { kind: 'success' };
    return classifyAuthError(error) === 'offline' ? { kind: 'offline' } : { kind: 'rejected' };
  } catch {
    return { kind: 'offline' };
  }
}

export interface ResetPasswordScreenProps {
  /** Invoked after a successful password update — `RootNavigator` clears its
   * recovery-in-progress flag so the app's normal authenticated tree shows. */
  onSuccess?: () => void;
}

export function ResetPasswordScreen({ onSuccess }: ResetPasswordScreenProps) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation();

  const [sessionChecked, setSessionChecked] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getSupabase()
      .auth.getSession()
      .then(({ data }) => {
        if (cancelled) return;
        setHasSession(Boolean(data.session));
        setSessionChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [password, setPassword] = useState('');
  const [focused, setFocused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<UpdatePasswordResult | null>(null);

  const hint = derivePasswordHint(password, focused);
  const viewState = deriveResetPasswordViewState(sessionChecked, hasSession);

  const handleSubmit = async () => {
    if (submitting || password.length < PASSWORD_MIN_LENGTH) return;
    setSubmitting(true);
    try {
      const result = await performPasswordUpdate({ auth: getSupabase().auth, password });
      setOutcome(result);
      if (result.kind === 'success') {
        onSuccess?.();
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
          { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{t('auth.wordmark')}</Text>

        {viewState === 'expired' ? (
          <View style={styles.expiredBox}>
            <Text style={styles.expiredText}>{t('auth.resetLinkExpired')}</Text>
            <Pressable
              onPress={() => navigation.navigate('ForgotPassword')}
              accessibilityRole="button"
              style={styles.expiredCtaButton}
              hitSlop={8}
            >
              <Text style={styles.expiredCtaText}>{t('auth.resetRequestCta')}</Text>
            </Pressable>
          </View>
        ) : viewState === 'form' ? (
          <>
            <TextField
              label={t('auth.passwordLabel')}
              value={password}
              onChangeText={setPassword}
              placeholder={t('auth.passwordPlaceholder')}
              secureTextEntry
              helperText={
                hint.key === 'auth.passwordTooShortHint'
                  ? // `t()` has no values-interpolation support (mirrors this
                    // codebase's established `{single-brace}` + `.replace()`
                    // convention, e.g. AbschlussDetailScreen.tsx/MapScreen.tsx)
                    // — the key itself is authored with `{{n}}`, so match that
                    // literal token rather than adding a new `t()` capability.
                    t('auth.passwordTooShortHint').replace('{{n}}', String(hint.count))
                  : t('auth.passwordRequirementHint')
              }
              accessibilityLabel={t('auth.passwordLabel')}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
            />
            {outcome?.kind === 'rejected' ? (
              <Text style={styles.rejectedText}>{t('auth.passwordRejectedByServer')}</Text>
            ) : null}
            {outcome?.kind === 'offline' ? (
              <Text style={styles.rejectedText}>{t('auth.errorOffline')}</Text>
            ) : null}
            <Button
              title={t('auth.resetSubmitCta')}
              onPress={() => void handleSubmit()}
              loading={submitting}
              disabled={password.length < PASSWORD_MIN_LENGTH}
            />
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.background },
    content: { flexGrow: 1, paddingHorizontal: spacing.xl },
    title: { ...typography.display, color: colors.textPrimary, marginBottom: spacing.lg },
    expiredBox: {
      backgroundColor: colors.subtleFill,
      borderRadius: radius.md,
      padding: spacing.lg,
    },
    expiredText: { ...typography.body, color: colors.textPrimary, marginBottom: spacing.md },
    expiredCtaButton: { minHeight: spacing.touchTarget, justifyContent: 'center', alignSelf: 'flex-start' },
    expiredCtaText: { ...typography.body, fontWeight: '600', color: colors.destructive, textDecorationLine: 'underline' },
    rejectedText: { ...typography.label, color: colors.destructive, marginBottom: spacing.sm },
  });
}
