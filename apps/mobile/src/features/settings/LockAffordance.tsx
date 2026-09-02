import { Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { radius, spacing, typography } from '../../design/tokens';
import { t } from '../../i18n';
import { useThemeColors } from './theme/useThemeColors';

/**
 * LockAffordance — the icon+chip row decoration for SET-07's proposed/
 * locked settings rows (13-UI-SPEC.md § Interaction Contract, § Color).
 * PATTERNS.md found no existing analog for this component; its structural
 * shape (pure style resolver + thin presentational wrapper) copies
 * `SegmentedControl.tsx`'s `getSegmentedOptionStyle`/`SegmentedControl` split
 * — the closest cousin in this codebase.
 *
 * D-16 (load-bearing, do not regress): 'proposed' and 'locked' are
 * distinguished ONLY by icon SHAPE (`information-outline` vs `lock-outline`)
 * and copy VERB ("vorgeschlagen" vs "vorgegeben") — NEVER by color. Both
 * states render the exact same neutral chip background (`colors.secondary`)
 * and text color (`colors.textSecondary`); this is deliberate (13-UI-SPEC.md
 * § Color: "a lock/proposal is neutral tenant governance information, not a
 * warning and not the screen's primary action"). Dropping either the
 * icon-shape or the copy-verb differentiator is an accessibility regression
 * (D-16), not a style simplification available for a future cleanup pass.
 */

export type LockAffordanceState = 'free' | 'proposed' | 'locked';

export interface LockAffordanceStyle {
  icon: 'information-outline' | 'lock-outline';
  chip: {
    flexDirection: 'row';
    alignItems: 'center';
    alignSelf: 'flex-start';
    gap: number;
    backgroundColor: string;
    borderRadius: number;
    paddingHorizontal: number;
    paddingVertical: number;
  };
  label: {
    fontSize: number;
    fontWeight: '400';
    lineHeight: number;
    color: string;
  };
}

/**
 * Pure: resolves the icon glyph plus chip/label style for a row state.
 * Returns `null` for `'free'` — a free row renders no icon and no chip at
 * all (13-UI-SPEC.md Interaction Contract, State 1).
 */
export function getLockAffordanceStyle(
  state: LockAffordanceState,
  colors: ReturnType<typeof useThemeColors>,
): LockAffordanceStyle | null {
  if (state === 'free') return null;

  return {
    icon: state === 'proposed' ? 'information-outline' : 'lock-outline',
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: spacing.xs,
      backgroundColor: colors.secondary,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    label: {
      fontSize: typography.label.fontSize,
      fontWeight: '400',
      lineHeight: typography.label.lineHeight,
      color: colors.textSecondary,
    },
  };
}

/**
 * Small presentational row decoration: an icon + chip pill above a lockable
 * control. Renders `null` for `'free'` (no icon, no chip — matches the
 * unlockable Barrierefreiheit rows' treatment exactly, D-17). Token/
 * `useThemeColors()`-only styling — no hardcoded hex, dp or font size.
 */
export function LockAffordance({ state }: { state: LockAffordanceState }) {
  const colors = useThemeColors();
  const style = getLockAffordanceStyle(state, colors);
  if (!style) return null;

  const badgeText =
    state === 'proposed' ? t('settings.proposedByOrgBadge') : t('settings.lockedByOrgBadge');

  return (
    <View style={style.chip}>
      <MaterialCommunityIcons name={style.icon} size={16} color={colors.textSecondary} />
      <Text style={style.label}>{badgeText}</Text>
    </View>
  );
}
