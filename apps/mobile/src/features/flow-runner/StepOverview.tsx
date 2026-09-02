import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useMemo } from 'react';
import type { Block } from '@frontdoorsales/flow-schema';
import { radius, spacing, typography } from '../../design/tokens';
import { useThemeColors } from '../settings/theme/useThemeColors';

export interface StepOverviewProps {
  blocks: Block[];
  activeIndex: number;
  maxReachedIndex: number;
  answers: Record<string, unknown>;
  onJump: (index: number) => void;
}

/**
 * D-03: the index of the first unconfirmed gate block in `blocks` (the
 * visible-ordered list — Pitfall 3, never the raw unfiltered blocks array).
 * A gate block is "confirmed" only via an explicit confirm answer
 * (BelehrungBlock/SignatureBlock save `true`). Returns -1 when there is no
 * unconfirmed gate in the current visible list — including when a gate was
 * hidden by a later show-if change, since it then no longer appears in
 * `blocks` at all and cannot leave a stale past-gate index behind.
 */
export function firstUnconfirmedGateIndex(blocks: Block[], answers: Record<string, unknown>): number {
  return blocks.findIndex((block) => block.gate === true && !answers[block.id]);
}

/**
 * D-02: tappable step-progress list — jumps directly to any already-reached
 * block, never ahead of it. D-03: taps to any step AT or AFTER the first
 * unconfirmed gate index are also blocked, regardless of maxReachedIndex —
 * a gate must be reached and confirmed via the normal forward flow, never
 * jumped onto or past via the step overview.
 */
export function canJumpTo(targetIndex: number, maxReachedIndex: number, firstUnconfirmedGateIdx: number): boolean {
  if (targetIndex > maxReachedIndex) return false;
  if (firstUnconfirmedGateIdx !== -1 && targetIndex >= firstUnconfirmedGateIdx) return false;
  return true;
}

export function StepOverview({ blocks, activeIndex, maxReachedIndex, answers, onJump }: StepOverviewProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const gateIndex = firstUnconfirmedGateIndex(blocks, answers);
  return (
    <View style={styles.row} testID="step-overview">
      {blocks.map((block, index) => {
        const reachable = canJumpTo(index, maxReachedIndex, gateIndex);
        const isActive = index === activeIndex;
        return (
          <Pressable
            key={block.id}
            style={[styles.dot, isActive ? styles.dotActive : null, !reachable ? styles.dotUnreachable : null]}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive, disabled: !reachable }}
            disabled={!reachable}
            onPress={() => onJump(index)}
          >
            <Text style={[styles.dotText, isActive ? styles.dotTextActive : null]}>{index + 1}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
    },
    dot: {
      width: spacing.xl + spacing.xs,
      height: spacing.xl + spacing.xs,
      borderRadius: radius.md,
      backgroundColor: colors.subtleFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Active step is Ink-Navy (amber stays the primary CTA); reached steps read
    // as neutral fill, unreached are dimmed.
    dotActive: { backgroundColor: colors.ink },
    dotUnreachable: { opacity: 0.4 },
    dotText: { ...typography.label, fontWeight: '600', color: colors.textPrimary },
    dotTextActive: { color: colors.onAccent },
  });
}
