import { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextBlock as TextBlockDef } from '@frontdoorsales/flow-schema';
import { radius, spacing, typography } from '../../../design/tokens';
import { useThemeColors } from '../../settings/theme/useThemeColors';
import { t } from '../../../i18n';
import { Button } from '../../../ui/Button';

export interface TextBlockProps {
  block: TextBlockDef;
  value: string | undefined;
  onAnswer: (fieldId: string, value: string) => void | Promise<void>;
}

/**
 * D-01 large-touch-target block renderer. `multiline` presence in the block
 * def signals a real text-entry field (e.g. free-text notes); its absence
 * (the intro/welcome blocks) means a pure info screen — draft is just the
 * empty string, answered by tapping Next.
 */
export function TextBlock({ block, value, onAnswer }: TextBlockProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [draft, setDraft] = useState(value ?? '');
  const requiresInput = block.multiline !== undefined;

  return (
    <View>
      <Text style={styles.label}>{block.label}</Text>
      {requiresInput ? (
        <TextInput
          style={styles.input}
          value={draft}
          multiline={block.multiline}
          onChangeText={setDraft}
          placeholderTextColor={colors.textMuted}
          testID={`text-input-${block.id}`}
        />
      ) : null}
      <Button title={t('flowRunner.next')} onPress={() => void onAnswer(block.id, draft)} />
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    label: { ...typography.display, color: colors.textPrimary, marginBottom: spacing.lg },
    input: {
      minHeight: spacing.touchTarget + spacing.sm,
      borderWidth: 1.5,
      borderColor: colors.borderStrong,
      borderRadius: radius.input,
      padding: spacing.md,
      marginBottom: spacing.lg,
      backgroundColor: colors.surface,
      ...typography.body,
      color: colors.textPrimary,
    },
  });
}
