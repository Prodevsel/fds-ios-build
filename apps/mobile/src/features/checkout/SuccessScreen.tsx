import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Pdf from 'react-native-pdf';
import { t } from '../../i18n';
import { radius, spacing, statusColor, typography } from '../../design/tokens';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { MonoChip } from '../../ui/MonoChip';
import { formatEur } from '../wallet/formatEur';
import { netPriceNote } from '../../lib/format/netPriceNote';

/**
 * D-11/D-12: post-signing confirmation — FlowRunnerScreen's terminal state.
 * Skinned 1:1 to design SSOT screen 09 "Erfolg / Abschluss gesichert": a paper
 * screen with a centred green success ring + check, the Display headline
 * ("Abschluss gesichert"), the deal reference as a mono chip, the
 * "Adresse · Kunde · Produkt · 36,50€ mtl." summary line, an honest transfer-
 * status card ("Wird übertragen, sobald Netz da ist" while the CRUD upload
 * queue has not drained), the "PDF an Kunde: gesendet, sobald online" line, and
 * two stacked CTAs (primary amber "Nächstes Haus" -> onExit, optional secondary
 * "Meine Abschlüsse ansehen" -> onViewContracts).
 *
 * The success is "rewarding but honest about sync" — it never claims the
 * contract is uploaded (or the PDF delivered) while it is still queued locally.
 */
export interface SuccessScreenProps {
  dealReference: string;
  customerName: string;
  syncPending: boolean;
  /** D-16 summary strip: the product name (slug) frozen on the contract. */
  productName?: string;
  /** D-16/D-19 summary strip: the frozen monthly door price. */
  /**
   * `file://` uri of the SIGNED document, when the device rendered one.
   *
   * Shown so the rep can hold the finished contract up to the customer instead
   * of only asserting that it exists — the same reason the pre-signature
   * preview exists, at the other end of the flow. Absent for the wizard path
   * and whenever the device could not render.
   */
  documentUri?: string | null;
  /** Omit or pass null when no price was captured; NEVER 0 as a stand-in. */
  priceMonthly?: number | null;
  /** Optional street/address line — omitted when the flow captured no address. */
  addressLine?: string;
  onExit: () => void;
  onViewContracts?: () => void;
}

export function SuccessScreen({
  dealReference,
  customerName,
  syncPending,
  productName,
  priceMonthly,
  documentUri = null,
  addressLine,
  onExit,
  onViewContracts,
}: SuccessScreenProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // NO safe-area inset here, deliberately. This screen has exactly two mount
  // points — FlowRunnerScreen and DirectSignFlowScreen — and BOTH of them are
  // rendered inside StatusSheet's fullScreen Modal, whose wrapper already
  // applies `{ paddingTop: sheetInsets.top, paddingBottom: sheetInsets.bottom }`
  // (StatusSheet.tsx: "Applied here rather than in each screen: this is where
  // the full-bleed decision is made"). Adding the inset again here counted the
  // status bar twice, so the success ring floated roughly one status bar too
  // low on every notched device — a gap where the design puts chrome. The
  // inset belongs to whoever owns the full-bleed boundary, and that is not
  // this screen.
  // "Musterstraße 14 · Sabine Krüger · Strom 24 · 36,50€ mtl." — every part is
  // optional (honest: only the values the flow actually froze are shown).
  const summaryLine = [
    addressLine,
    customerName,
    productName,
    // H02/D-5: the note is produced HERE, from the price this screen already
    // receives — no new prop, because both callers (FlowRunnerScreen,
    // DirectSignFlowScreen) are owned by other work. Display only: nothing on
    // this screen or downstream of it computes VAT.
    // `undefined` OR `null` means the price was never captured — a direct_pdf
    // product carries no discount block (D-04) and its caller passes null. It
    // used to pass 0, which this line then printed as "0,00 € mtl.": a
    // sentinel leaking onto a customer-facing screen as the word FREE, right
    // under a signed contract. A price that was not captured gets no segment.
    priceMonthly !== undefined && priceMonthly !== null
      ? `${formatEur(priceMonthly)} ${t('abschluesse.perMonth')} ${netPriceNote()}`
      : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join('  ·  ');

  return (
    <View style={styles.container} testID="success-screen">
      <View style={styles.content}>
        <View style={styles.ring}>
          <View style={styles.ringInner}>
            <MaterialCommunityIcons name="check" size={46} color={colors.onAccent} />
          </View>
        </View>

        <Text style={styles.heading}>{t('checkout.successHeading')}</Text>
        <MonoChip style={styles.reference}>{dealReference}</MonoChip>
        {summaryLine ? <Text style={styles.summaryLine}>{summaryLine}</Text> : null}

        <Card style={styles.syncCard}>
          <View style={styles.syncRow} testID="success-sync-pill">
            <View
              style={[
                styles.syncIconTile,
                syncPending ? styles.syncIconTilePending : styles.syncIconTileSynced,
              ]}
            >
              <MaterialCommunityIcons
                name={syncPending ? 'sync' : 'check'}
                size={16}
                color={syncPending ? statusColor.follow_up : statusColor.success}
              />
            </View>
            <View style={styles.syncTextColumn}>
              <Text style={styles.syncTitle}>
                {t(syncPending ? 'checkout.successTransferHint' : 'checkout.successTransferDone')}
              </Text>
              {syncPending ? (
                <Text style={styles.syncBody}>{t('checkout.successTransferBody')}</Text>
              ) : null}
            </View>
          </View>
        </Card>

        {documentUri ? (
          <View style={styles.documentFrame} testID="success-document-preview">
            <Text style={styles.documentCaption}>{t('checkout.successDocumentCaption')}</Text>
            <Pdf
              source={{ uri: documentUri, cache: false }}
              style={styles.document}
              // One page, fitted, not scrollable: this is a confirmation the
              // customer glances at, not a reader. The full document reaches
              // them by mail, and the rep has it under "Abschluesse".
              singlePage
              fitPolicy={0}
              trustAllCerts={false}
            />
          </View>
        ) : null}

        <View style={styles.pdfPill}>
          <MaterialCommunityIcons name="send-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.pdfText}>{t('checkout.successPdfHint')}</Text>
        </View>
      </View>

      <View style={styles.ctaColumn}>
        <Button title={t('checkout.successPrimaryCta')} onPress={onExit} />
        {onViewContracts ? (
          <Button
            title={t('checkout.successSecondaryCta')}
            variant="secondary"
            onPress={onViewContracts}
            style={styles.secondaryCta}
          />
        ) : null}
      </View>
    </View>
  );
}

const RING_SIZE = 120;
const RING_INNER = 84;

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      justifyContent: 'space-between',
      padding: spacing.lg,
    },
    content: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    ring: {
      width: RING_SIZE,
      height: RING_SIZE,
      borderRadius: RING_SIZE / 2,
      backgroundColor: 'rgba(22,163,74,0.12)',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.lg + spacing.xs,
    },
    ringInner: {
      width: RING_INNER,
      height: RING_INNER,
      borderRadius: RING_INNER / 2,
      backgroundColor: statusColor.success,
      alignItems: 'center',
      justifyContent: 'center',
      // ponytail: glow removed (shadow tinted with the fill colour = halo).
      // Last one in the app, on the final screen of both paths.
      elevation: 6,
    },
    heading: {
      ...typography.display,
      color: colors.textPrimary,
      textAlign: 'center',
      marginBottom: spacing.sm,
    },
    reference: { textAlign: 'center' },
    summaryLine: {
      ...typography.body,
      color: colors.textSecondary,
      marginTop: spacing.md,
      textAlign: 'center',
      paddingHorizontal: spacing.md,
    },
    syncCard: { alignSelf: 'stretch', marginTop: spacing.lg },
    syncRow: { flexDirection: 'row', alignItems: 'flex-start' },
    syncIconTile: {
      width: 30,
      height: 30,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.sm + spacing.xs,
      marginTop: 1,
    },
    syncIconTilePending: { backgroundColor: 'rgba(217,119,6,0.14)' },
    syncIconTileSynced: { backgroundColor: 'rgba(22,163,74,0.12)' },
    syncTextColumn: { flex: 1 },
    syncTitle: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
    syncBody: { ...typography.label, color: colors.textSecondary, marginTop: 2, lineHeight: 18 },
    documentFrame: {
      alignSelf: 'stretch',
      marginTop: spacing.md,
      gap: spacing.xs,
    },
    documentCaption: { ...typography.label, color: colors.textSecondary },
    document: {
      // A fixed height rather than flex: this sits in a column with the CTA
      // below it, and a flexing PDF would push the button off a small screen.
      height: 220,
      alignSelf: 'stretch',
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    pdfPill: {
      flexDirection: 'row',
      // flex-start, not center: the copy wraps to two lines on a 390pt phone,
      // and centring a row whose content is taller than one line pushed the
      // glyph off the box's left edge.
      alignItems: 'flex-start',
      gap: spacing.sm,
      alignSelf: 'stretch',
      marginTop: spacing.md,
      paddingVertical: spacing.sm + 3,
      // There was NO horizontal padding here at all. Without it the row had no
      // inner margin to wrap against, so both the glyph and the text sat on
      // (and past) the rounded edge.
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.subtleFill,
    },
    // flex:1 is what actually makes the text wrap INSIDE the box instead of
    // widening the row past its parent.
    pdfText: { ...typography.label, color: colors.textSecondary, flex: 1 },
    ctaColumn: { marginTop: spacing.lg },
    secondaryCta: { marginTop: spacing.sm + spacing.xs },
  });
}
