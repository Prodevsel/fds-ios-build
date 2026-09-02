import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, spacing, statusColor, typography } from '../../design/tokens';
import { t } from '../../i18n';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { formatDistanceLabel, type HouseListRow } from './houseList';

/**
 * The house list — the SAME buildings the map renders, ordered nearest-first
 * by `deriveHouseListRows`. Purely presentational: it owns no data access, no
 * location call and no ordering rule of its own, so the list and the map can
 * never disagree about a building.
 *
 * It also issues no address lookup (D-2): `row.address` is the value the
 * StatusSheet already resolved and persisted, and a row without one says
 * "unknown" rather than borrowing the map's "wird ermittelt …" copy, which
 * would be a lie here — nothing is being resolved in the list.
 */
export interface HouseListViewProps {
  rows: HouseListRow[];
  /** False when no location fix could be taken — drives the D-3 hint line. */
  hasFix: boolean;
  onSelect: (houseId: string) => void;
}

export function HouseListView({ rows, hasFix, onSelect }: HouseListViewProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // This overlay owns the whole viewport over the map, so nothing above it
  // supplies the status-bar/home-indicator insets (ContractListScreen's
  // precedent). Applied at the call site, not baked into the memoized styles.
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container} testID="house-list-view">
      {!hasFix ? (
        <Text
          style={[styles.hint, { paddingTop: insets.top + spacing.lg }]}
          testID="house-list-no-location-hint"
        >
          {t('houseList.noLocationHint')}
        </Text>
      ) : null}

      {rows.length === 0 ? (
        <View style={[styles.emptyWrap, { paddingTop: insets.top + spacing.lg }]}>
          <Text style={styles.emptyText} testID="house-list-empty">
            {t('houseList.empty')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.houseId}
          contentContainerStyle={{
            paddingTop: hasFix ? insets.top + spacing.lg : spacing.sm,
            // Clears the floating map/list toggle in the bottom-right column.
            paddingBottom: insets.bottom + spacing['2xl'] * 2,
            paddingHorizontal: spacing.lg,
            gap: spacing.sm,
          }}
          renderItem={({ item }) => (
            <HouseListItem row={item} styles={styles} onSelect={onSelect} />
          )}
        />
      )}
    </View>
  );
}

function HouseListItem({
  row,
  styles,
  onSelect,
}: {
  row: HouseListRow;
  styles: ReturnType<typeof makeStyles>;
  onSelect: (houseId: string) => void;
}) {
  const addressLabel = row.address ?? t('houseList.addressUnknown');
  const distanceLabel = formatDistanceLabel(row.distanceMeters);
  const statusLabel = t(`status.${row.status}` as Parameters<typeof t>[0]);
  // Only a building that HAS parties can report open doors; a party-less
  // building's `openUnits` is null and says nothing (buildingStatus rank 0).
  const openUnitsLabel =
    row.hasUnits && row.openUnits !== null && row.openUnits > 0
      ? // t() has no interpolation; the placeholder is replaced at the call
        // site, the same way housePinAccessibilityLabel does it.
        t('map.pinOpenUnits').replace('{count}', String(row.openUnits))
      : null;

  return (
    <Pressable
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={[addressLabel, distanceLabel, statusLabel, openUnitsLabel]
        .filter((part): part is string => part !== null)
        .join(', ')}
      onPress={() => onSelect(row.houseId)}
      testID={`house-list-row-${row.houseId}`}
    >
      <View style={[styles.statusDot, { backgroundColor: statusColor[row.status] }]} />
      <View style={styles.rowText}>
        <Text
          style={[styles.address, row.address === null ? styles.addressUnknown : null]}
          numberOfLines={2}
        >
          {addressLabel}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {openUnitsLabel === null ? statusLabel : `${statusLabel} · ${openUnitsLabel}`}
        </Text>
      </View>
      {/* Omitted entirely without a fix — never a fake "0 m" (D-3). */}
      {distanceLabel !== null ? <Text style={styles.distance}>{distanceLabel}</Text> : null}
    </Pressable>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    hint: {
      ...typography.label,
      color: colors.textSecondary,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
    },
    emptyWrap: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.xl },
    emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: spacing.touchTarget,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.input,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    statusDot: { width: 12, height: 12, borderRadius: 6 },
    rowText: { flex: 1, gap: 2 },
    address: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
    addressUnknown: { fontWeight: '400', color: colors.textSecondary, fontStyle: 'italic' },
    meta: { ...typography.label, color: colors.textSecondary },
    distance: { ...typography.label, fontWeight: '600', color: colors.textPrimary },
  });
}
