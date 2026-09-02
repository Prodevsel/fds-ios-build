import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { lightColors, radius, spacing, typography } from '../../design/tokens';
import { t } from '../../i18n';
import { MonoChip } from '../../ui/MonoChip';
import { FdsLogo } from '../auth/FdsLogo';
import { useSessionIdentity } from './useSessionIdentity';

/**
 * Berater-Ausweis (D2D commercial-agent ID card, design SSOT screen 14) — the
 * dark card the rep shows the customer at the door ("Bitte prüfen Sie meine
 * Angaben"). Built 1:1: FDS mark + title, the white identity card (photo
 * placeholder + name + employer + Berater-ID/VPKN/Gültig bis), the Haustürkodex
 * ≥70y call-back note, the Prüf-Hotline row, and the "Schließen" button.
 *
 * Only the rep's NAME is real (Supabase session). The employer, Berater-ID,
 * VPKN, Gültig-bis and hotline number have NO backing column anywhere in the
 * schema yet, so they render as honest "noch nicht hinterlegt" placeholders —
 * never invented (CLAUDE.md: no faked data). GAP: needs an app_users identity
 * extension (Berater-ID/VPKN/valid-until) + a company Prüf-Hotline config.
 *
 * THEME NOTE (plan 12-09): deliberately NOT migrated to `useThemeColors()`.
 * This screen is a physical-ID-badge metaphor — an always-dark Ink-Navy card
 * the rep hands to the customer — not a themed app surface. `tokens.ts`'s
 * `ink`/`paper` roles INVERT between light and dark palettes (ink is
 * near-white in dark mode), so resolving through the hook would flip this
 * badge to a light card with mismatched translucent-white overlays. Colors
 * here are pinned to `lightColors` (a semantic token import, never a raw hex)
 * so the badge always renders identically, regardless of the app theme.
 * Per plan 12-09's guidance this intentionally does NOT use the
 * `forceLightTheme` wrapper either — that escape hatch is reserved for the
 * SET-05 capture surfaces (12-11), not for a static design choice like this.
 */
export function BeraterAusweisScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const identity = useSessionIdentity();
  const displayName = identity.fullName ?? identity.email ?? '';
  const missing = t('beraterAusweis.notAvailable');

  return (
    <View style={styles.container} testID="berater-ausweis-screen">
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.lg },
        ]}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <FdsLogo palette={lightColors} size={36} />
            <View>
              <Text style={styles.headerTitle}>{t('beraterAusweis.title')}</Text>
              <Text style={styles.headerSubtitle}>{t('beraterAusweis.subtitle')}</Text>
            </View>
          </View>
          <Pressable
            style={styles.closeIcon}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            onPress={() => navigation.goBack()}
          >
            <MaterialCommunityIcons name="close" size={20} color={lightColors.onAccent} />
          </Pressable>
        </View>

        {/* Identity card */}
        <View style={styles.idCard}>
          <View style={styles.photo}>
            <Text style={styles.photoLabel}>{t('beraterAusweis.photoPlaceholder')}</Text>
          </View>
          <View style={styles.idFields}>
            <Text style={styles.idName} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={styles.idEmployer}>{missing}</Text>
            <IdField label={t('beraterAusweis.beraterIdLabel')} value={missing} mono />
            <IdField label={t('beraterAusweis.vpknLabel')} value={missing} mono />
            <IdField label={t('beraterAusweis.validUntilLabel')} value={missing} />
          </View>
        </View>

        {/* Haustürkodex note */}
        <View style={styles.noteCard}>
          <MaterialCommunityIcons name="shield-lock-outline" size={18} color={lightColors.accentOnDark} style={styles.noteIcon} />
          <Text style={styles.noteText}>{t('beraterAusweis.kodexNote')}</Text>
        </View>

        {/* Prüf-Hotline */}
        <View style={styles.noteCard}>
          <MaterialCommunityIcons name="phone-outline" size={18} color={lightColors.accentOnDark} style={styles.noteIcon} />
          <Text style={styles.noteText}>
            <Text style={styles.noteStrong}>{t('beraterAusweis.hotlineLabel')}</Text>
            {` · ${t('beraterAusweis.hotlineUnavailable')}`}
          </Text>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable
          style={styles.closeButton}
          accessibilityRole="button"
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.closeButtonText}>{t('beraterAusweis.closeCta')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function IdField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.idFieldRow}>
      <Text style={styles.idFieldLabel}>{label}</Text>
      {mono ? (
        <MonoChip palette={lightColors} bare style={styles.idFieldValueMono}>
          {value}
        </MonoChip>
      ) : (
        <Text style={styles.idFieldValue}>{value}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: lightColors.ink },
  content: { paddingHorizontal: spacing.md + spacing.xs },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md - 4, flex: 1, minWidth: 0 },
  headerTitle: { ...typography.heading, color: lightColors.onAccent },
  headerSubtitle: { ...typography.label, color: 'rgba(255,255,255,0.6)', marginTop: 1 },
  closeIcon: {
    width: spacing.touchTarget,
    height: spacing.touchTarget,
    borderRadius: radius.input,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  idCard: {
    flexDirection: 'row',
    gap: spacing.md + 2,
    backgroundColor: lightColors.surface,
    borderRadius: radius.card + 4,
    padding: spacing.md + 6,
    marginBottom: spacing.md,
  },
  photo: {
    width: 118,
    height: 150,
    borderRadius: radius.input,
    backgroundColor: lightColors.secondary,
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: spacing.sm + 2,
  },
  photoLabel: {
    ...typography.mono,
    color: lightColors.textSecondary,
    backgroundColor: 'rgba(255,255,255,0.78)',
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: spacing.xs - 1,
    borderRadius: radius.sm - 3,
  },
  idFields: { flex: 1, minWidth: 0 },
  idName: { ...typography.heading, color: lightColors.textPrimary },
  idEmployer: { ...typography.label, color: lightColors.textSecondary, marginTop: 1, marginBottom: spacing.sm + 2 },
  idFieldRow: { marginBottom: spacing.sm },
  idFieldLabel: { ...typography.label, color: lightColors.textSecondary },
  idFieldValue: { ...typography.body, fontWeight: '600', color: lightColors.textPrimary },
  idFieldValueMono: { fontSize: 14, color: lightColors.textPrimary },
  noteCard: {
    flexDirection: 'row',
    gap: spacing.md - 4,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: radius.card,
    padding: spacing.md,
    marginBottom: spacing.sm + 2,
  },
  noteIcon: { marginTop: 2 },
  noteText: { ...typography.label, lineHeight: 21, color: 'rgba(255,255,255,0.82)', flex: 1 },
  noteStrong: { color: lightColors.onAccent, fontWeight: '600' },
  footer: {
    paddingHorizontal: spacing.md + spacing.xs,
    paddingTop: spacing.md,
    backgroundColor: lightColors.ink,
  },
  closeButton: {
    minHeight: 56,
    borderRadius: radius.button,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: { ...typography.heading, fontSize: 16, color: lightColors.onAccent },
});
