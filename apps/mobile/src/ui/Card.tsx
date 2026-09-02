import { useMemo, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, spacing } from '../design/tokens';
import { useThemeColors } from '../features/settings/theme/useThemeColors';

/**
 * Shared surface card — the SSOT for the white, hairline-bordered, rounded
 * container used across the mobile screens (design SSOT: #fff, 1px Ink-Navy@10%
 * border, ~16–18px radius). Screens compose this instead of re-declaring the
 * same surface styling.
 */
export interface CardProps {
  children: ReactNode;
  /** Remove the default inner padding (e.g. for list rows that pad themselves). */
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Card({ children, padded = true, style }: CardProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <View style={[styles.card, padded && styles.padded, style]}>{children}</View>;
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    padded: { padding: spacing.md + 2 },
  });
}
