import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ConsentBlock } from '@frontdoorsales/flow-schema';
import { radius, spacing, typography } from '../../design/tokens';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { t } from '../../i18n';
import {
  useEndAsLead,
  type EndAsLeadContact,
  type EndAsLeadDb,
} from './useEndAsLead';
import { generateOfferCode, offerExpiryIso, OFFER_VALIDITY_DAYS } from './offerCode';
import { isMailable } from './mailableEmail';

/**
 * D-17 end-consultation-as-lead outcome UI. Presents the curated consent block
 * (label + consentText + an explicit confirm control, mirroring BelehrungBlock)
 * and — only meaningfully actionable once consent is confirmed — captures the
 * contact/product-interest fields the block declares. Submitting writes a
 * single consent-gated `leads` row via useEndAsLead (plain INSERT, no lead
 * without consent — abandonment ≠ consent).
 *
 * German end-user copy comes exclusively from the i18n bundle (CLAUDE.md
 * Language Policy); the customer-facing consentText is authored content on the
 * block itself (SSOT flow-schema), not a hardcoded string.
 */
export interface EndAsLeadSheetProps {
  block: ConsentBlock;
  db: EndAsLeadDb;
  /** Ownership attribution for the leads row (MAND-01: no tenant-less lead). */
  companyId: string;
  repId: string;
  teamId: string;
  territoryId?: string | null;
  /** Pinned discount/terms version at capture time (leads.terms_version). */
  termsVersion?: number | null;
  /** The product/tariff the customer expressed interest in, if already known. */
  defaultProductInterest?: string | null;
  /**
   * D-5: contact details the customer ALREADY answered earlier in the flow
   * (the PDF path's `contact` blocks), so the e-mail is not asked twice. A
   * PREFILL, never a lock — every field below stays editable. Defaults to `{}`,
   * which is exactly the previous behaviour for call sites that pass nothing.
   */
  defaultContact?: EndAsLeadContact;
  /**
   * §5.2 — the terms actually discussed at the door, frozen onto the lead so
   * the mailed offer PDF shows the real numbers instead of re-deriving them
   * from live product rows weeks later. Omitted for a bare lead capture.
   */
  offerSnapshot?: Record<string, unknown> | null;
  /** Called with the new lead id after a successful consent-gated write. */
  onLeadCreated?: (leadId: string) => void;
  /** Dismisses the sheet from the post-save confirmation. */
  onClose?: () => void;
}

export function EndAsLeadSheet({
  block,
  db,
  companyId,
  repId,
  teamId,
  territoryId,
  termsVersion,
  defaultProductInterest,
  defaultContact = {},
  offerSnapshot = null,
  onLeadCreated,
  onClose,
}: EndAsLeadSheetProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { endAsLead, status } = useEndAsLead(db);
  const [confirmed, setConfirmed] = useState(false);
  const [contact, setContact] = useState<EndAsLeadContact>(defaultContact);
  const [productInterest, setProductInterest] = useState(defaultProductInterest ?? '');
  // §5.2: the code exists BEFORE the write, so what the rep reads out is
  // exactly what is persisted — and a retry after a failed insert reuses the
  // same code rather than inventing a second one for the same conversation.
  const offer = useMemo(
    () => ({
      code: generateOfferCode(Crypto.randomUUID()),
      expiresAtIso: offerExpiryIso(new Date()),
    }),
    [],
  );

  const fields = block.contactFields ?? ['name', 'phone', 'email'];
  const saving = status === 'saving';
  // No address, no offer mail: the code alone would be a promise the customer
  // has nothing to hold on to. The lead is still captured.
  //
  // `.includes('@')` used to be the whole check, and it let `s.@live.de`
  // through — a local part ending in a dot, which the mail server rejects with
  // 553 hours later, on a backoff ladder, where nobody sees it. The rep is told
  // HERE, at the door, while the customer is still standing there.
  const hasEmail = isMailable(contact.email);

  async function handleSubmit() {
    const leadId = await endAsLead({
      companyId,
      repId,
      teamId,
      territoryId: territoryId ?? null,
      consent: { confirmed },
      contact,
      productInterest: productInterest.trim() === '' ? null : productInterest.trim(),
      termsVersion: termsVersion ?? null,
      offerCode: offer.code,
      offerExpiresAtIso: offer.expiresAtIso,
      offerSnapshot,
    });
    if (leadId !== null) {
      onLeadCreated?.(leadId);
    }
  }

  // Terminal state: the rep reads the code out and the customer keeps the
  // mailed PDF. Shown instead of the form so nothing can be re-submitted.
  if (status === 'done') {
    const validUntil = new Date(offer.expiresAtIso).toLocaleDateString('de-DE');
    return (
      <View testID="offer-created">
        <Text style={styles.title}>{t('offer.createdTitle')}</Text>
        <Text style={styles.codeValue} selectable testID="offer-code">
          {offer.code}
        </Text>
        <Text style={styles.consentText}>
          {t('offer.validUntil').replace('{date}', validUntil)}
        </Text>
        <Text style={styles.consentText}>
          {hasEmail
            ? t('offer.sentTo').replace('{email}', contact.email ?? '')
            : t('offer.noEmailHint')}
        </Text>
        <Pressable
          style={styles.submitButton}
          accessibilityRole="button"
          onPress={() => onClose?.()}
          testID="offer-done"
        >
          <Text style={styles.submitButtonText}>{t('offer.doneCta')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.title}>{t('endAsLead.title')}</Text>
      <Text style={styles.label}>{block.label}</Text>
      <Text style={styles.consentText}>{block.consentText}</Text>

      <Pressable
        style={[styles.confirmCard, confirmed ? styles.confirmCardDone : null]}
        accessibilityRole="checkbox"
        accessibilityState={{ selected: confirmed, checked: confirmed }}
        onPress={() => setConfirmed(true)}
        testID={`consent-confirm-${block.id}`}
      >
        <View style={[styles.checkbox, confirmed ? styles.checkboxChecked : null]}>
          {confirmed ? <MaterialCommunityIcons name="check" size={17} color={colors.onAccent} /> : null}
        </View>
        <Text style={styles.confirmText}>
          {confirmed ? t('endAsLead.consentConfirmed') : t('endAsLead.confirmConsent')}
        </Text>
      </Pressable>

      {fields.includes('name') ? (
        <TextInput
          style={styles.input}
          placeholder={t('endAsLead.contactNameLabel')}
          value={contact.name ?? ''}
          onChangeText={(name) => setContact((c) => ({ ...c, name }))}
          testID="lead-contact-name"
        />
      ) : null}
      {fields.includes('phone') ? (
        <TextInput
          style={styles.input}
          placeholder={t('endAsLead.contactPhoneLabel')}
          keyboardType="phone-pad"
          value={contact.phone ?? ''}
          onChangeText={(phone) => setContact((c) => ({ ...c, phone }))}
          testID="lead-contact-phone"
        />
      ) : null}
      {fields.includes('email') ? (
        <TextInput
          style={styles.input}
          placeholder={t('endAsLead.contactEmailLabel')}
          keyboardType="email-address"
          autoCapitalize="none"
          value={contact.email ?? ''}
          onChangeText={(email) => setContact((c) => ({ ...c, email }))}
          testID="lead-contact-email"
        />
      ) : null}
      <TextInput
        style={styles.input}
        placeholder={t('endAsLead.productInterestLabel')}
        value={productInterest}
        onChangeText={setProductInterest}
        testID="lead-product-interest"
      />

      <Text style={styles.hint}>
        {t('offer.formHint').replace('{days}', String(OFFER_VALIDITY_DAYS))}
      </Text>
      {!confirmed ? (
        <Text style={styles.hint}>{t('endAsLead.consentRequiredHint')}</Text>
      ) : null}
      {status === 'error' ? <Text style={styles.error}>{t('endAsLead.saveError')}</Text> : null}

      <Pressable
        style={[styles.submitButton, !confirmed || saving ? styles.submitButtonDisabled : null]}
        accessibilityRole="button"
        accessibilityState={{ disabled: !confirmed || saving }}
        disabled={!confirmed || saving}
        onPress={() => void handleSubmit()}
        testID="lead-submit"
      >
        <Text style={styles.submitButtonText}>
          {saving ? t('endAsLead.saving') : t('offer.submitCta')}
        </Text>
      </Pressable>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    title: { ...typography.display, color: colors.textPrimary, marginBottom: spacing.md },
    label: { ...typography.heading, color: colors.textPrimary, marginBottom: spacing.sm },
    consentText: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.lg, lineHeight: 22 },
    input: {
      minHeight: spacing.touchTarget + spacing.sm,
      borderWidth: 1.5,
      borderColor: colors.borderStrong,
      borderRadius: radius.input,
      padding: spacing.md,
      marginBottom: spacing.md,
      backgroundColor: colors.surface,
      fontSize: 16,
      color: colors.textPrimary,
    },
    confirmCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm + spacing.xs,
      backgroundColor: colors.surface,
      borderWidth: 2,
      borderColor: colors.ink,
      borderRadius: radius.input,
      padding: spacing.md - 1,
      marginBottom: spacing.lg,
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
    confirmText: { ...typography.label, fontWeight: '600', color: colors.textPrimary, flex: 1 },
    hint: { ...typography.label, color: colors.textMuted, marginBottom: spacing.md },
    codeValue: {
      fontSize: 32,
      fontWeight: '700',
      letterSpacing: 2,
      textAlign: 'center',
      color: colors.textPrimary,
      marginBottom: spacing.md,
    },
    error: { ...typography.label, color: colors.brick, marginBottom: spacing.md },
    submitButton: {
      minHeight: 56,
      backgroundColor: colors.accent,
      borderRadius: radius.button,
      alignItems: 'center',
      justifyContent: 'center',
    },
    submitButtonDisabled: { opacity: 0.5 },
    submitButtonText: { fontSize: 18, fontWeight: '600', color: colors.onAccent },
  });
}
