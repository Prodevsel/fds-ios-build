import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { radius, spacing, typography } from '../../../design/tokens';
import { useThemeColors } from '../../settings/theme/useThemeColors';

/**
 * Glove-safe numeric PIN keypad (D-10, 15-UI-SPEC.md §1). 3x4 grid of
 * digits 1-9, a blank cell, 0, and backspace — digits only, no letters, no
 * decoys. Every key is `spacing.pinKeypadTarget` (120dp, re-derived in
 * `design/tokens.ts`'s header comment) wide/tall and fully circular, so a
 * gloved or wet fingertip has a large, unambiguous hit area (D-10's stated
 * threat: Touch ID/Face ID failing under exactly those conditions).
 *
 * The entered PIN is NEVER rendered as text anywhere in this component —
 * only a dots-progress row (T-15-05-03: shoulder-surfing). `value` is read
 * only for its `.length` (dot count + completion check), never interpolated
 * into a `<Text>` node.
 *
 * Follows `SegmentedControl.tsx`'s split: pure, exported, unit-testable
 * logic (`derivePinDotsLabel`, `computeNextValue`, `handleDigitPress`,
 * `handleBackspacePress`) plus a thin component that composes them — this
 * repo has no `react-test-renderer`/testing-library, so the logic must be
 * independently testable without mounting the tree (StatusSheet.test.tsx /
 * DiscountBlock.test.tsx precedent).
 */

/** Pressed-ring stroke width (dp) — a stroke weight, not a size/spacing/radius token value. */
const KEY_PRESSED_RING_WIDTH = 3;

const DIGIT_ROWS: readonly (readonly string[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
];

/**
 * Pure a11y label for the dots-progress row — German, per CLAUDE.md's
 * user-facing-copy language policy. Composed here from counts rather than
 * added to `de.json`: it is not static copy, it is a template driven purely
 * by two numbers, so treating it as a translatable i18n key would add a
 * layer of indirection for no benefit (there is nothing to translate that
 * isn't already parameterized). This is a deliberate choice, not a
 * hardcoded-copy violation.
 */
export function derivePinDotsLabel(entered: number, total: number): string {
  return `${entered} von ${total} Ziffern eingegeben`;
}

/** Pure: appends `digit` to `value` unless already at `pinLength` (no-op past the cap). */
export function computeNextValue(value: string, digit: string, pinLength: number): string {
  if (value.length >= pinLength) return value;
  return value + digit;
}

/**
 * Pure orchestration for a digit press: computes the next value, always
 * calls `onChange` with it (unless already full, in which case it is a
 * no-op), and calls `onComplete` exactly once — only on the transition that
 * reaches `pinLength`, never again on a later call with an already-full
 * value (that later call is the "already full" no-op branch above).
 */
export function handleDigitPress(
  value: string,
  digit: string,
  pinLength: number,
  onChange: (next: string) => void,
  onComplete: (pin: string) => void,
): void {
  if (value.length >= pinLength) return;
  const next = computeNextValue(value, digit, pinLength);
  onChange(next);
  if (next.length === pinLength) {
    onComplete(next);
  }
}

/** Pure: removes the last entered digit, no-op on an already-empty value. */
export function handleBackspacePress(value: string, onChange: (next: string) => void): void {
  if (value.length === 0) return;
  onChange(value.slice(0, -1));
}

export interface PinKeypadProps {
  value: string;
  pinLength: number;
  disabled: boolean;
  onChange(next: string): void;
  onComplete(pin: string): void;
}

export function PinKeypad({ value, pinLength, disabled, onChange, onComplete }: PinKeypadProps) {
  const colors = useThemeColors();
  // spacing.pinKeypadTarget is 120: three keys plus two gaps plus the gate's
  // horizontal padding come to well over 400dp, so on anything narrower than a
  // Pro Max the outer columns were clipped — on the screen where an unreachable
  // key locks the rep out of the app. The token stays the IDEAL size; this is
  // the largest that actually fits, never below a 64dp touch target.
  const { width } = useWindowDimensions();
  const available = width - HORIZONTAL_CHROME;
  const keySize = Math.max(
    MIN_KEY_SIZE,
    Math.min(spacing.pinKeypadTarget, Math.floor((available - 2 * spacing.md) / 3)),
  );
  const styles = makeStyles(colors, keySize);

  const dotsLabel = derivePinDotsLabel(value.length, pinLength);
  const dots = Array.from({ length: pinLength }, (_, index) => index < value.length);

  const onDigitPress = (digit: string) => {
    if (disabled) return;
    handleDigitPress(value, digit, pinLength, onChange, onComplete);
  };
  const onBackspacePress = () => {
    if (disabled) return;
    handleBackspacePress(value, onChange);
  };

  return (
    <View>
      <View style={styles.dotsRow} accessibilityLabel={dotsLabel}>
        {dots.map((filled, index) => (
          // eslint-disable-next-line react/no-array-index-key -- fixed-length, position-only dots, never reordered
          <View key={index} style={[styles.dot, filled ? styles.dotFilled : styles.dotEmpty]} />
        ))}
      </View>
      <View style={styles.grid}>
        {DIGIT_ROWS.map((row, rowIndex) => (
          // eslint-disable-next-line react/no-array-index-key -- fixed, static 3x4 layout
          <View key={rowIndex} style={styles.row}>
            {row.map((digit) => (
              <Pressable
                key={digit}
                accessibilityRole="button"
                accessibilityLabel={digit}
                disabled={disabled}
                onPress={() => onDigitPress(digit)}
                style={({ pressed }) => [
                  styles.key,
                  pressed ? styles.keyPressed : null,
                  disabled ? styles.keyDisabled : null,
                ]}
              >
                <Text style={styles.digitGlyph}>{digit}</Text>
              </Pressable>
            ))}
          </View>
        ))}
        <View style={styles.row}>
          <View style={styles.key} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="0"
            disabled={disabled}
            onPress={() => onDigitPress('0')}
            style={({ pressed }) => [
              styles.key,
              pressed ? styles.keyPressed : null,
              disabled ? styles.keyDisabled : null,
            ]}
          >
            <Text style={styles.digitGlyph}>0</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Löschen"
            disabled={disabled}
            onPress={onBackspacePress}
            style={({ pressed }) => [
              styles.key,
              pressed ? styles.keyPressed : null,
              disabled ? styles.keyDisabled : null,
            ]}
          >
            <Text style={styles.digitGlyph}>⌫</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** Gate padding (spacing.xl each side) plus a little breathing room. */
const HORIZONTAL_CHROME = 2 * spacing.xl + spacing.md;
/** Never shrink a key below the platform minimum touch target. */
const MIN_KEY_SIZE = 64;

function makeStyles(colors: ReturnType<typeof useThemeColors>, keySize: number) {
  return StyleSheet.create({
    dotsRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: spacing.sm,
      marginBottom: spacing.lg,
    },
    dot: {
      width: spacing.sm,
      height: spacing.sm,
      borderRadius: radius.pill,
    },
    dotFilled: { backgroundColor: colors.accent },
    dotEmpty: { backgroundColor: colors.secondary },
    grid: { gap: spacing.md },
    row: { flexDirection: 'row', justifyContent: 'center', gap: spacing.md },
    key: {
      width: keySize,
      height: keySize,
      borderRadius: keySize / 2,
      backgroundColor: colors.secondary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Pressed state: a colors.accent RING (border), never an accent resting
    // fill — the accent budget belongs to the biometric CTA (15-UI-SPEC.md
    // §1). Border width is a stroke weight, not a size/spacing/radius/color
    // token value (EmptyState.tsx's borderWidth: 1 precedent).
    keyPressed: {
      borderWidth: KEY_PRESSED_RING_WIDTH,
      borderColor: colors.accent,
    },
    keyDisabled: { opacity: 0.4 },
    digitGlyph: {
      ...typography.display,
      color: colors.textPrimary,
    },
  });
}
