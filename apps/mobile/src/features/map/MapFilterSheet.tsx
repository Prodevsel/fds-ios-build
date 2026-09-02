import { useMemo } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { radius, spacing, statusColor, typography, type HouseStatus } from '../../design/tokens';
import { t } from '../../i18n';
import { InfoSheet } from '../../ui/InfoSheet';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { ALL_STATUSES_VISIBLE, isFilterActive, type StatusFilter } from './territoryDoors';

/**
 * Which statuses the map draws.
 *
 * A rep working a street looks for the doors that are still OPEN. On five
 * houses that is a glance; on a real territory the finished and locked pins
 * are a wall in front of the two the rep is actually walking to. Hiding them
 * is the difference between a map and a picture of a map.
 *
 * It is a sheet rather than a chip row on the map for one reason: the map
 * screen has already spent its edges (the sync pill and tenant badge on top,
 * the tool column and summary dock at the bottom), and a permanent filter bar
 * would be the next thing covering the tiles — the mistake the search field
 * just stopped making.
 *
 * The counts are shown next to each status and are NOT filtered themselves:
 * a rep has to see that hiding "Erfolg" hid eleven pins, otherwise the map
 * looks empty for reasons nobody can see.
 */
const FILTER_ORDER: HouseStatus[] = ['new', 'follow_up', 'success', 'blacklist'];

export interface MapFilterSheetProps {
  visible: boolean;
  onClose: () => void;
  filter: StatusFilter;
  onChange: (next: StatusFilter) => void;
  /** How many buildings carry each status right now, unfiltered. */
  counts: Record<HouseStatus, number>;
}

export function MapFilterSheet({
  visible,
  onClose,
  filter,
  onChange,
  counts,
}: MapFilterSheetProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <InfoSheet
      visible={visible}
      onClose={onClose}
      title={t('mapFilter.title')}
      subtitle={t('mapFilter.subtitle')}
      testID="map-filter-sheet"
    >
      <View style={styles.rows}>
        {FILTER_ORDER.map((status) => (
          <View key={status} style={styles.row}>
            <View style={[styles.dot, { backgroundColor: statusColor[status] }]} />
            <Text style={styles.label}>{t(`status.${status}` as Parameters<typeof t>[0])}</Text>
            <Text style={styles.count}>{counts[status]}</Text>
            <Switch
              value={filter[status]}
              onValueChange={(value) => onChange({ ...filter, [status]: value })}
              accessibilityLabel={t(`status.${status}` as Parameters<typeof t>[0])}
              testID={`map-filter-${status}`}
            />
          </View>
        ))}
      </View>

      {/* The way back to a complete map, always one tap away. A filter that is
          easy to switch on and awkward to switch off is how a rep ends up
          staring at a map that is lying to them by omission. */}
      <Pressable
        accessibilityRole="button"
        style={[styles.reset, isFilterActive(filter) ? null : styles.resetDisabled]}
        disabled={!isFilterActive(filter)}
        onPress={() => onChange(ALL_STATUSES_VISIBLE)}
        testID="map-filter-reset"
      >
        <Text style={styles.resetText}>{t('mapFilter.showAll')}</Text>
      </Pressable>
    </InfoSheet>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    rows: { gap: spacing.xs },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: spacing.touchTarget,
    },
    dot: { width: 12, height: 12, borderRadius: 6 },
    label: { ...typography.body, color: colors.textPrimary, flex: 1 },
    count: { ...typography.label, fontWeight: '600', color: colors.textSecondary },
    reset: {
      marginTop: spacing.md,
      minHeight: spacing.touchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.input,
      borderWidth: 1,
      borderColor: colors.border,
    },
    resetDisabled: { opacity: 0.4 },
    resetText: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  });
}
