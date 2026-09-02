import { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { radius, spacing, typography } from '../design/tokens';
import { useThemeColors } from '../features/settings/theme/useThemeColors';
import { t } from '../i18n';

/**
 * Shared labeled `TextInput` primitive (plan 12-13) — extracted from
 * `LoginScreen`'s local `styles.input` block (the only styled `TextInput` in
 * the app before this plan): same `minHeight`, `borderWidth`, `borderColor`,
 * `borderRadius`, `backgroundColor` and padding tokens, theme-aware via
 * `useThemeColors()`. `LoginScreen` itself is NOT restyled in this plan — the
 * primitive exists for reuse from here on (starting with `ProfileEditScreen`).
 *
 * Label and error render as real `Text` with an unconstrained line count, so
 * both wrap at any font scale (accessibility — never truncate form guidance
 * or error copy; grepped for repo-wide, see this plan's acceptance criteria).
 *
 * Plan 14-05 adds two optional props, both default to today's behaviour so
 * every existing caller keeps compiling unchanged:
 *  - `secureTextEntry` — masks the value and renders a reveal toggle mirroring
 *    `LoginScreen.tsx`'s local `passwordRow`/`eyeButton`/`showPassword`
 *    pattern (same `MaterialCommunityIcons` glyphs, same
 *    `auth.showPasswordLabel`/`auth.hidePasswordLabel` accessibility labels,
 *    `spacing.touchTarget` floor on the toggle) — so no later screen
 *    (`ResetPasswordScreen`, `ChangePasswordScreen`) duplicates that reveal
 *    logic a third time.
 *  - `helperText` — an always-visible hint rendered under the field with
 *    unbounded lines (never `numberOfLines={1}`), the D-10 password-
 *    requirement hint surface. Coexists with `errorText`.
 */
export interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  errorText?: string | null;
  helperText?: string;
  keyboardType?: KeyboardTypeOptions;
  accessibilityLabel?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  secureTextEntry?: boolean;
  /** Plan 14-06: forwarded to the underlying `TextInput` so a caller can
   * derive focus-dependent copy (e.g. the D-10 password-requirement
   * countdown hint) without duplicating the field's own input. */
  onFocus?: () => void;
  onBlur?: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Pure: resolves the input border color from error state — exported so it is
 * unit-testable without mounting the component (no react-native-testing-library
 * in this repo; mirrors `SegmentedControl.tsx`'s `getSegmentedOptionStyle`
 * pure-logic-extraction precedent).
 */
export function getTextFieldBorderColor(
  hasError: boolean,
  colors: Pick<ReturnType<typeof useThemeColors>, 'borderStrong' | 'destructive'>,
): string {
  return hasError ? colors.destructive : colors.borderStrong;
}

/**
 * Pure: resolves the reveal-toggle's accessibility label from the current
 * reveal state — the same `auth.showPasswordLabel`/`auth.hidePasswordLabel`
 * copy `LoginScreen.tsx` already uses, extracted so the flip behaviour is
 * unit-testable without mounting the component.
 */
export function getRevealToggleLabel(revealed: boolean): string {
  return t(revealed ? 'auth.hidePasswordLabel' : 'auth.showPasswordLabel');
}

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  errorText,
  helperText,
  keyboardType,
  accessibilityLabel,
  autoCapitalize,
  secureTextEntry,
  onFocus,
  onBlur,
  style,
}: TextFieldProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [revealed, setRevealed] = useState(false);
  const masked = Boolean(secureTextEntry) && !revealed;

  return (
    <View style={[styles.container, style]}>
      <Text style={styles.label}>{label}</Text>
      {secureTextEntry ? (
        <View style={[styles.input, styles.secureRow, errorText ? styles.inputError : null]}>
          <TextInput
            style={styles.secureInput}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            keyboardType={keyboardType}
            autoCapitalize={autoCapitalize}
            accessibilityLabel={accessibilityLabel ?? label}
            secureTextEntry={masked}
            onFocus={onFocus}
            onBlur={onBlur}
          />
          <Pressable
            onPress={() => setRevealed((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={getRevealToggleLabel(revealed)}
            style={styles.revealButton}
            hitSlop={8}
          >
            <MaterialCommunityIcons
              name={revealed ? 'eye-off-outline' : 'eye-outline'}
              size={22}
              color={colors.textSecondary}
            />
          </Pressable>
        </View>
      ) : (
        <TextInput
          style={[styles.input, errorText ? styles.inputError : null]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          accessibilityLabel={accessibilityLabel ?? label}
          onFocus={onFocus}
          onBlur={onBlur}
        />
      )}
      {helperText ? <Text style={styles.helperText}>{helperText}</Text> : null}
      {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { marginBottom: spacing.md + 2 },
    label: {
      ...typography.label,
      fontWeight: '600',
      color: colors.textPrimary,
      marginBottom: spacing.sm,
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
    },
    inputError: { borderColor: colors.destructive },
    secureRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 0,
      paddingLeft: spacing.md,
      paddingRight: spacing.xs,
    },
    secureInput: { flex: 1, ...typography.body, color: colors.textPrimary },
    revealButton: {
      width: spacing.touchTarget,
      height: spacing.touchTarget,
      alignItems: 'center',
      justifyContent: 'center',
    },
    helperText: {
      ...typography.label,
      color: colors.textSecondary,
      marginTop: spacing.xs,
    },
    errorText: { ...typography.label, color: colors.destructive, marginTop: spacing.xs },
  });
}
