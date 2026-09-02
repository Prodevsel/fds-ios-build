import { useMemo, useState } from 'react';
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
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../app/navigation';
import { radius, spacing, typography } from '../../design/tokens';
import { Button } from '../../ui/Button';
import { TextField } from '../../ui/TextField';
import { t } from '../../i18n';
import { getSupabase } from '../../lib/auth/supabase';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { classifyAuthError } from './LoginScreen';
import { RECOVERY_REDIRECT_URL } from './useDeepLinkRecovery';

/**
 * AUTH forgot-password entry point (SEC-01, D-20). Reachable from
 * `LoginScreen`'s reset link (replacing the old "ask your team lead" dead end) and
 * from `RootNavigator` after an expired/already-used recovery deep link.
 * Enumeration-safe by construction: `performResetRequest` below has exactly
 * ONE terminal success state, with no branch on account existence.
 */

export type ResetRequestResult = { kind: 'confirmed' } | { kind: 'offline' };

/** Narrow structural slice of `supabase.auth` this screen depends on
 * (injectable for tests — avoids binding to supabase-js's full XOR-union
 * `AuthResponse` return shape, which a fake only needs to approximate). */
export interface ResetRequestAuthClient {
  resetPasswordForEmail: (
    email: string,
    options: { redirectTo: string },
  ) => Promise<{ error: { message?: string; status?: number } | null }>;
}

/**
 * Pure/DI'd core (mirrors `useMarkFirstSync`/`useDeepLinkRecovery`'s
 * DI convention — testable without mounting a component). Calls
 * `resetPasswordForEmail` with NO pre-check query of any kind (14-RESEARCH
 * Pitfall 2) and NO branch on whether the response looks like a "user not
 * found" shape — a genuine network/offline failure is the only thing that
 * produces a different (`'offline'`) outcome (D-20).
 */
export async function performResetRequest({
  auth,
  email,
  redirectTo,
}: {
  auth: ResetRequestAuthClient;
  email: string;
  redirectTo: string;
}): Promise<ResetRequestResult> {
  try {
    const { error } = await auth.resetPasswordForEmail(email, { redirectTo });
    if (error && classifyAuthError(error) === 'offline') {
      return { kind: 'offline' };
    }
    return { kind: 'confirmed' };
  } catch {
    return { kind: 'offline' };
  }
}

export function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'ForgotPassword'>>();

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ResetRequestResult | null>(null);

  const handleSubmit = async () => {
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    try {
      const outcome = await performResetRequest({
        auth: getSupabase().auth,
        email: email.trim(),
        redirectTo: RECOVERY_REDIRECT_URL,
      });
      setResult(outcome);
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
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          style={styles.backButton}
          hitSlop={8}
        >
          <Text style={styles.backText}>{t('common.back')}</Text>
        </Pressable>

        <Text style={styles.title}>{t('auth.wordmark')}</Text>

        {route.params?.expired ? (
          <View style={styles.expiredBanner}>
            <Text style={styles.expiredText}>{t('auth.resetLinkExpired')}</Text>
          </View>
        ) : null}

        {result?.kind === 'confirmed' ? (
          <View style={styles.confirmationBox}>
            <Text style={styles.confirmationText}>{t('auth.resetRequestConfirmation')}</Text>
          </View>
        ) : (
          <>
            <TextField
              label={t('auth.emailLabel')}
              value={email}
              onChangeText={setEmail}
              placeholder={t('auth.emailPlaceholder')}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            {result?.kind === 'offline' ? (
              // 14-05's key decision: `auth.resetRequestOfflineError` was NOT
              // added as a distinct key — `auth.errorOffline`'s copy is
              // identical, reused per the UI-SPEC's explicit "or reuse" option.
              <Text style={styles.offlineError}>{t('auth.errorOffline')}</Text>
            ) : null}
            <Button
              title={t('auth.resetRequestCta')}
              onPress={() => void handleSubmit()}
              loading={submitting}
              disabled={!email.trim()}
            />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.background },
    content: { flexGrow: 1, paddingHorizontal: spacing.xl },
    backButton: { minHeight: spacing.touchTarget, justifyContent: 'center', alignSelf: 'flex-start' },
    backText: { ...typography.body, color: colors.textSecondary },
    title: { ...typography.display, color: colors.textPrimary, marginBottom: spacing.lg },
    expiredBanner: {
      backgroundColor: colors.subtleFill,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.lg,
    },
    expiredText: { ...typography.body, color: colors.textSecondary },
    confirmationBox: {
      backgroundColor: colors.subtleFill,
      borderRadius: radius.md,
      padding: spacing.lg,
    },
    confirmationText: { ...typography.body, color: colors.textPrimary },
    offlineError: {
      ...typography.label,
      color: colors.destructive,
      marginBottom: spacing.md,
    },
  });
}
