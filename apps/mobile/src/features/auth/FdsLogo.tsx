import { StyleSheet, View } from 'react-native';
import { useThemeColors } from '../settings/theme/useThemeColors';
import type { ColorPalette } from '../../design/tokens';

/**
 * FrontDoorSales app mark (design SSOT screen 01 / Login.dc.html): an Ink-Navy
 * rounded-square tile with the Porch-Light-Amber "door" and the navy "F"
 * glyph. Rebuilt from layered Views (the app has no react-native-svg dependency)
 * at the SSOT's 100-unit proportions, scaled to `size`. Colours come from the
 * design tokens (via `useThemeColors()`), never hardcoded.
 *
 * `palette` pins the mark to one palette for surfaces that do not follow the
 * app theme. `ink` INVERTS between the two palettes (navy on light, near-white
 * on dark), so on BeraterAusweisScreen's fixed dark card the themed mark
 * disappeared into its own background in light mode.
 */
export interface FdsLogoProps {
  size?: number;
  /** Pin the mark to a specific palette instead of following the app theme. */
  palette?: ColorPalette;
}

export function FdsLogo({ size = 60, palette }: FdsLogoProps) {
  const themed = useThemeColors();
  const colors = palette ?? themed;
  const u = size / 100; // design viewBox is 0..100
  return (
    <View
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: 26 * u, backgroundColor: colors.ink },
      ]}
      accessibilityRole="image"
      accessibilityLabel="FrontDoorSales"
    >
      {/* amber door */}
      <View
        style={{
          position: 'absolute',
          left: 29 * u,
          top: 25 * u,
          width: 42 * u,
          height: 57 * u,
          borderRadius: 7 * u,
          backgroundColor: colors.accent,
        }}
      />
      {/* navy "F" — vertical stroke */}
      <View style={navyBar(37 * u, 35 * u, 9 * u, 47 * u, 1.5 * u, colors.ink)} />
      {/* navy "F" — top stroke */}
      <View style={navyBar(37 * u, 35 * u, 24 * u, 9 * u, 1.5 * u, colors.ink)} />
      {/* navy "F" — middle stroke */}
      <View style={navyBar(37 * u, 50 * u, 16 * u, 8 * u, 1.5 * u, colors.ink)} />
    </View>
  );
}

function navyBar(left: number, top: number, width: number, height: number, r: number, tint: string) {
  return {
    position: 'absolute' as const,
    left,
    top,
    width,
    height,
    borderRadius: r,
    backgroundColor: tint,
  };
}

const styles = StyleSheet.create({
  tile: { position: 'relative', overflow: 'hidden' },
});
