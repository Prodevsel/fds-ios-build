import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { AbstractPowerSyncDatabase } from '@powersync/common';
import type { DiscountBlock as DiscountBlockDef } from '@frontdoorsales/flow-schema';
import { radius, spacing, typography } from '../../../design/tokens';
import { useThemeColors } from '../../settings/theme/useThemeColors';
import { t } from '../../../i18n';
import { Button } from '../../../ui/Button';
import { createDiscountTermsRepo, type DiscountTermsRepo, type DiscountTermsRow } from '../db/discountTermsRepo';
import { netPriceNote } from '../../../lib/format/netPriceNote';
import type { CompletionSnapshot } from '../db/flowDraftsRepo';

export interface DiscountBlockProps {
  db: AbstractPowerSyncDatabase;
  block: DiscountBlockDef;
  onAnswer: (fieldId: string, value: boolean) => void | Promise<void>;
  onSnapshotCaptured: (snapshot: CompletionSnapshot) => void;
}

/** Structural slice injectable for tests. */
export type DiscountBlockRepo = Pick<DiscountTermsRepo, 'getTermsById'>;

/**
 * D-19/Pitfall 4: computes the frozen snapshot from a terms row AT THE
 * MOMENT this is called (block render/confirm time) — the caller must never
 * call this again later and expect it to reflect a subsequently-changed
 * terms row. The discount amount is derived SOLELY from the terms entity's
 * door/comparison prices (T-03-16 — no separate ad-hoc recompute path).
 */
export function computeSnapshot(terms: DiscountTermsRow): CompletionSnapshot {
  const comparisonPrice = terms.comparison_price ?? null;
  const discountAmount = comparisonPrice !== null ? comparisonPrice - terms.door_price : null;
  return {
    doorPrice: terms.door_price,
    comparisonPrice,
    discountAmount,
    termsText: terms.terms_text,
    // Gap 2A (03-UAT.md): attribution to the exact terms version displayed,
    // frozen at the same moment as the rest of the snapshot (D-19).
    termsId: terms.id,
    termsVersion: terms.version,
  };
}

export interface ResolveAndFreezeSnapshotParams {
  repo: DiscountBlockRepo;
  termsRef: string;
}

/** Looks up terms by id and freezes the snapshot immediately (render/confirm time, D-19). */
export async function resolveAndFreezeSnapshot(
  params: ResolveAndFreezeSnapshotParams,
): Promise<{ terms: DiscountTermsRow; snapshot: CompletionSnapshot } | null> {
  const terms = await params.repo.getTermsById(params.termsRef);
  if (!terms) return null;
  return { terms, snapshot: computeSnapshot(terms) };
}

/**
 * The hero card's display projection (H02).
 *
 * A monthly price alone is NOT what the customer owes. Since 0090 the terms row
 * also carries the one-time setup position, the minimum term and a tenant price
 * note — and those have to be visible next to the monthly figure, not buried in
 * the terms paragraph where nothing can read them.
 *
 * Pure and exported because this repo tests logic, not rendered DOM: every rule
 * about what appears, in which order, and what is suppressed lives here and is
 * asserted directly. The JSX below renders this object and decides nothing.
 *
 * DELIBERATELY NOT part of the frozen snapshot: `computeSnapshot` and
 * `resolveAndFreezeSnapshot` are untouched (D-2). The setup fee and minimum
 * term reach a signed contract through the frozen `snapshot_terms_text` prose,
 * which already states both. Structured snapshot columns on `contracts` are a
 * deliberate follow-up, not an oversight — see the SUMMARY.
 *
 * Every field is null when its source is null, so the renderer never emits an
 * empty row and never stringifies a `null` into a Text node. `setup_fee: 0` is
 * a MEANINGFUL value ("we waive it") and survives — the checks are `!== null`,
 * never truthiness.
 */
export interface DiscountHeroDisplay {
  /** Struck-through online price, or null when there is nothing to compare to. */
  comparisonPrice: string | null;
  doorPrice: string;
  /** Tenant-authored `price_note` if present, else the platform net-price note. */
  netNote: string;
  savingsMonthly: string | null;
  savingsYearly: string | null;
  setupFeeLabel: string;
  setupFee: string | null;
  setupFeeComparison: string | null;
  minimumTerm: string | null;
  termsText: string;
}

export function computeHeroDisplay(
  terms: DiscountTermsRow,
  block: DiscountBlockDef,
): DiscountHeroDisplay {
  const showComparison = block.showComparisonPrice && terms.comparison_price !== null;
  // Display-only monthly saving (never re-freezes the snapshot, D-19): the
  // same comparison - door figure computeSnapshot froze, shown to the customer.
  const savings =
    terms.comparison_price !== null && terms.comparison_price > terms.door_price
      ? terms.comparison_price - terms.door_price
      : null;

  return {
    comparisonPrice: showComparison ? formatPrice(terms.comparison_price as number) : null,
    doorPrice: formatPrice(terms.door_price),
    // A tenant that authored its own wording wins over the platform default.
    netNote: terms.price_note ?? netPriceNote(),
    savingsMonthly: savings !== null ? formatPrice(savings) : null,
    savingsYearly: savings !== null ? formatPrice(savings * 12) : null,
    setupFeeLabel: t('price.setupFeeLabel'),
    setupFee: terms.setup_fee !== null ? formatPrice(terms.setup_fee) : null,
    // Only stage a struck-through regular price when there is a fee to stage it
    // against — a lone "999,00 EUR" struck through would state a price nobody pays.
    setupFeeComparison:
      terms.setup_fee !== null && terms.setup_fee_comparison !== null
        ? formatPrice(terms.setup_fee_comparison)
        : null,
    minimumTerm:
      terms.minimum_term_months !== null
        ? t('price.minimumTerm').replace('{months}', String(terms.minimum_term_months))
        : null,
    termsText: terms.terms_text,
  };
}

export function DiscountBlock({ db, block, onAnswer, onSnapshotCaptured }: DiscountBlockProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const repo = useMemo(() => createDiscountTermsRepo({ db }), [db]);
  const [terms, setTerms] = useState<DiscountTermsRow | null>(null);
  // The snapshot is frozen the moment terms first resolve (render time) — a
  // ref (not state) so a later re-render can never re-trigger the capture
  // and silently recompute it against a since-mutated terms row (Pitfall 4).
  const frozenRef = useRef<CompletionSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    void resolveAndFreezeSnapshot({ repo, termsRef: block.termsRef }).then((result) => {
      if (cancelled || !result) return;
      setTerms(result.terms);
      if (!frozenRef.current) {
        frozenRef.current = result.snapshot;
        onSnapshotCaptured(result.snapshot);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.termsRef]);

  if (!terms) {
    return (
      <View>
        <Text style={styles.label}>{block.label}</Text>
      </View>
    );
  }

  // Everything the card shows comes off this one pure projection (H02) — the
  // JSX below decides nothing about visibility or wording.
  const display = computeHeroDisplay(terms, block);

  return (
    <View>
      <Text style={styles.label}>{block.label}</Text>
      {/* Design screen 04: the dark "Tür-Preis" hero — Ink-Navy surface with a
          soft amber radial glow top-right, the amber "Gibt's nur hier"
          tag pill, then "Online-Preis" (struck) → amber arrow → the big
          "Ihr Tür-Preis" jumbo, and the amber savings line beneath. RN has no
          gradient without a library, so a solid navy fill + a radial-glow
          overlay approximate the mockup's gradient. */}
      <View style={styles.heroCard}>
        <View style={styles.glow} pointerEvents="none" />
        <View style={styles.badge}>
          <MaterialCommunityIcons name="tag" size={14} color={colors.accentOnDark} />
          <Text style={styles.badgeText}>{t('discount.doorExclusiveLabel')}</Text>
        </View>
        <View style={styles.priceRow}>
          {display.comparisonPrice !== null ? (
            <View style={styles.priceGroup}>
              <Text style={styles.priceCaption}>{t('discount.onlinePriceLabel')}</Text>
              <Text style={styles.comparisonPrice}>{display.comparisonPrice}</Text>
            </View>
          ) : null}
          {display.comparisonPrice !== null ? (
            <MaterialCommunityIcons name="arrow-right" size={22} color={colors.accentOnDark} style={styles.priceArrow} />
          ) : null}
          <View style={styles.priceGroup}>
            <Text style={styles.doorCaption}>{t('discount.doorPriceLabel')}</Text>
            <Text style={styles.doorPrice}>{display.doorPrice}</Text>
          </View>
        </View>
        {/* H02/D-5: the net-price note sits directly under the monthly price —
            the price and the fact that it is net are one statement, not two
            screens apart. DISPLAY ONLY; no VAT is computed anywhere. */}
        <Text style={styles.netNote}>{display.netNote}</Text>
        {/* Design screen 04: "mtl. · 6,40€ gespart jeden Monat · 153,60€ im
            Jahr" — computed purely from the already-frozen door/comparison
            prices (display only; never re-derives the frozen snapshot). */}
        {display.savingsMonthly !== null ? (
          <Text style={styles.savingsLine}>
            {t('flow.priceMonthlySuffix')} ·{' '}
            <Text style={styles.savingsAmount}>
              {t('discount.savingsAmount').replace('{monthly}', display.savingsMonthly)}
            </Text>{' '}
            {t('discount.savingsPer').replace('{yearly}', display.savingsYearly as string)}
          </Text>
        ) : null}
        {/* H02: the one-time setup position. Visually SUBORDINATE to the
            monthly door price — it is a real part of what the customer signs,
            but it must never compete with the number the whole card is about. */}
        {display.setupFee !== null ? (
          <Text style={styles.oneTimeLine}>
            {display.setupFeeLabel}:{' '}
            {display.setupFeeComparison !== null ? (
              <Text style={styles.oneTimeStruck}>{display.setupFeeComparison}</Text>
            ) : null}
            {display.setupFeeComparison !== null ? ' ' : null}
            <Text style={styles.oneTimeAmount}>{display.setupFee}</Text>
          </Text>
        ) : null}
        {display.minimumTerm !== null ? (
          <Text style={styles.oneTimeLine}>{display.minimumTerm}</Text>
        ) : null}
        <Text style={styles.termsText}>{display.termsText}</Text>
      </View>
      <Button title={t('flowRunner.next')} onPress={() => void onAnswer(block.id, true)} />
    </View>
  );
}

function formatPrice(value: number): string {
  return `${value.toFixed(2).replace('.', ',')} €`;
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    label: { ...typography.display, color: colors.textPrimary, marginBottom: spacing.lg },
    heroCard: {
      backgroundColor: colors.ink,
      borderRadius: radius.card,
      padding: spacing.lg - 2,
      marginBottom: spacing.lg,
      position: 'relative',
      overflow: 'hidden',
      shadowColor: colors.ink,
      shadowOpacity: 0.5,
      shadowRadius: 30,
      shadowOffset: { width: 0, height: 14 },
      elevation: 6,
    },
    // Soft amber "porch-light" glow bleeding from the top-right corner — the
    // solid-fill approximation of the mockup's radial-gradient highlight.
    // Fixed rgba (not theme-varying): the glow is always amber-over-ink,
    // matching the hero card's own fixed colors.ink background in both
    // themes (D-19: the discount hero is a branded "door price" card, not a
    // surface-following chrome element).
    glow: {
      position: 'absolute',
      top: -30,
      right: -20,
      width: 120,
      height: 120,
      borderRadius: 60,
      backgroundColor: 'rgba(232,134,44,0.16)',
    },
    badge: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs + 3,
      backgroundColor: 'rgba(232,134,44,0.18)',
      borderRadius: radius.pill,
      paddingVertical: spacing.xs + 2,
      paddingHorizontal: spacing.sm + spacing.xs,
      marginBottom: spacing.md + 2,
    },
    badgeText: { ...typography.label, fontWeight: '600', color: colors.accentOnDark },
    priceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm + 2, marginBottom: spacing.sm - 2 },
    priceGroup: { flexShrink: 1 },
    priceCaption: { ...typography.label, color: 'rgba(246,178,107,0.85)', marginBottom: 2 },
    doorCaption: { ...typography.label, fontWeight: '600', color: colors.accentOnDark, marginBottom: 2 },
    comparisonPrice: {
      fontSize: 24,
      lineHeight: 28,
      fontWeight: '600',
      color: 'rgba(255,255,255,0.55)',
      textDecorationLine: 'line-through',
      textDecorationColor: colors.accent,
    },
    priceArrow: { marginBottom: 4, alignSelf: 'flex-end' },
    doorPrice: { ...typography.priceJumbo, color: colors.onAccent },
    savingsLine: {
      ...typography.label,
      color: 'rgba(255,255,255,0.70)',
      marginTop: spacing.xs,
    },
    savingsAmount: { fontWeight: '700', color: colors.accentOnDark },
    // H02: the net note is a disclosure, not a headline — quiet, right under
    // the price it qualifies.
    netNote: { ...typography.label, color: 'rgba(255,255,255,0.60)', marginTop: 2 },
    // H02: the one-time fee and the minimum term. Same quiet register as the
    // savings line so the monthly door price stays the loudest thing on the card.
    oneTimeLine: { ...typography.label, color: 'rgba(255,255,255,0.70)', marginTop: spacing.xs },
    oneTimeStruck: {
      color: 'rgba(255,255,255,0.50)',
      textDecorationLine: 'line-through',
      textDecorationColor: colors.accent,
    },
    oneTimeAmount: { fontWeight: '700', color: colors.accentOnDark },
    termsText: { ...typography.label, color: 'rgba(255,255,255,0.70)', marginTop: spacing.sm },
  });
}
