import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { BelehrungBlock as BelehrungBlockDef } from '@frontdoorsales/flow-schema';
import { radius, spacing, typography } from '../../../design/tokens';
import { useThemeColors } from '../../settings/theme/useThemeColors';
import { t } from '../../../i18n';

export interface BelehrungBlockProps {
  block: BelehrungBlockDef;
  value: boolean | undefined;
  onAnswer: (fieldId: string, value: boolean) => void | Promise<void>;
}

/**
 * Widerrufsbelehrung (statutory withdrawal notice) block — design screen 07: a
 * "serious" mandatory gate. A subtle lock chip ("Pflichtschritt · vor der
 * Unterschrift") sits above the heading; the § notice text scrolls inside a
 * bordered card; below it a 2dp Ink-Navy confirm card with a checkbox is the
 * explicit acknowledgement, followed by the "Ohne Bestätigung …" gate note.
 * The confirm answer (`true`) IS the gate signal (D-03) that StepOverview's
 * forward-jump guard reads; Phase 4 (SIGN-01) enforces it as a hard signing
 * gate on top of the same signal.
 */
export function BelehrungBlock({ block, value, onAnswer }: BelehrungBlockProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const confirmed = value === true;

  return (
    <View style={styles.container}>
      {/* Design 07: subtle inline "Pflichtschritt" lock chip — an explainer
          around the legal gate, not a change to the gate itself. */}
      <View style={styles.lockChip}>
        <MaterialCommunityIcons name="lock-outline" size={15} color={colors.textPrimary} />
        <Text style={styles.lockChipText}>{t('hints.widerrufMandatoryStep')}</Text>
      </View>
      <Text style={styles.label}>{block.label}</Text>

      <ScrollView
        style={styles.noticeCard}
        contentContainerStyle={styles.noticeContent}
        showsVerticalScrollIndicator
      >
        {/* T-12-11-01: colors.noticeText is proven (contrast.test.ts) to clear
            AA/AAA against colors.surface in every (scheme, highContrast)
            combination — the statutory Widerrufsbelehrung must never be the
            least legible text on screen. */}
        <Text style={styles.noticeText}>{block.noticeText}</Text>
      </ScrollView>

      <Pressable
        style={[styles.confirmCard, confirmed ? styles.confirmCardDone : null]}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: confirmed }}
        onPress={() => void onAnswer(block.id, true)}
      >
        <View style={[styles.checkbox, confirmed ? styles.checkboxChecked : null]}>
          {confirmed ? <MaterialCommunityIcons name="check" size={17} color={colors.onAccent} /> : null}
        </View>
        <Text style={styles.confirmText}>
          {confirmed ? t('flowRunner.belehrungConfirmed') : t('flowRunner.belehrungConfirm')}
        </Text>
      </Pressable>

      <Text style={styles.blockedHint}>{t('checkout.belehrungBlockedHint')}</Text>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1 },
    lockChip: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.subtleFill,
      borderRadius: radius.sm + 2,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm + 5,
      marginBottom: spacing.md - 2,
    },
    lockChipText: { ...typography.label, fontWeight: '600', color: colors.textPrimary },
    label: { ...typography.display, color: colors.textPrimary, marginBottom: spacing.md + 2 },
    noticeCard: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.md + 2,
    },
    noticeContent: { padding: spacing.lg - 4 },
    noticeText: { ...typography.label, color: colors.noticeText, lineHeight: 22 },
    confirmCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm + spacing.xs,
      backgroundColor: colors.surface,
      borderWidth: 2,
      borderColor: colors.ink,
      borderRadius: radius.input,
      padding: spacing.md - 1,
    },
    confirmCardDone: { borderColor: colors.pine },
    checkbox: {
      width: 26,
      height: 26,
      borderRadius: radius.sm - 1,
      borderWidth: 2,
      borderColor: colors.ink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxChecked: { backgroundColor: colors.ink, borderColor: colors.ink },
    confirmText: { ...typography.label, fontWeight: '600', color: colors.textPrimary, flex: 1, lineHeight: 20 },
    blockedHint: {
      ...typography.label,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: spacing.md,
    },
  });
}
