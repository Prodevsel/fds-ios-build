import { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import {
  validateContactValue,
  type ContactBlock as ContactBlockDef,
} from '@frontdoorsales/flow-schema';
import { radius, spacing, typography } from '../../../design/tokens';
import { t } from '../../../i18n';
import { Button } from '../../../ui/Button';
import { useThemeColors } from '../../settings/theme/useThemeColors';

export interface ContactBlockProps {
  block: ContactBlockDef;
  value: string | undefined;
  onAnswer: (fieldId: string, value: string) => void | Promise<void>;
}

const KEYBOARD = {
  email: 'email-address',
  phone: 'phone-pad',
  name: 'default',
  company: 'default',
} as const;

type ContactField = ContactBlockDef['field'];

/**
 * True when `draft` is a value this block is allowed to commit.
 *
 * The gate is `=== 'ok'`, not `!== 'invalid'`: a required field with an empty
 * draft validates as 'empty', so a bare invalid-check would still let a rep
 * advance past a required contact field with no value at all — exactly the
 * "empty recipient reaches the dispatcher" failure this block must prevent.
 * For an optional field an empty draft already validates as 'ok'.
 */
export function canAdvanceContact(field: ContactField, draft: string, required: boolean): boolean {
  return validateContactValue(field, draft, required) === 'ok';
}

/**
 * True when the inline validation message should replace the help text.
 *
 * `touchedBlockId` is the id of the block the draft was typed INTO, not a bare
 * boolean, so the message is bound to a specific question. Both hosts render
 * one block per step from the same slot in the tree, and if a host ever fails
 * to give that slot a stable per-block identity, React reuses this component
 * across a step change and hands the next block the previous block's draft —
 * which is how a freshly presented `email` block came to render
 * "E-Mail ungueltig" for a name the rep had submitted to `customerName`
 * (DirectSignFlowScreen.tsx question area, FlowRunnerScreen.tsx blockArea).
 * The hosts now key that slot; this comparison is what makes the block itself
 * incapable of scolding someone for an answer they never gave here.
 */
export function shouldShowContactError(
  field: ContactField,
  draft: string,
  required: boolean,
  touchedBlockId: string | null,
  blockId: string,
): boolean {
  return (
    touchedBlockId === blockId &&
    draft.trim().length > 0 &&
    validateContactValue(field, draft, required) === 'invalid'
  );
}

/**
 * Free-text capture for one contact detail.
 *
 * The typed value is held in local draft state and handed to `onAnswer` only
 * when the rep taps the block's own "Weiter" CTA. Both hosts read `onAnswer`
 * as "this answer is final, advance one step" (FlowRunnerScreen `handleAnswer`
 * -> `answerAndAdvance`, DirectSignFlowScreen `handleQuestionAnswer` ->
 * `advanceStep`), so the earlier per-keystroke call did two damaging things at
 * once: it skipped the flow forward after the first letter, and it persisted
 * that one-character prefix as the contract's recipient — which
 * `webhook-dispatcher`'s `extractRecipient()` then tried to mail. There is no
 * shell footer to lose the value to (see FlowRunnerScreen.tsx:975: every block
 * owns its own CTA), so draft-then-commit is both safe and the sibling
 * convention already used by TextBlock.
 *
 * The validation message appears only once something has been typed — telling
 * someone their empty field is invalid before they have touched it is noise.
 */
export function ContactBlock({ block, value, onAnswer }: ContactBlockProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [touchedBlockId, setTouchedBlockId] = useState<string | null>(null);
  const [draft, setDraft] = useState(value ?? '');
  const showError = shouldShowContactError(
    block.field,
    draft,
    block.required,
    touchedBlockId,
    block.id,
  );

  return (
    <View>
      <Text style={styles.label}>{block.label}</Text>
      <TextInput
        style={[styles.input, showError ? styles.inputError : null]}
        value={draft}
        onChangeText={(next) => {
          setTouchedBlockId(block.id);
          setDraft(next);
        }}
        placeholder={block.placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={KEYBOARD[block.field]}
        autoCapitalize={block.field === 'name' || block.field === 'company' ? 'words' : 'none'}
        autoCorrect={false}
        accessibilityLabel={block.label}
        testID={`contact-block-${block.id}`}
      />
      {showError ? (
        <Text style={styles.error}>{t(`contact.invalid.${block.field}`)}</Text>
      ) : block.helpText ? (
        <Text style={styles.help}>{block.helpText}</Text>
      ) : null}
      <View style={styles.cta}>
        <Button
          title={t('flowRunner.next')}
          onPress={() => void onAnswer(block.id, draft)}
          disabled={!canAdvanceContact(block.field, draft, block.required)}
          testID={`contact-block-next-${block.id}`}
        />
      </View>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    label: { ...typography.heading, color: colors.textPrimary, marginBottom: spacing.md },
    input: {
      minHeight: spacing.touchTarget + spacing.sm,
      backgroundColor: colors.surface,
      borderWidth: 1.5,
      borderColor: colors.borderStrong,
      borderRadius: radius.input,
      paddingHorizontal: spacing.md,
      ...typography.body,
      color: colors.textPrimary,
    },
    inputError: { borderColor: colors.destructive },
    error: { ...typography.label, color: colors.destructiveText, marginTop: spacing.xs },
    help: { ...typography.label, color: colors.textSecondary, marginTop: spacing.xs },
    cta: { marginTop: spacing.lg },
  });
}
