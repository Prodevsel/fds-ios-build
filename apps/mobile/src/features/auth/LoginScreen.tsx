import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { radius, spacing, typography } from '../../design/tokens';
import { Button } from '../../ui/Button';
import { t } from '../../i18n';
import {
  getDemoBackendHost,
  getSupabase,
  isDemoBackendOverrideEnabled,
  setDemoBackendHost,
} from '../../lib/auth/supabase';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { FdsLogo } from './FdsLogo';

/**
 * AUTH login (design SSOT screen 01 — `FrontDoorSales App.dc.html` / `Login.dc.html`):
 * the sole unauthenticated screen. FDS mark, "FrontDoorSales" wordmark, the
 * "Melde dich an…" subtitle, E-Mail + Passwort fields (with a reveal eye),
 * inline error state, a "Passwort zurücksetzen" link, the amber "Anmelden" CTA
 * and the offline-honesty hint pill. Wires the real
 * `supabase.auth.signInWithPassword`; on success the auth gate (RootNavigator)
 * swaps this screen for the main tabs via `onAuthStateChange`, so there is no
 * manual navigation here.
 */

/**
 * Demo-build account picker. One tap fills both fields, so nobody types an
 * address with an umlaut in it in front of a customer. Rendered behind the same
 * flag as the backend-host field, so a release build never shows it — and the
 * shared password lives here rather than in any shipped config.
 */
const DEMO_PASSWORD = 'DemoZugang2026!';
const DEMO_ACCOUNTS = [
  { key: 'rep', label: 'Vertrieb', email: 'vertrieb@demo.frontdoorsales.de' },
  { key: 'lead', label: 'Teamleitung', email: 'teamleitung@demo.frontdoorsales.de' },
  { key: 'admin', label: 'Operator', email: 'admin@demo.frontdoorsales.de' },
] as const;

/** Login error kinds surfaced to the rep, mapped to i18n copy below. */
export type LoginErrorKind = 'missing' | 'invalid' | 'offline';

const ERROR_COPY: Record<LoginErrorKind, Parameters<typeof t>[0]> = {
  missing: 'auth.errorMissingFields',
  invalid: 'auth.errorInvalid',
  offline: 'auth.errorOffline',
};

/**
 * Classifies a supabase auth failure into the copy shown to the rep. A
 * transport failure ("offline") is distinguished from a credential rejection
 * ("invalid") so the honest offline story (letzte Anmeldung bleibt gültig) is
 * never mislabelled as a wrong password.
 *
 * The transport signal is the ABSENCE of an HTTP response, not an absent
 * `status` field: supabase-js constructs `new AuthRetryableFetchError(msg, 0)`
 * when the fetch itself rejects (`@supabase/auth-js/dist/module/lib/fetch.js`,
 * `handleError`/`_request`), so `status` is `0` — never `undefined`. Gating on
 * `status === undefined` alone (as this function originally did) made
 * `'offline'` unreachable and classified a total loss of connectivity as a
 * wrong password.
 *
 * D-20 (enumeration safety), load-bearing for `ForgotPasswordScreen`'s use of
 * this function: a response that DID arrive is never classified `'offline'`,
 * whatever its status or body. auth-js also raises `AuthRetryableFetchError`
 * for 5xx responses (status 500-530) — those are deliberately left `'invalid'`
 * here, because the known 14-04 hook-failure oracle (500 for a known address,
 * 200 for an unknown one) would otherwise become directly readable from the
 * reset-request screen's copy.
 */
export function classifyAuthError(error: {
  message?: string;
  status?: number;
  name?: string;
}): LoginErrorKind {
  // No HTTP response at all — the only signal an offline classification may
  // rest on (see the D-20 note above).
  const noHttpResponse = error.status === undefined || error.status === 0;
  if (!noHttpResponse) return 'invalid';

  const message = (error.message ?? '').toLowerCase();
  if (
    error.name === 'AuthRetryableFetchError' ||
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('failed to')
  ) {
    return 'offline';
  }
  return 'invalid';
}

export function LoginScreen() {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<LoginErrorKind | null>(null);
  // Demo builds only (EXPO_PUBLIC_DEMO_BACKEND_OVERRIDE=1). Compiled-in
  // EXPO_PUBLIC_* URLs pin the backend to whatever address was known at build
  // time; this lets the operator retype it when the demo happens on a different
  // network. Absent in a release build — the flag is false and nothing renders.
  const demoOverride = isDemoBackendOverrideEnabled();
  const [demoHost, setDemoHost] = useState(() => getDemoBackendHost() ?? '');

  const handleSubmit = async () => {
    if (!email.trim() || !password) {
      setError('missing');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const { error: signInError } = await getSupabase().auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError(classifyAuthError(signInError));
      }
      // On success the RootNavigator's auth listener re-renders to the tabs.
    } catch {
      setError('offline');
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
        <FdsLogo size={60} />
        <Text style={styles.wordmark}>{t('auth.wordmark')}</Text>
        <Text style={styles.subtitle}>{t('auth.subtitle')}</Text>

        {demoOverride ? (
          <>
            <Text style={styles.label}>Demo-Konto</Text>
            <View style={styles.demoAccountRow}>
              {DEMO_ACCOUNTS.map((account) => (
                <Pressable
                  key={account.email}
                  onPress={() => {
                    setEmail(account.email);
                    setPassword(DEMO_PASSWORD);
                    setError(null);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Als ${account.label} anmelden`}
                  testID={`login-demo-${account.key}`}
                  style={[
                    styles.demoAccountChip,
                    email === account.email && styles.demoAccountChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.demoAccountChipText,
                      email === account.email && styles.demoAccountChipTextActive,
                    ]}
                  >
                    {account.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>Backend-Host (Demo)</Text>
            <TextInput
              style={styles.input}
              value={demoHost}
              onChangeText={(next) => {
                setDemoHost(next);
                setDemoBackendHost(next);
              }}
              placeholder="z. B. 100.83.111.128"
              placeholderTextColor={colors.textMuted}
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
              autoCorrect={false}
              testID="login-demo-host"
            />
          </>
        ) : null}

        <Text style={styles.label}>{t('auth.emailLabel')}</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder={t('auth.emailPlaceholder')}
          placeholderTextColor={colors.textMuted}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          textContentType="emailAddress"
          editable={!submitting}
        />

        <Text style={styles.label}>{t('auth.passwordLabel')}</Text>
        <View style={[styles.input, styles.passwordRow, error ? styles.inputError : null]}>
          <TextInput
            style={styles.passwordInput}
            value={password}
            onChangeText={setPassword}
            placeholder={t('auth.passwordPlaceholder')}
            placeholderTextColor={colors.textMuted}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoComplete="password"
            autoCorrect={false}
            textContentType="password"
            editable={!submitting}
          />
          <Pressable
            onPress={() => setShowPassword((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={t(showPassword ? 'auth.hidePasswordLabel' : 'auth.showPasswordLabel')}
            style={styles.eyeButton}
            hitSlop={8}
          >
            <MaterialCommunityIcons
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size={22}
              color={colors.textSecondary}
            />
          </Pressable>
        </View>

        {error ? (
          <View style={styles.errorRow}>
            <MaterialCommunityIcons
              name="alert-circle-outline"
              size={16}
              color={colors.destructive}
              style={styles.errorIcon}
            />
            <Text style={styles.errorText}>{t(ERROR_COPY[error])}</Text>
          </View>
        ) : null}

        <Pressable
          onPress={() => navigation.navigate('ForgotPassword')}
          accessibilityRole="button"
          style={styles.resetButton}
          hitSlop={8}
        >
          <Text style={styles.resetText}>{t('auth.passwordResetCta')}</Text>
        </Pressable>

        <Button
          title={t('auth.submitCta')}
          onPress={() => void handleSubmit()}
          loading={submitting}
        />

        <View style={styles.offlinePill}>
          <MaterialCommunityIcons name="wifi" size={16} color={colors.textSecondary} />
          <Text style={styles.offlineText}>{t('auth.offlineHint')}</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * NOTE (plan 12-13): `input`/`passwordInput` below are this app's only styled
 * `TextInput` today (min-height `spacing.touchTarget + spacing.sm`,
 * `borderColor: colors.borderStrong`, `borderRadius: radius.input`,
 * `backgroundColor: colors.surface`). Plan 12-13 extracts this exact shape
 * into a shared `TextInput` primitive for the profile-edit form — do not
 * duplicate it a second time before that lands.
 */
function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  wordmark: { ...typography.display, color: colors.textPrimary, marginTop: spacing.lg },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs + 2,
    marginBottom: spacing.xl,
  },
  label: {
    ...typography.label,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  demoAccountRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  demoAccountChip: {
    minHeight: spacing.touchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.input,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  demoAccountChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  demoAccountChipText: {
    ...typography.body,
    color: colors.textPrimary,
  },
  demoAccountChipTextActive: {
    color: colors.onAccent,
  },
  input: {
    minHeight: spacing.touchTarget + spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.input,
    paddingHorizontal: spacing.md,
    ...typography.body,
    color: colors.textPrimary,
    marginBottom: spacing.md + 2,
  },
  inputError: { borderColor: colors.destructive },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: spacing.xs,
  },
  passwordInput: { flex: 1, ...typography.body, color: colors.textPrimary },
  eyeButton: {
    width: spacing.touchTarget,
    height: spacing.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  errorIcon: { marginTop: 1 },
  errorText: { ...typography.label, color: colors.destructive, flex: 1 },
  resetButton: { alignSelf: 'flex-start', minHeight: spacing.touchTarget, justifyContent: 'center' },
  resetText: {
    ...typography.body,
    fontWeight: '600',
    color: colors.destructive,
    textDecorationLine: 'underline',
  },
  offlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg + 2,
    padding: spacing.sm + 2,
    backgroundColor: colors.subtleFill,
    borderRadius: radius.md,
  },
  offlineText: { ...typography.label, color: colors.textSecondary },
  });
}
