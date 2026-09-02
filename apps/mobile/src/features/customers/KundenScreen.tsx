import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AbstractPowerSyncDatabase } from '@powersync/common';
import { buildCustomers, searchCustomers, type Customer } from './customerSearch';
import {
  countOpenOffers,
  matchesKundenFilter,
  offerState,
  type KundenFilter,
} from './customerOffers';
import { formatEur } from '../wallet/formatEur';
import { t } from '../../i18n';
import { radius, spacing, typography } from '../../design/tokens';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { TextField } from '../../ui/TextField';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { EmptyState } from '../../components/EmptyState';

/**
 * "Meine Kunden" — the screen `customerSearch.ts` was written for and never got.
 *
 * The projection had 26 passing tests and zero call sites: a customer list is
 * derived from the contracts and leads ALREADY on the device, so this screen
 * introduces no new personal data, no new sync stream and no new table. It only
 * looks at rows the rep can already see, from a second angle — by person
 * instead of by deal.
 *
 * Two raw SELECTs rather than the repos: `buildCustomers` takes the SQLite rows
 * as they are (snake_case, every field `unknown`) and does the parsing itself,
 * which is exactly why it is testable without a database. Wrapping the rows in
 * a repo's shaped type first would mean converting them twice and dropping the
 * columns this projection needs.
 *
 * Deletion discipline is the projection's, not this screen's: an anonymised
 * lead (0045) produces no customer at all, so nothing here has to filter.
 */
export interface KundenScreenProps {
  db: AbstractPowerSyncDatabase;
  /** Header chevron — the tab root has no parent to pop, so the caller decides. */
  onClose: () => void;
  /** Injected in tests so an assertion can name a fixed instant. */
  now?: () => Date;
}

export function KundenScreen({ db, onClose, now }: KundenScreenProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState('');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<KundenFilter>('all');
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // A tab root with `headerShown: false` owns its own status-bar inset — same
  // reasoning as ContractListScreen, and applied at the call site because
  // makeStyles is memoised per theme and would not re-derive on rotation.
  const insets = useSafeAreaInsets();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      // `watch` rather than a one-shot read: a deal signed while this screen is
      // open must show up, the same way the contract list updates itself.
      const [contracts, leads] = await Promise.all([
        db.getAll('SELECT * FROM contracts'),
        db.getAll('SELECT * FROM leads'),
      ]);
      if (cancelled) return;
      setCustomers(buildCustomers(contracts, leads));
    };
    void load();
    const unsubscribe = db.registerListener({ statusChanged: () => void load() });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [db]);

  const nowIso = (now ?? (() => new Date()))().toISOString();
  const visible = useMemo(
    () => searchCustomers(customers, query).filter((c) => matchesKundenFilter(c, filter, nowIso)),
    [customers, query, filter, nowIso],
  );
  const openOfferCount = useMemo(() => countOpenOffers(customers, nowIso), [customers, nowIso]);

  return (
    <View style={styles.container} testID="kunden-screen">
      <View style={[styles.header, { paddingTop: insets.top + spacing.lg }]}>
        <Pressable
          style={styles.closeButton}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={onClose}
        >
          <MaterialCommunityIcons name="chevron-left" size={26} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>{t('kunden.title')}</Text>
          {customers.length > 0 ? (
            <Text style={styles.headerSubtitle}>
              {(customers.length === 1 ? t('kunden.subtitleSingular') : t('kunden.subtitlePlural'))
                .replace('{count}', String(customers.length))}
            </Text>
          ) : null}
        </View>
      </View>

      {customers.length === 0 ? (
        <EmptyState
          testID="kunden-empty-state"
          icon="account-multiple-outline"
          title={t('kunden.emptyHeading')}
          description={t('kunden.emptyBody')}
        />
      ) : (
        <>
          <View style={styles.searchRow}>
            <TextField
              label={t('kunden.searchLabel')}
              value={query}
              onChangeText={setQuery}
              placeholder={t('kunden.searchPlaceholder')}
              autoCapitalize="none"
              accessibilityLabel={t('kunden.searchLabel')}
            />
          </View>
          <View style={styles.searchRow}>
            <SegmentedControl
              options={[
                { value: 'all', label: t('kunden.filterAll') },
                {
                  value: 'offers',
                  // The count is the point: a rep needs to know there ARE three
                  // people still deciding without opening the segment first.
                  label: openOfferCount > 0
                    ? `${t('kunden.filterOffers')} (${openOfferCount})`
                    : t('kunden.filterOffers'),
                },
                { value: 'customers', label: t('kunden.filterCustomers') },
              ]}
              value={filter}
              onChange={setFilter}
              accessibilityLabel={t('kunden.filterLabel')}
            />
          </View>
          {visible.length === 0 ? (
            <EmptyState
              testID="kunden-no-match"
              icon="account-search-outline"
              title={t('kunden.noMatchHeading')}
              description={t('kunden.noMatchBody')}
            />
          ) : (
            <FlatList
              data={visible}
              keyExtractor={(item) => item.key}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <CustomerRow
                  customer={item}
                  nowIso={nowIso}
                  expanded={expandedKey === item.key}
                  // Tapping the open row closes it: the deals are detail, and a
                  // list that can only ever grow is a list you scroll past.
                  onToggle={() => setExpandedKey((prev) => (prev === item.key ? null : item.key))}
                  styles={styles}
                  colors={colors}
                />
              )}
            />
          )}
        </>
      )}
    </View>
  );
}

function CustomerRow({
  customer,
  nowIso,
  expanded,
  onToggle,
  styles,
  colors,
}: {
  customer: Customer;
  nowIso: string;
  expanded: boolean;
  onToggle: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ReturnType<typeof useThemeColors>;
}) {
  // A lead-only customer has no deals to expand — it stays a plain row rather
  // than a control that does nothing when tapped.
  // Offers count as expandable content too: an offer IS the thing the rep came
  // to look up, and a lead-only person with an open offer used to be a row that
  // did nothing when tapped.
  const expandable = customer.contracts.length > 0 || customer.offers.length > 0;
  const contact = customer.email ?? customer.phone;
  const openOffers = customer.offers.filter((o) => offerState(o, nowIso) === 'open').length;
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole={expandable ? 'button' : undefined}
        onPress={expandable ? onToggle : undefined}
        style={styles.cardHeader}
        testID={`kunde-row-${customer.key}`}
      >
        <View style={styles.avatar}>
          <MaterialCommunityIcons name="account-outline" size={20} color={colors.textSecondary} />
        </View>
        <View style={styles.cardText}>
          <Text style={styles.name} numberOfLines={1}>
            {customer.displayName}
          </Text>
          {contact ? (
            <Text style={styles.contact} numberOfLines={1}>
              {contact}
            </Text>
          ) : null}
          <Text style={styles.meta}>
            {customer.contractCount === 0
              ? t('kunden.metaLeadOnly')
              : (customer.contractCount === 1 ? t('kunden.metaDealsSingular') : t('kunden.metaDealsPlural'))
                  .replace('{count}', String(customer.contractCount))}
            {openOffers > 0
              ? ` · ${(openOffers === 1 ? t('kunden.metaOffersSingular') : t('kunden.metaOffersPlural'))
                  .replace('{count}', String(openOffers))}`
              : ''}
          </Text>
        </View>
        {expandable ? (
          <MaterialCommunityIcons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={22}
            color={colors.textSecondary}
          />
        ) : null}
      </Pressable>

      {expanded
        ? customer.offers.map((offer) => {
            const state = offerState(offer, nowIso);
            return (
              <View key={`offer-${offer.code}`} style={styles.dealRow} testID={`kunde-offer-${offer.code}`}>
                <View style={styles.offerLeft}>
                  {/* The code IS the thing to read out or repeat on the phone,
                      so it gets the monospaced treatment and never truncates. */}
                  <Text style={styles.offerCode}>{offer.code}</Text>
                  {offer.expiresAtIso ? (
                    <Text style={styles.offerValid}>
                      {`${t('kunden.offerValidUntil')} ${formatDay(offer.expiresAtIso)}`}
                    </Text>
                  ) : null}
                </View>
                <Text
                  style={[
                    styles.offerState,
                    state === 'open' ? styles.offerOpen : null,
                    state === 'expired' ? styles.offerExpired : null,
                  ]}
                >
                  {state === 'redeemed'
                    ? t('kunden.offerRedeemed')
                    : state === 'expired'
                      ? t('kunden.offerExpired')
                      : t('kunden.offerOpen')}
                </Text>
              </View>
            );
          })
        : null}

      {expanded
        ? customer.contracts.map((contract, index) => (
            <View
              key={contract.id ?? `${customer.key}-${index}`}
              style={styles.dealRow}
              testID={`kunde-deal-${contract.id ?? index}`}
            >
              <Text style={styles.dealRef} numberOfLines={1}>
                {contract.dealReference ?? t('kunden.dealNoReference')}
              </Text>
              <Text style={styles.dealPrice}>
                {/* Never "0,00 €" for an uncaptured price — a direct_pdf deal
                    froze none, and printing zero under a signed contract is the
                    same lie the success screen was fixed for. */}
                {contract.priceEur === null
                  ? t('kunden.dealNoPrice')
                  : `${formatEur(contract.priceEur)} ${t('abschluesse.perMonth')}`}
              </Text>
            </View>
          ))
        : null}
    </View>
  );
}

/** `15.09.2026` from an ISO string; the raw value if it will not parse. */
function formatDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('de-DE');
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
    },
    closeButton: {
      width: spacing.touchTarget,
      height: spacing.touchTarget,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerText: { flex: 1 },
    headerTitle: { ...typography.display, color: colors.textPrimary },
    headerSubtitle: { ...typography.label, color: colors.textSecondary },
    searchRow: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
    listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.sm },
    card: {
      borderRadius: radius.input,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: 'hidden',
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
      minHeight: spacing.touchTarget,
    },
    avatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
    },
    cardText: { flex: 1, gap: 2 },
    name: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
    contact: { ...typography.label, color: colors.textSecondary },
    meta: { ...typography.label, color: colors.textSecondary },
    dealRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    dealRef: { ...typography.label, color: colors.textSecondary, flexShrink: 1 },
    offerLeft: { flexShrink: 1, gap: 2 },
    offerCode: { ...typography.label, fontWeight: '600', color: colors.textPrimary },
    offerValid: { ...typography.label, color: colors.textSecondary },
    offerState: { ...typography.label, fontWeight: '600', color: colors.textSecondary },
    offerOpen: { color: colors.accent },
    offerExpired: { color: colors.destructive },
    dealPrice: { ...typography.label, fontWeight: '600', color: colors.textPrimary },
  });
}
