import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { lightColors, spacing, statusColor, statusIcon, type HouseStatus } from '../../design/tokens';

/**
 * Every pin dimension in ONE place, so the numbers can be asserted without a
 * renderer (this workspace has no `react-test-renderer`) and so a future size
 * tweak cannot silently drift the touch zone or the badge anchor apart.
 *
 * The disc shrank from 44dp to 32dp because five pins on a dense city block
 * swamped the map. What did NOT shrink: the tap zone (`spacing.touchTarget`,
 * non-negotiable), the ring and the shadow (they are why the pin reads in
 * sunlight — that was the original reason it was large, and shrinking the disc
 * must not weaken its contrast), and the badge's type size.
 */
const PIN_TOUCH_ZONE = spacing.touchTarget;
const PIN_CIRCLE = 32;
const BADGE_SIZE = 18;
/** How far the badge sits over the circle's corner, in dp. */
const BADGE_OVERLAP = 4;
/**
 * The circle is centred in the tap zone, so its top-right corner is at
 * `(touchZone - inset, inset)`. The badge is anchored from THAT corner rather
 * than from the zone's own corner — left at `top: 0, right: 0` it would float
 * detached now that the disc is 12dp smaller.
 */
const BADGE_ANCHOR_INSET = (PIN_TOUCH_ZONE - PIN_CIRCLE) / 2 - BADGE_OVERLAP;

export const housePinMetrics = {
  /** Fixed 48dp tap target, independent of the visual glyph size. */
  touchZone: PIN_TOUCH_ZONE,
  circle: PIN_CIRCLE,
  ring: 2,
  /** Half the circle — the same glyph/disc ratio the 44/22 pin had. */
  icon: 16,
  badge: {
    size: BADGE_SIZE,
    ring: 2,
    /** Offsets within the tap zone, measured from the CIRCLE's corner. */
    top: BADGE_ANCHOR_INSET,
    right: BADGE_ANCHOR_INSET,
    /**
     * Held at 11sp on purpose. The badge was re-checked at the smaller pin size
     * and its TYPE was deliberately NOT scaled down with the circle: the 0088
     * open-doors digit is the thing being protected here, and `minWidth: 18` +
     * 3dp horizontal padding still fits a two-digit count.
     */
    fontSize: 11,
    lineHeight: 13,
    overlap: BADGE_OVERLAP,
  },
} as const;

export interface HousePinProps {
  status: HouseStatus;
  /** German a11y label, e.g. "Haus, Status: Wiedervorlage" — supplied by the caller via i18n. */
  accessibilityLabel: string;
  /**
   * Tap handler on the pin view itself. Marker's native onPress is unreliable
   * on Android (the map claims the touch first) — a Pressable child receives
   * the tap before the map does.
   */
  onPress?: () => void;
  /**
   * 0088: untouched doors at this building. `null`/absent = a party-less house,
   * which renders EXACTLY the pin it rendered before 0088 — no badge, no
   * dimming. Optional on purpose so every existing call site stays valid.
   */
  openUnits?: number | null;
  /** 0088: every party terminal — a quiet pin with a tick and no number. */
  allUnitsDone?: boolean;
}

/**
 * Traffic-light status pin (UI-SPEC "Traffic-light status palette" /
 * "Icon-pairing requirement"): every status pairs a distinct color with a
 * distinct MaterialCommunityIcons glyph, never color alone (colorblind
 * safety). Touch target is fixed at 48dp (`spacing.touchTarget`) regardless
 * of the visual glyph size.
 *
 * Deliberately NOT routed through `useThemeColors()` (12-10, mirrors the
 * `BeraterAusweisScreen.tsx` precedent from 12-09): the pin's ring/icon
 * colour must contrast against `statusColor` — an invariant, always-saturated
 * traffic-light hue chosen for outdoor legibility, not a themed surface — so
 * pinning it to `lightColors.onAccent`/`lightColors.ink` keeps that contrast
 * correct in both light and dark mode instead of flipping to a dark-surface
 * tone that would wash out against the pin's own fixed background.
 */
export function HousePin({
  status,
  accessibilityLabel,
  onPress,
  openUnits = null,
  allUnitsDone = false,
}: HousePinProps) {
  const done = allUnitsDone === true;
  const pinColor = done ? statusColor.success : statusColor[status];
  const glyph = done ? statusIcon.success : statusIcon[status];
  const iconName = glyph as React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  const showBadge = !done && typeof openUnits === 'number' && openUnits > 0;

  return (
    <Pressable
      style={styles.touchZone}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
    >
      {/* A finished building is the SAME hue, only quieter — an opacity on the
          circle, never a second colour constant. A new tone would need its own
          glyph pairing and its own contrast proof. */}
      <View
        style={[styles.circle, { backgroundColor: pinColor }, done ? styles.circleDone : null]}
      >
        <MaterialCommunityIcons
          name={iconName}
          size={housePinMetrics.icon}
          color={lightColors.onAccent}
        />
      </View>
      {showBadge ? (
        // Open doors are a COUNT, not a status, so the badge is deliberately
        // not colour-coded: a neutral ink chip with the same white ring the
        // pin wears, so it reads on a crowded map in sunlight without adding a
        // fifth hue to a four-colour traffic light. It sits INSIDE the fixed
        // 48dp touch zone — the touch target never grows.
        <View style={styles.badge} pointerEvents="none">
          <Text style={styles.badgeText} numberOfLines={1}>
            {String(openUnits)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  touchZone: {
    width: housePinMetrics.touchZone,
    height: housePinMetrics.touchZone,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Design screen 02, re-sized: a 32dp status pin with a 2dp white ring + the
  // unchanged drop shadow so it still reads on a busy map in sunlight (the 48dp
  // touch zone above stays fixed).
  circleDone: {
    // Same traffic-light green, just quieter: "done" is a lower-attention
    // state, not a different meaning.
    opacity: 0.45,
  },
  badge: {
    position: 'absolute',
    top: BADGE_ANCHOR_INSET,
    right: BADGE_ANCHOR_INSET,
    minWidth: housePinMetrics.badge.size,
    height: housePinMetrics.badge.size,
    borderRadius: housePinMetrics.badge.size / 2,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: lightColors.ink,
    borderWidth: housePinMetrics.badge.ring,
    borderColor: lightColors.onAccent,
  },
  badgeText: {
    color: lightColors.onAccent,
    fontSize: housePinMetrics.badge.fontSize,
    fontWeight: '700',
    lineHeight: housePinMetrics.badge.lineHeight,
  },
  circle: {
    width: housePinMetrics.circle,
    height: housePinMetrics.circle,
    borderRadius: housePinMetrics.circle / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: housePinMetrics.ring,
    borderColor: lightColors.onAccent,
    shadowColor: lightColors.ink,
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
});
