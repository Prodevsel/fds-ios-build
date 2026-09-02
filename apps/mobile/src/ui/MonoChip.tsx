import { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import { radius, spacing, typography, type ColorPalette } from '../design/tokens';
import { useThemeColors } from '../features/settings/theme/useThemeColors';

/**
 * Signature move (Foundations SSOT): a JetBrains-Mono chip for EVERY technical
 * value — deal references (FDS-2026-0714), IBANs, device ids, codes. The one
 * place mono type appears in the app. Screens use this instead of hand-rolling a
 * mono `Text`, so the chip fill/border/typography stay consistent.
 *
 * `bare` renders just the mono text (no chip fill/border) for inline use inside
 * a row where a boxed chip would be too heavy.
 *
 * `palette` overrides the themed colours. Needed by surfaces that deliberately
 * pin one palette regardless of the app theme — `BeraterAusweisScreen`'s white
 * ID card is the case that forced this: the chip resolved `textPrimary` from the
 * DARK palette (near-white) and rendered white-on-white on a card fixed to
 * `lightColors`. Any pinned surface must pass its own palette here.
 */
export interface MonoChipProps {
  children: string;
  bare?: boolean;
  style?: StyleProp<TextStyle>;
  /** Pin the chip to a specific palette instead of following the app theme. */
  palette?: ColorPalette;
}

export function MonoChip({ children, bare = false, style, palette }: MonoChipProps) {
  const themed = useThemeColors();
  const colors = palette ?? themed;
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (bare) {
    return <Text style={[styles.text, style]}>{children}</Text>;
  }
  return (
    <View style={styles.chip}>
      <Text style={[styles.text, style]}>{children}</Text>
    </View>
  );
}

function makeStyles(colors: ColorPalette | ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    chip: {
      alignSelf: 'flex-start',
      backgroundColor: colors.subtleFill,
      borderRadius: radius.sm - 1,
      paddingHorizontal: spacing.sm + 1,
      paddingVertical: spacing.xs + 1,
    },
    text: {
      ...typography.mono,
      color: colors.textPrimary,
    },
  });
}
