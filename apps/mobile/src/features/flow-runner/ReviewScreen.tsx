import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { radius, spacing, typography } from '../../design/tokens';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { t } from '../../i18n';
import { Button } from '../../ui/Button';
import type { ReviewRow } from './reviewRows';

/**
 * "Angaben prüfen" — the check-everything screen the rep and the customer go
 * through together, immediately before the signature capture.
 *
 * Rendered by `FlowRunnerScreen` in place of the signature block the first
 * time the cursor lands on it, rather than as an extra entry in the visible
 * block list. That placement is the whole design decision, and it is worth
 * stating why: `visible` is the array `currentIndex`, `maxReachedIndex`, the
 * progress bar, `firstUnconfirmedGateIndex` and `clampToUnconfirmedGate` all
 * index into, and the completion path leans on the invariant that the LAST
 * visible block is the signature (see `handleComplete`'s guard comment).
 * Splicing a synthetic review step into that array would shift every index by
 * one, put a phantom step in "Schritt X von Y", and move the gate boundary
 * the server-side 0030 trigger mirrors — a lot of legally load-bearing
 * arithmetic disturbed for a screen that needs none of it. Rendering it as a
 * pre-empting surface on the signature step gets the same user-visible
 * ordering ("check, then sign") while the index space stays exactly as it was.
 *
 * This component is layout only. Which blocks become rows, how each answer
 * reads, and what is redacted all live in `reviewRows.ts`, which is a pure
 * module precisely because this repo has no `react-test-renderer` and nothing
 * inside a component here could otherwise be asserted.
 */
export interface ReviewScreenProps {
  /** Already-built rows, in flow order (see `buildReviewRows`). */
  rows: ReviewRow[];
  /**
   * Whether a row's block index may be jumped to. Supplied by the caller so
   * the gate rule stays in ONE place (`StepOverview.canJumpTo`) instead of
   * being re-derived, and re-derived differently, here.
   */
  isJumpable: (index: number) => boolean;
  /** Jump back to the row's block for correction. */
  onJump: (index: number) => void;
  /** Everything checked — reveal the signature capture. */
  onContinue: () => void;
  /** Step back off the review, to the block before the signature. */
  onBack: () => void;
}

export function ReviewScreen({ rows, isJumpable, onJump, onContinue, onBack }: ReviewScreenProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // No insets here, deliberately. StatusSheet already applies
  // { paddingTop: insets.top, paddingBottom: insets.bottom } to the whole flow
  // modal (StatusSheet.tsx:613-618, "Applied here rather than in each screen"),
  // so reading them again added a SECOND status bar above "Angaben pruefen" and
  // a second home indicator under the CTA. Exactly the doubling SuccessScreen
  // documents and avoids.
  const hasMaskedRow = rows.some((row) => row.masked);

  return (
    <View style={styles.container} testID="flow-review-screen">
      <View style={[styles.header, { paddingTop: spacing.md }]}>
        <Pressable
          style={styles.backTile}
          accessibilityRole="button"
          accessibilityLabel={t('review.back')}
          onPress={onBack}
          testID="flow-review-back"
        >
          <MaterialCommunityIcons name="chevron-left" size={24} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.headings}>
          <Text style={styles.heading}>{t('review.heading')}</Text>
          <Text style={styles.subheading}>{t('review.subheading')}</Text>
        </View>
      </View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        testID="flow-review-list"
      >
        {rows.length === 0 ? (
          <Text style={styles.empty}>{t('review.empty')}</Text>
        ) : (
          rows.map((row) => {
            const jumpable = isJumpable(row.index);
            return (
              <Pressable
                key={row.blockId}
                style={[styles.row, !jumpable && styles.rowLocked]}
                accessibilityRole="button"
                // The label reads the whole row aloud, because a screen reader
                // user must hear WHICH entry they are about to jump into, not
                // just "button".
                accessibilityLabel={`${row.label}: ${row.value}`}
                accessibilityHint={jumpable ? t('review.rowAccessibilityHint') : undefined}
                accessibilityState={{ disabled: !jumpable }}
                disabled={!jumpable}
                onPress={() => onJump(row.index)}
                testID={`flow-review-row-${row.blockId}`}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>{row.label}</Text>
                  <Text
                    style={[styles.rowValue, row.masked && styles.rowValueMasked]}
                    numberOfLines={2}
                  >
                    {row.value}
                  </Text>
                </View>
                {jumpable ? (
                  <View style={styles.editAffordance}>
                    <Text style={styles.editText}>{t('review.editHint')}</Text>
                    <MaterialCommunityIcons
                      name="pencil-outline"
                      size={16}
                      color={colors.textSecondary}
                    />
                  </View>
                ) : null}
              </Pressable>
            );
          })
        )}

        {/* Only shown when something actually IS elided, so the note stays a
            fact about this screen rather than boilerplate the rep learns to
            ignore. Without it an elided IBAN reads as a bad scan and gets
            re-captured for no reason. */}
        {hasMaskedRow ? <Text style={styles.maskedNote}>{t('review.maskedNote')}</Text> : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: spacing.lg }]}>
        <Button title={t('review.continueCta')} onPress={onContinue} testID="flow-review-continue" />
      </View>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
    },
    // Same 48dp white tile as the flow's own step header, so "back" does not
    // change shape between the last block and this screen.
    backTile: {
      width: spacing.touchTarget,
      height: spacing.touchTarget,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headings: { flex: 1, gap: spacing.xs },
    heading: { ...typography.display, color: colors.textPrimary },
    subheading: { ...typography.label, color: colors.textSecondary },
    list: { flex: 1 },
    listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      // 48dp floor: this list is tapped one-handed, outdoors, in a hurry.
      minHeight: spacing.touchTarget,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      borderRadius: radius.card,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    // A row behind an unconfirmed gate cannot be jumped to. It still READS —
    // hiding it would make the review list an incomplete summary — but it
    // drops the edit affordance and dims, the same language StepOverview uses.
    rowLocked: { opacity: 0.4 },
    rowText: { flex: 1, gap: spacing.xs },
    rowLabel: { ...typography.label, color: colors.textSecondary },
    rowValue: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
    // Elided values are technical fragments ("DE44 … 31"), so they get the
    // mono treatment the IBAN/deal-reference values already use elsewhere.
    rowValueMasked: { ...typography.mono, fontWeight: '600', color: colors.textPrimary },
    editAffordance: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    editText: { ...typography.label, fontWeight: '600', color: colors.textSecondary },
    empty: { ...typography.body, color: colors.textSecondary },
    maskedNote: { ...typography.label, color: colors.textMuted, paddingTop: spacing.sm },
    footer: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.background,
    },
  });
}
