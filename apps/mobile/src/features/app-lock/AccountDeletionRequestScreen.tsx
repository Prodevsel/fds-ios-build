import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { radius, spacing, typography } from '../../design/tokens';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { t } from '../../i18n';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { createDeletionRequestRepo, type DeletionRequestOutcome, type DeletionRequestRepo } from './db/deletionRequestRepo';

/**
 * AccountDeletionRequestScreen — SEC-09. Closes the phase's one screen whose
 * VISUAL ANCHOR IS A SENTENCE, not a button (15-UI-SPEC.md "Visual Anchor by
 * Screen"): the retention-notice sentence is the load-bearing content here,
 * the CTA is secondary.
 *
 * This screen is NOT a delete button. The account is org-managed — a
 * deletion can only be initiated by the organization — and this screen
 * files a REQUEST that informs it. Signed contracts are retained under
 * § 257 HGB / § 147 AO regardless of this request and are NOT deleted; a
 * rep who reads this screen and believes their signed contracts vanish has
 * been misled about a legal fact, so the retention sentence renders as an
 * unskippable, untruncatable emphasis run (a truncation prop is never used) rather
 * than a small print footnote.
 *
 * The CTA reads "Anfrage senden" ("Send request") — never the delete-account
 * phrase that titles this screen's heading — the button sends a request, it
 * does not delete anything itself.
 * Confirmation is the LIGHTER inline tier (`SessionsScreen.tsx`'s
 * non-current-session confirm bar), not the heavier modal, because filing a
 * request is not itself a destructive action.
 *
 * Follows `ChangePasswordScreen.tsx`'s header shell (back chevron + title)
 * and DI'd pure-orchestration split (`performPasswordChange`'s pattern) so
 * the submit/outcome branching is unit-testable without a renderer (this
 * repo has no react-native-testing-library).
 */

/** Pure: splits `sec.deletionRequestBody` into the non-emphasized intro and
 * the retention-guarantee sentence (identified by the presence of the
 * `§ 257 HGB` anchor, locale-agnostic) — the latter renders as the
 * `fontWeight: '600'`/`colors.destructive`-toned emphasis run that is this
 * screen's visual anchor. Falls back to treating the WHOLE body as intro
 * (no emphasis run) if the anchor is ever absent from the copy, rather than
 * throwing — a missing legal sentence must never crash the screen, though
 * that case should never occur given the shipped `de.json`/`en.json`. */
export function splitDeletionRequestBody(body: string): { intro: string; retention: string } {
  const sentences = body.split(/(?<=\.) /);
  const retentionIndex = sentences.findIndex((sentence) => sentence.includes('§ 257 HGB'));
  if (retentionIndex === -1) {
    return { intro: body, retention: '' };
  }
  const intro = sentences.slice(0, retentionIndex).join(' ');
  const retention = sentences.slice(retentionIndex).join(' ');
  return { intro, retention };
}

/** Screen-local confirm/outcome state machine. */
export type DeletionRequestScreenState =
  | { kind: 'idle' }
  | { kind: 'confirming' }
  | { kind: 'submitting' }
  | { kind: 'outcome'; outcome: DeletionRequestOutcome };

/**
 * Pure/DI'd core (mirrors `performPasswordChange`): calls `repo.submit(null)`
 * exactly once and returns the classified outcome. This screen never
 * collects a free-text note field (out of this plan's scope) — `null` is
 * the only value ever passed.
 */
export async function submitDeletionRequest(
  repo: Pick<DeletionRequestRepo, 'submit'>,
): Promise<DeletionRequestOutcome> {
  return repo.submit(null);
}

/** `TranslationKey`-shaped outcome copy keys — narrowed to the exact three
 * keys this function can ever return, so a caller cannot accidentally pass
 * an unrelated key through the same code path. */
export type DeletionRequestOutcomeCopyKey =
  | 'sec.deletionRequestSent'
  | 'sec.deletionRequestAlreadyPending'
  | 'sec.deletionRequestErrorGeneric';

/**
 * Pure: maps a resolved `DeletionRequestOutcome` to the copy key the screen
 * renders — kept separate from JSX so it is directly unit-testable without a
 * renderer (this repo has no react-native-testing-library). `'recorded'`
 * is the ONLY outcome that ever maps to `sec.deletionRequestSent`
 * (T-15-13-04/T-15-13-05) — `'already_pending'` gets its own truthful copy,
 * never a second success message, and `'offline'`/`'error'` collapse to one
 * generic retry message (the repo layer keeps them distinguishable for
 * observability; the UI does not need two different retry sentences).
 */
export function deriveOutcomeCopyKey(outcome: DeletionRequestOutcome | null): DeletionRequestOutcomeCopyKey | null {
  switch (outcome) {
    case 'recorded':
      return 'sec.deletionRequestSent';
    case 'already_pending':
      return 'sec.deletionRequestAlreadyPending';
    case 'offline':
    case 'error':
      return 'sec.deletionRequestErrorGeneric';
    default:
      return null;
  }
}

export function AccountDeletionRequestScreen() {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation();
  const repo = useMemo<DeletionRequestRepo>(() => createDeletionRequestRepo(), []);

  const [state, setState] = useState<DeletionRequestScreenState>({ kind: 'idle' });

  const { intro, retention } = useMemo(() => splitDeletionRequestBody(t('sec.deletionRequestBody')), []);

  const handlePressCta = () => setState({ kind: 'confirming' });
  const handleCancelConfirm = () => setState({ kind: 'idle' });

  const handleConfirm = async () => {
    setState({ kind: 'submitting' });
    const outcome = await submitDeletionRequest(repo);
    setState({ kind: 'outcome', outcome });
  };

  const outcome = state.kind === 'outcome' ? state.outcome : null;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Pressable
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            onPress={() => navigation.goBack()}
            hitSlop={8}
          >
            <MaterialCommunityIcons name="chevron-left" size={26} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.title}>{t('sec.deletionRequestTitle')}</Text>
        </View>

        <Card>
          {/* The retention sentence is this screen's visual anchor (15-UI-SPEC.md
              "Visual Anchor by Screen") — a legal fact stated plainly, not a
              destructive-red warning about the rep's own action, and never
              truncated — this screen never limits a Text element's line count). */}
          <Text style={styles.body}>
            <Text>{intro} </Text>
            <Text style={styles.retentionEmphasis}>{retention}</Text>
          </Text>
        </Card>

        {outcome === 'already_pending' ? (
          <Text style={styles.infoText}>{t(deriveOutcomeCopyKey(outcome) as DeletionRequestOutcomeCopyKey)}</Text>
        ) : null}
        {outcome === 'offline' || outcome === 'error' ? (
          <Text style={styles.errorText}>{t(deriveOutcomeCopyKey(outcome) as DeletionRequestOutcomeCopyKey)}</Text>
        ) : null}

        {outcome === 'recorded' ? (
          <Text style={styles.sentText}>{t(deriveOutcomeCopyKey(outcome) as DeletionRequestOutcomeCopyKey)}</Text>
        ) : state.kind === 'confirming' ? (
          // Lighter inline confirm tier (SessionsScreen.tsx's non-current-
          // session bar) — this is a request, not itself destructive, so it
          // never uses the heavier dialog tier `SessionsScreen.tsx` reserves
          // for the caller's own current session.
          <View style={styles.inlineConfirmBar}>
            <Text style={styles.inlineConfirmText}>{t('sec.deletionRequestConfirmInline')}</Text>
            <View style={styles.inlineConfirmActions}>
              <Pressable
                style={styles.inlineCancelButton}
                accessibilityRole="button"
                onPress={handleCancelConfirm}
              >
                <Text style={styles.inlineCancelText}>{t('cta.cancel')}</Text>
              </Pressable>
              <Pressable
                style={styles.inlineConfirmButton}
                accessibilityRole="button"
                onPress={() => void handleConfirm()}
              >
                <Text style={styles.inlineConfirmButtonText}>{t('sec.deletionRequestCta')}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Button
            title={t('sec.deletionRequestCta')}
            onPress={handlePressCta}
            loading={state.kind === 'submitting'}
            disabled={state.kind === 'submitting'}
          />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.background },
    content: { flexGrow: 1, paddingHorizontal: spacing.xl, gap: spacing.md },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginBottom: spacing.lg,
    },
    backButton: {
      width: spacing.touchTarget,
      height: spacing.touchTarget,
      borderRadius: radius.input,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: { ...typography.display, color: colors.textPrimary, flexShrink: 1 },
    body: { ...typography.body, color: colors.textPrimary, lineHeight: 22 },
    retentionEmphasis: { ...typography.body, fontWeight: '600', color: colors.destructiveText, lineHeight: 22 },
    infoText: { ...typography.label, color: colors.textSecondary },
    errorText: { ...typography.label, color: colors.destructive },
    sentText: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
    inlineConfirmBar: {
      borderWidth: 1.5,
      borderColor: colors.destructive,
      borderRadius: radius.input,
      padding: spacing.sm + spacing.xs,
      gap: spacing.sm,
    },
    inlineConfirmText: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
    inlineConfirmActions: { flexDirection: 'row', gap: spacing.sm },
    inlineCancelButton: {
      flex: 1,
      minHeight: spacing.touchTarget,
      borderRadius: radius.input,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    inlineCancelText: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
    inlineConfirmButton: {
      flex: 1,
      minHeight: spacing.touchTarget,
      borderRadius: radius.input,
      backgroundColor: colors.destructive,
      alignItems: 'center',
      justifyContent: 'center',
    },
    inlineConfirmButtonText: { ...typography.body, fontWeight: '600', color: colors.onAccent },
  });
}
