import { useMemo, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  Text,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';
import { radius, spacing } from '../design/tokens';
import { useThemeColors } from '../features/settings/theme/useThemeColors';

/**
 * Shared primary/secondary/destructive button — the SSOT for every CTA in the
 * mobile app (design SSOT: 56–58dp tall, 15px radius, Space Grotesk 600 label,
 * amber Porch-Light primary with a soft glow shadow). Screens compose this;
 * they never re-author button styling.
 *
 *  - `primary`     Porch-Light Amber fill (the ONE primary CTA per screen).
 *  - `secondary`   White fill, hairline Ink-Navy border.
 *  - `ink`         Ink-Navy fill (secondary emphasis, e.g. "Jetzt synchronisieren").
 *  - `destructive` Brick-Red fill.
 *  - `outlineOnDark`  Translucent white on a dark/camera surface.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ink' | 'destructive' | 'outlineOnDark';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  title: string;
  variant?: ButtonVariant;
  /** Optional leading icon node (e.g. a MaterialCommunityIcons element). */
  leadingIcon?: ReactNode;
  /** Optional trailing icon node (e.g. a "→" arrow). */
  trailingIcon?: ReactNode;
  loading?: boolean;
  /** Full-width by default; pass false for an inline/hugging button. */
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  title,
  variant = 'primary',
  leadingIcon,
  trailingIcon,
  loading = false,
  fullWidth = true,
  disabled,
  style,
  ...pressable
}: ButtonProps) {
  const colors = useThemeColors();
  const { styles, variantStyles, labelStyles } = useMemo(() => makeStyles(colors), [colors]);
  const isDisabled = disabled || loading;
  const spinnerColor =
    variant === 'secondary' ? colors.textPrimary : colors.onAccent;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        fullWidth && styles.fullWidth,
        variantStyles[variant],
        pressed && !isDisabled ? styles.pressed : null,
        isDisabled ? styles.disabled : null,
        style,
      ]}
      {...pressable}
    >
      {loading ? (
        <ActivityIndicator color={spinnerColor} />
      ) : (
        <View style={styles.contentRow}>
          {leadingIcon ? <View style={styles.icon}>{leadingIcon}</View> : null}
          <Text style={[styles.label, labelStyles[variant]]}>{title}</Text>
          {trailingIcon ? <View style={styles.icon}>{trailingIcon}</View> : null}
        </View>
      )}
    </Pressable>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  const styles = StyleSheet.create({
    base: {
      minHeight: 56,
      borderRadius: radius.button,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
    },
    fullWidth: { alignSelf: 'stretch' },
    contentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    icon: { marginHorizontal: spacing.xs + 1 },
    label: { fontFamily: undefined, fontSize: 18, fontWeight: '600' },
    pressed: { opacity: 0.85 },
    disabled: { opacity: 0.5 },
  });

  const variantStyles = StyleSheet.create({
    primary: {
      backgroundColor: colors.accent,
      // No shadow. What stood here was `shadowColor: colors.accent` at 0.5
      // opacity over a 14dp radius — a shadow tinted with the fill colour is a
      // GLOW, not a shadow, and it haloed every primary CTA. The floating map
      // buttons lost the same effect for the same reason; the accent fill is
      // already the strongest thing on the screen and needs no help.
    },
    secondary: {
      backgroundColor: colors.surface,
      borderWidth: 1.5,
      borderColor: colors.borderStrong,
    },
    ink: { backgroundColor: colors.ink },
    destructive: { backgroundColor: colors.destructive },
    outlineOnDark: {
      backgroundColor: 'rgba(255,255,255,0.08)',
      borderWidth: 1.5,
      borderColor: 'rgba(255,255,255,0.4)',
    },
  });

  const labelStyles = StyleSheet.create({
    primary: { color: colors.onAccent },
    secondary: { color: colors.textPrimary },
    ink: { color: colors.onAccent },
    destructive: { color: colors.onAccent },
    outlineOnDark: { color: colors.onAccent },
  });

  return { styles, variantStyles, labelStyles };
}
