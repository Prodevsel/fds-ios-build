import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { RecommendationBlock as RecommendationBlockDef } from '@frontdoorsales/flow-schema';
import { radius, spacing, typography } from '../../../design/tokens';
import { useThemeColors } from '../../settings/theme/useThemeColors';
import { t } from '../../../i18n';
import { deriveRecommendation } from '../useRecommendation';

export interface RecommendationBlockProps {
  block: RecommendationBlockDef;
  /** All answers so far (the rule engine derives the suggestion from these, D-12). */
  answers: Record<string, unknown>;
  /** This block's OWN already-saved answer (if resumed) — the rep's prior override, if any. */
  value: string | undefined;
  onAnswer: (fieldId: string, value: string) => void | Promise<void>;
}

function optionLabel(options: RecommendationBlockDef['options'], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

/**
 * D-14: the effective (saved) choice is the rep's override if one was
 * already made, otherwise the SSOT-derived suggestion (first-match-wins,
 * mandatory fallback). Exported separately so it is directly unit-testable
 * (no react-test-renderer in this repo, mirrors DiscountBlock's
 * computeSnapshot / resolveAndFreezeSnapshot split).
 */
export function resolveEffectiveChoice(
  block: Pick<RecommendationBlockDef, 'rules'>,
  answers: Record<string, unknown>,
  savedValue: string | undefined,
): { suggested: string; effective: string; overridden: boolean } {
  const suggested = deriveRecommendation(block.rules, answers);
  const effective = savedValue ?? suggested;
  return { suggested, effective, overridden: savedValue !== undefined && savedValue !== suggested };
}

/**
 * D-12/D-14: displays the first-match rule-derived suggestion (e.g. a
 * device-count/speed-tier combo mapping to a specific tariff) prominently,
 * plus the full option list as an override selector — the customer decides,
 * the rep can override. Tapping ANY option
 * (the suggested one or a different one) answers AND advances immediately
 * (ChoiceBlock's D-01 tap-to-answer pattern); the tapped value becomes the
 * saved answer whether or not it matches the suggestion.
 */
export function RecommendationBlock({ block, answers, value, onAnswer }: RecommendationBlockProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { suggested, effective } = useMemo(
    () => resolveEffectiveChoice(block, answers, value),
    [block, answers, value],
  );

  return (
    <View>
      <Text style={styles.label}>{block.label}</Text>
      <View style={styles.suggestionCard}>
        <Text style={styles.suggestionCaption}>{t('flowRunner.recommendationSuggested')}</Text>
        <Text style={styles.suggestionValue}>{optionLabel(block.options, suggested)}</Text>
      </View>
      <Text style={styles.overrideCaption}>{t('flowRunner.recommendationOverrideHint')}</Text>
      {block.options.map((option) => {
        const selected = effective === option.value;
        return (
          <Pressable
            key={option.value}
            style={[styles.option, selected ? styles.optionSelected : null]}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => void onAnswer(block.id, option.value)}
          >
            <Text style={[styles.optionText, selected ? styles.optionTextSelected : null]}>
              {option.label}
            </Text>
            {selected ? <MaterialCommunityIcons name="check" size={20} color={colors.accent} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    label: { ...typography.display, color: colors.textPrimary, marginBottom: spacing.lg },
    suggestionCard: {
      padding: spacing.md,
      borderRadius: radius.card,
      backgroundColor: 'rgba(232,134,44,0.10)',
      borderWidth: 1,
      borderColor: 'rgba(232,134,44,0.30)',
      marginBottom: spacing.md,
    },
    suggestionCaption: { ...typography.label, fontWeight: '600', color: colors.accentText, marginBottom: spacing.xs },
    suggestionValue: { ...typography.heading, color: colors.textPrimary },
    overrideCaption: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.sm },
    option: {
      minHeight: spacing.touchTarget + spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      borderRadius: radius.input,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      marginBottom: spacing.sm + spacing.xs,
    },
    optionSelected: { borderColor: colors.accent, backgroundColor: 'rgba(232,134,44,0.06)' },
    optionText: { ...typography.body, color: colors.textPrimary },
    optionTextSelected: { fontWeight: '600' },
  });
}
