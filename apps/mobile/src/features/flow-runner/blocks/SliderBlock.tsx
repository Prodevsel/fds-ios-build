import { useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import type { SliderBlock as SliderBlockDef } from '@frontdoorsales/flow-schema';
import { radius, spacing, typography } from '../../../design/tokens';
import { useThemeColors } from '../../settings/theme/useThemeColors';
import { t } from '../../../i18n';
import { Button } from '../../../ui/Button';
import { steppedValue, valueFromFraction } from './sliderValue';

export interface SliderBlockProps {
  block: SliderBlockDef;
  value: number | undefined;
  onAnswer: (fieldId: string, value: number) => void | Promise<void>;
}

/**
 * Design screen 04's value block — a white value card with the Ink-Navy filled
 * progress track + thumb from the mockup, over a stepped +/- control. No
 * slider-library dependency is added (threat_model T-03-SC); the drag is a
 * PanResponder over the track's measured width, snapped to `block.step`.
 *
 * Two defects this block carried until now:
 *
 *   * The metric label was HARD-CODED to `flow.consumptionLabel`
 *     ("Jahresverbrauch"). Written for the electricity product and never
 *     generalised, so a slider counting locations announced itself as an annual
 *     electricity consumption. It now shows the block's own `unit`, and the
 *     value beside it is the bare number — which also disposes of the
 *     "1 Standorte" grammar the old layout produced.
 *   * The track was `pointerEvents="none"` with the comment "no gesture". A
 *     thing shaped exactly like a slider that cannot be dragged is not a
 *     simplification, it is a broken affordance; every rep tried to drag it
 *     first. The +/- buttons stay, because they are what makes an exact value
 *     reachable with gloves on.
 */
export function SliderBlock({ block, value, onAnswer }: SliderBlockProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [current, setCurrent] = useState(value ?? block.min);
  /** Measured track width; 0 until layout, which the responder guards against. */
  const trackWidth = useRef(0);

  function adjust(delta: number) {
    setCurrent((prev) => steppedValue(prev + delta, block));
  }

  /**
   * Drag anywhere on the track. Absolute x, not a delta, so a tap jumps
   * straight to the value under the finger instead of nudging from wherever
   * the last drag ended.
   *
   * The handler is reached through a ref rather than captured directly.
   * `PanResponder.create` runs ONCE inside `useRef`, so a directly captured
   * closure would keep the first render's `block` and `trackWidth` forever —
   * latent today because both are stable, and a silent wrong-value bug the day
   * a product changes min/max.
   */
  const seekRef = useRef<(x: number) => void>(() => {});
  seekRef.current = (x: number) => {
    const w = trackWidth.current;
    if (w <= 0) return;
    setCurrent(valueFromFraction(x / w, block));
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => seekRef.current(e.nativeEvent.locationX),
      onPanResponderMove: (e) => seekRef.current(e.nativeEvent.locationX),
    }),
  ).current;

  const span = block.max - block.min;
  const pct = span > 0 ? Math.min(100, Math.max(0, ((current - block.min) / span) * 100)) : 0;

  return (
    <View>
      <Text style={styles.label}>{block.label}</Text>
      <View style={styles.valueCard}>
        <View style={styles.valueRow}>
          <Text style={styles.metricLabel}>{block.unit ?? ''}</Text>
          <Text style={styles.value}>{current}</Text>
        </View>
        <View
          style={styles.track}
          onLayout={(e) => {
            trackWidth.current = e.nativeEvent.layout.width;
          }}
          accessibilityRole="adjustable"
          accessibilityLabel={block.label}
          accessibilityValue={{ min: block.min, max: block.max, now: current }}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'increment') adjust(block.step);
            if (e.nativeEvent.actionName === 'decrement') adjust(-block.step);
          }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          // The track draws 10dp tall; a 10dp drag target is unusable. hitSlop
          // brings the graspable band to ~48dp without changing the visual.
          hitSlop={{ top: spacing.lg, bottom: spacing.lg, left: 0, right: 0 }}
          // box-only is what makes the drag stable, and its absence is what
          // made the slider jump. `locationX` is measured from the TOUCH
          // TARGET, not from the responder — so as soon as the finger passed
          // over the thumb, x counted from the THUMB's left edge instead of the
          // track's. That closes a feedback loop: new value -> thumb moves
          // under the finger -> origin shifts -> new value. box-only keeps the
          // track itself the only target its subviews can never steal.
          pointerEvents="box-only"
          {...pan.panHandlers}
        >
          <View style={[styles.trackFill, { width: `${pct}%` }]} />
          <View style={[styles.thumb, { left: `${pct}%` }]} />
        </View>
        <View style={styles.adjustRow}>
          <Pressable style={styles.adjustButton} accessibilityRole="button" onPress={() => adjust(-block.step)}>
            <Text style={styles.adjustButtonText}>−</Text>
          </Pressable>
          <Pressable style={styles.adjustButton} accessibilityRole="button" onPress={() => adjust(block.step)}>
            <Text style={styles.adjustButtonText}>+</Text>
          </Pressable>
        </View>
      </View>
      <Button title={t('flowRunner.next')} onPress={() => void onAnswer(block.id, current)} />
    </View>
  );
}

const THUMB = 34;

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    label: { ...typography.display, color: colors.textPrimary, marginBottom: spacing.lg },
    valueCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg - 4,
      marginBottom: spacing.lg,
    },
    valueRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginBottom: spacing.md + 2,
    },
    metricLabel: { ...typography.label, fontWeight: '600', color: colors.textSecondary },
    value: { ...typography.price, color: colors.textPrimary },
    track: {
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.subtleFill,
      marginBottom: spacing.lg + spacing.xs,
      justifyContent: 'center',
    },
    trackFill: {
      position: 'absolute',
      left: 0,
      top: 0,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.ink,
    },
    thumb: {
      position: 'absolute',
      width: THUMB,
      height: THUMB,
      marginLeft: -THUMB / 2,
      borderRadius: THUMB / 2,
      backgroundColor: colors.surface,
      borderWidth: 3,
      borderColor: colors.ink,
      shadowColor: colors.ink,
      shadowOpacity: 0.4,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3,
    },
    adjustRow: { flexDirection: 'row', gap: spacing.sm },
    adjustButton: {
      flex: 1,
      minHeight: spacing.touchTarget,
      minWidth: spacing.touchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.input,
      borderWidth: 1.5,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surface,
    },
    adjustButtonText: { ...typography.heading, color: colors.textPrimary },
  });
}
