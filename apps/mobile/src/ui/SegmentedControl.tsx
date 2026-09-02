import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { radius, spacing } from '../design/tokens';
import { useThemeColors } from '../features/settings/theme/useThemeColors';

/**
 * Shared 2-3(+) option segmented control primitive (12-UI-SPEC.md § Screen
 * Inventory). Used by the theme picker (System/Hell/Dunkel), the text-size
 * picker (Standard/Groß/Sehr groß), and (13-04) the SET-07 auto-lock ceiling
 * row. Stateless, DI-free, token-only styling — mirrors
 * `MonoChip.tsx`/`Card.tsx`'s shared-primitive convention.
 *
 * Selection is signalled by BOTH an accent fill AND a heavier font weight
 * (never color alone — colorblind-safe, per the Accessibility Contract).
 * Every option is at least `spacing.touchTarget` (48dp) tall and labels are
 * never line-capped, so they wrap at any font scale instead of clipping.
 *
 * 13-04 addition (SET-07, 13-UI-SPEC.md § Interaction Contract State 3): an
 * OPTIONAL `disabledValues` set dims individual options past a tenant
 * ceiling WITHOUT disabling the control as a whole — a ceiling still
 * permits every stricter-or-equal option, so the existing callers
 * (theme/text-size pickers, which never pass these props) keep working
 * unchanged. A disabled option stays VISIBLE at its full `spacing.
 * touchTarget` hit area (the row must never reflow between states) and is a
 * silent no-op when pressed — no toast, no error, because it is genuinely
 * unreachable, not merely rejected (the DB trigger, 13-02, is the real
 * enforcement backstop). `markedValue` renders a small `lock-outline` glyph
 * on the one option that IS the ceiling, so the boundary reads as "this is
 * the strictest-allowed edge," not merely "everything past here is dimmed."
 */
export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedControlOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Accessibility label for the whole group (not per-option). */
  accessibilityLabel: string;
  /** 13-04/SET-07: options in this set render dimmed and unpressable, but stay visible (never removed/hidden). */
  disabledValues?: readonly T[];
  /** 13-04/SET-07: `accessibilityHint` applied to each disabled option, explaining WHY it is unreachable. */
  disabledHint?: string;
  /** 13-04/SET-07: the one option (typically the ceiling value itself) that carries the small boundary glyph. */
  markedValue?: T;
}

export interface SegmentedOptionStyle {
  container: {
    minHeight: number;
    borderRadius: number;
    backgroundColor: string;
    alignItems: 'center';
    justifyContent: 'center';
    paddingHorizontal: number;
    opacity?: number;
  };
  label: {
    fontWeight: '400' | '600';
    color: string;
  };
}

/**
 * Pure: resolves the visual style for one option. Selected options get an
 * `accent` fill + weight 600 label; unselected get `secondary` fill + weight
 * 400 — a non-color property (fontWeight) always differs between the two
 * states, so selection is never signalled by color alone. Takes the
 * resolved theme colors as a parameter (from `useThemeColors()`) rather than
 * importing the deprecated flat `color` constant, so it stays directly
 * unit-testable without mounting `ThemeProvider`.
 *
 * 13-04 addition: an optional third `disabled` parameter applies `opacity:
 * 0.4` (13-UI-SPEC.md § Interaction Contract State 3's dimming value) and
 * leaves `minHeight` untouched at `spacing.touchTarget` — a disabled option
 * dims, it never shrinks or reflows the row. Omitting the parameter (every
 * pre-13-04 call site) resolves no `opacity` override at all, byte-identical
 * to the prior return shape.
 */
export function getSegmentedOptionStyle(
  selected: boolean,
  colors: ReturnType<typeof useThemeColors>,
  disabled = false,
): SegmentedOptionStyle {
  return {
    container: {
      minHeight: spacing.touchTarget,
      borderRadius: radius.pill,
      backgroundColor: selected ? colors.accent : colors.secondary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
      ...(disabled ? { opacity: 0.4 } : {}),
    },
    label: {
      fontWeight: selected ? '600' : '400',
      color: selected ? colors.onAccent : colors.textPrimary,
    },
  };
}

/**
 * Pure: pressing the already-selected option is a no-op — `onChange` fires
 * exactly once for a genuine selection change, zero times for a re-tap of
 * the current value.
 *
 * 13-04 addition: an optional fourth `disabled` parameter makes a past-
 * ceiling option's press a silent no-op too (no toast, no error — it is
 * genuinely unreachable, per 13-UI-SPEC.md § Interaction Contract State 3),
 * checked BEFORE the re-tap guard so a disabled option can never fire
 * `onChange` even if it happened to already be the current value.
 */
export function handleSegmentedOptionPress<T extends string>(
  optionValue: T,
  currentValue: T,
  onChange: (value: T) => void,
  disabled = false,
): void {
  if (disabled) return;
  if (optionValue === currentValue) return;
  onChange(optionValue);
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  disabledValues,
  disabledHint,
  markedValue,
}: SegmentedControlProps<T>) {
  const colors = useThemeColors();
  return (
    <View style={styles.track} accessibilityLabel={accessibilityLabel}>
      {options.map((option) => {
        const selected = option.value === value;
        const disabled = disabledValues?.includes(option.value) ?? false;
        const marked = option.value === markedValue;
        const optionStyle = getSegmentedOptionStyle(selected, colors, disabled);
        return (
          <Pressable
            key={option.value}
            style={[styles.option, optionStyle.container]}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={option.label}
            accessibilityHint={disabled ? disabledHint : undefined}
            disabled={disabled}
            // A disabled option is genuinely unreachable, not merely
            // rejected — tapping it is a silent no-op (no toast, no error),
            // per 13-UI-SPEC.md § Interaction Contract State 3.
            onPress={() => handleSegmentedOptionPress(option.value, value, onChange, disabled)}
          >
            <View style={styles.optionContent}>
              {marked ? (
                <MaterialCommunityIcons
                  name="lock-outline"
                  size={14}
                  color={optionStyle.label.color}
                  style={styles.markedIcon}
                />
              ) : null}
              <Text style={optionStyle.label}>{option.label}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  option: { flexGrow: 1, flexShrink: 1 },
  optionContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  markedIcon: { marginTop: -1 },
});
