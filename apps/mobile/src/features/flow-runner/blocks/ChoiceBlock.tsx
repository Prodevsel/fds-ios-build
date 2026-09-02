import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ChoiceBlock as ChoiceBlockDef } from '@frontdoorsales/flow-schema';
import { radius, spacing, typography } from '../../../design/tokens';
import { useThemeColors } from '../../settings/theme/useThemeColors';

export interface ChoiceBlockProps {
  block: ChoiceBlockDef;
  value: string | undefined;
  onAnswer: (fieldId: string, value: string) => void | Promise<void>;
}

/** D-01 large-touch-target option list — tapping an option answers AND advances immediately (no separate confirm step). */
export function ChoiceBlock({ block, value, onAnswer }: ChoiceBlockProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View>
      <Text style={styles.label}>{block.label}</Text>
      {block.options.map((option) => {
        const selected = value === option.value;
        // A plain option stays a plain row — one line, exactly as before. The
        // card only appears once the author gave it something to put on a card,
        // so no existing product changes shape.
        const isCard = Boolean(option.description ?? option.price ?? option.icon);
        return (
          <Pressable
            key={option.value}
            style={[
              styles.option,
              isCard ? styles.optionCard : null,
              selected ? styles.optionSelected : null,
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            // One label for the screen reader, so it hears the package the way
            // it is priced rather than three disconnected fragments.
            accessibilityLabel={[option.label, option.description, option.price]
              .filter(Boolean)
              .join(', ')}
            onPress={() => void onAnswer(block.id, option.value)}
          >
            {option.icon ? (
              <View style={[styles.iconWell, selected ? styles.iconWellSelected : null]}>
                <MaterialCommunityIcons
                  name={option.icon as React.ComponentProps<typeof MaterialCommunityIcons>['name']}
                  size={22}
                  color={selected ? colors.accent : colors.textSecondary}
                />
              </View>
            ) : null}
            <View style={styles.optionBody}>
              <Text style={[styles.optionText, selected ? styles.optionTextSelected : null]}>
                {option.label}
              </Text>
              {option.description ? (
                <Text style={styles.optionDescription}>{option.description}</Text>
              ) : null}
              {option.price ? (
                <View style={styles.priceRow}>
                  <Text style={[styles.price, selected ? styles.priceSelected : null]}>
                    {option.price}
                  </Text>
                  {option.priceComparison ? (
                    <Text style={styles.priceComparison}>{option.priceComparison}</Text>
                  ) : null}
                </View>
              ) : null}
            </View>
            {selected ? (
              <MaterialCommunityIcons name="check" size={20} color={colors.accent} />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    label: { ...typography.display, color: colors.textPrimary, marginBottom: spacing.lg },
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
      gap: spacing.sm,
    },
    /** Vertical breathing room a three-line card needs and a one-line row does not. */
    optionCard: { alignItems: 'flex-start', paddingVertical: spacing.md },
    optionSelected: { borderColor: colors.accent, backgroundColor: 'rgba(232,134,44,0.06)' },
    optionBody: { flex: 1, gap: spacing.xs / 2 },
    optionText: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
    optionTextSelected: { fontWeight: '700' },
    optionDescription: { ...typography.label, color: colors.textSecondary },
    priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs, marginTop: spacing.xs / 2 },
    price: { ...typography.body, fontWeight: '700', color: colors.textPrimary },
    priceSelected: { color: colors.accent },
    priceComparison: {
      ...typography.label,
      color: colors.textSecondary,
      textDecorationLine: 'line-through',
    },
    iconWell: {
      width: spacing.xl + spacing.xs,
      height: spacing.xl + spacing.xs,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.subtleFill,
    },
    iconWellSelected: { backgroundColor: 'rgba(232,134,44,0.12)' },
  });
}
