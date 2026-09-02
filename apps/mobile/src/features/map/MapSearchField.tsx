import { useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { radius, spacing, statusColor, typography } from '../../design/tokens';
import { t } from '../../i18n';
import { useThemeColors } from '../settings/theme/useThemeColors';
import type { GeocodeHit } from './addressSearch';
import type { HouseListRow } from './houseList';
import { formatDistanceLabel } from './houseList';

/**
 * The map's address search — a floating field over the map, purely
 * presentational. It owns no matching rule, no network call and no camera:
 * `addressSearch.ts` decides what matches and `MapScreen` decides what a tap
 * does, so the field can never disagree with the map about a building.
 *
 * The two stages are visible AS two stages, deliberately: local hits appear
 * while typing, and the online lookup is a button the rep presses — never a
 * surprise network call from a keystroke (Nominatim is rate limited to
 * 1 req/s).
 *
 * A remote hit outside the territory renders as an unpressable row with the
 * reason spelled out. That is not a disabled button being coy: outside the
 * territory there are no offline tiles, so "go there" would show a black
 * rectangle. Naming it is the only honest affordance.
 *
 * Picking a hit MOVES THE CAMERA and nothing else. The pin is a separate,
 * explicit press on the bar that then appears under the field — that
 * separation is the entire point of searching instead of tapping: the rep gets
 * the surveyed coordinates of a real address rather than wherever a fingertip
 * landed, and still decides whether a pin belongs there at all.
 */
export interface MapSearchFieldProps {
  top: number;
  query: string;
  onQueryChange: (next: string) => void;
  /** Local matches from the synced houses — already filtered and capped. */
  localHits: HouseListRow[];
  onSelectHouse: (houseId: string) => void;
  /** False while the sync pill says "offline" — the online stage is unavailable. */
  online: boolean;
  searching: boolean;
  /** `null` until the rep has actually pressed the online button for this query. */
  remoteHits: (GeocodeHit & { inside: boolean })[] | null;
  onSearchOnline: () => void;
  onSelectRemote: (hit: GeocodeHit) => void;
  /** The address the camera is parked on, or `null` — drives the pin bar. */
  pinCandidate: GeocodeHit | null;
  /** Closes the whole field — it is a tool, so it has to be dismissable. */
  onClose: () => void;
  onPlacePin: () => void;
  onDismissCandidate: () => void;
}

export function MapSearchField({
  top,
  query,
  onQueryChange,
  localHits,
  onSelectHouse,
  online,
  searching,
  remoteHits,
  onSearchOnline,
  onSelectRemote,
  pinCandidate,
  onClose,
  onPlacePin,
  onDismissCandidate,
}: MapSearchFieldProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hasQuery = query.trim().length > 0;

  return (
    <View style={[styles.container, { top }]} testID="map-search">
      <View style={[styles.field, styles.floating]}>
        <MaterialCommunityIcons name="magnify" size={18} color={colors.textSecondary} />
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={onQueryChange}
          placeholder={t('mapSearch.placeholder')}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => {
            if (localHits.length === 0 && online && !searching) onSearchOnline();
          }}
          testID="map-search-input"
        />
        {/* Text to throw away: clear it. Nothing left to clear: close the
            tool. One control, and it never sits there doing nothing. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={hasQuery ? t('mapSearch.clearLabel') : t('mapSearch.hideLabel')}
          hitSlop={spacing.sm}
          onPress={() => (hasQuery ? onQueryChange('') : onClose())}
          testID="map-search-clear"
        >
          <MaterialCommunityIcons name="close-circle" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>

      {hasQuery ? (
        <View style={[styles.results, styles.floating]} testID="map-search-results">
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.resultsScroll}>
            {localHits.map((row, index) => (
              <Pressable
                key={row.houseId}
                accessibilityRole="button"
                style={[styles.row, index === 0 ? null : styles.rowBordered]}
                onPress={() => onSelectHouse(row.houseId)}
                testID={`map-search-local-${row.houseId}`}
              >
                <View style={[styles.dot, { backgroundColor: statusColor[row.status] }]} />
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {row.address ?? ''}
                </Text>
                {formatDistanceLabel(row.distanceMeters) !== null ? (
                  <Text style={styles.rowMeta}>{formatDistanceLabel(row.distanceMeters)}</Text>
                ) : null}
              </Pressable>
            ))}

            {localHits.length === 0 ? (
              <SecondStage
                online={online}
                searching={searching}
                remoteHits={remoteHits}
                onSearchOnline={onSearchOnline}
                onSelectRemote={onSelectRemote}
                styles={styles}
                colors={colors}
              />
            ) : null}
          </ScrollView>
        </View>
      ) : null}

      {/* The camera is on the searched address; the pin is still the rep's
          call. Dismissing leaves the map exactly where it is. */}
      {pinCandidate && !hasQuery ? (
        <View style={[styles.pinBar, styles.floating]} testID="map-search-pin-bar">
          <View style={styles.rowMain}>
            <Text style={styles.pinBarLabel} numberOfLines={2}>
              {pinCandidate.label}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            style={styles.onlineCta}
            onPress={onPlacePin}
            testID="map-search-place-pin"
          >
            <MaterialCommunityIcons name="map-marker-plus" size={16} color={colors.onAccent} />
            <Text style={styles.onlineCtaText}>{t('mapSearch.placePinCta')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mapSearch.dismissCandidateLabel')}
            hitSlop={spacing.sm}
            onPress={onDismissCandidate}
            testID="map-search-dismiss-candidate"
          >
            <MaterialCommunityIcons name="close" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Everything below "the synced houses had nothing". Split out so the local
 * happy path above stays one flat list.
 */
function SecondStage({
  online,
  searching,
  remoteHits,
  onSearchOnline,
  onSelectRemote,
  styles,
  colors,
}: Pick<MapSearchFieldProps, 'online' | 'searching' | 'remoteHits' | 'onSearchOnline' | 'onSelectRemote'> & {
  styles: ReturnType<typeof makeStyles>;
  colors: ReturnType<typeof useThemeColors>;
}) {
  if (searching) {
    return (
      <View style={styles.notice} testID="map-search-searching">
        <ActivityIndicator size="small" color={colors.textSecondary} />
        <Text style={styles.noticeText}>{t('mapSearch.searching')}</Text>
      </View>
    );
  }

  if (remoteHits === null) {
    return (
      <View style={styles.notice}>
        <Text style={styles.noticeText} testID="map-search-local-empty">
          {t('mapSearch.localEmpty')}
        </Text>
        {online ? (
          <Pressable
            accessibilityRole="button"
            style={styles.onlineCta}
            onPress={onSearchOnline}
            testID="map-search-online-cta"
          >
            <MaterialCommunityIcons name="cloud-search-outline" size={16} color={colors.onAccent} />
            <Text style={styles.onlineCtaText}>{t('mapSearch.onlineCta')}</Text>
          </Pressable>
        ) : (
          <View style={styles.offlineHint} testID="map-search-offline-hint">
            <MaterialCommunityIcons name="wifi-off" size={14} color={colors.textSecondary} />
            <Text style={styles.noticeText}>{t('mapSearch.offlineHint')}</Text>
          </View>
        )}
      </View>
    );
  }

  if (remoteHits.length === 0) {
    return (
      <View style={styles.notice}>
        <Text style={styles.noticeText} testID="map-search-remote-empty">
          {t('mapSearch.remoteEmpty')}
        </Text>
      </View>
    );
  }

  return (
    <View>
      {remoteHits.map((hit, index) => {
        const key = `${hit.lat},${hit.lon},${index}`;
        const body = (
          <>
            <MaterialCommunityIcons
              name={hit.inside ? 'map-marker-outline' : 'map-marker-off-outline'}
              size={16}
              color={hit.inside ? colors.textPrimary : colors.textSecondary}
            />
            <View style={styles.rowMain}>
              <Text
                style={[styles.rowTitle, hit.inside ? null : styles.rowTitleMuted]}
                numberOfLines={2}
              >
                {hit.label}
              </Text>
              {hit.inside ? null : (
                <Text style={styles.rowMeta}>{t('mapSearch.outsideTerritory')}</Text>
              )}
            </View>
          </>
        );
        // Outside the territory: named, not navigable — there are no tiles out
        // there, so a tap could only deliver a black screen.
        return hit.inside ? (
          <Pressable
            key={key}
            accessibilityRole="button"
            style={[styles.row, index === 0 ? null : styles.rowBordered]}
            onPress={() => onSelectRemote(hit)}
            testID={`map-search-remote-${index}`}
          >
            {body}
          </Pressable>
        ) : (
          <View
            key={key}
            style={[styles.row, index === 0 ? null : styles.rowBordered]}
            accessibilityRole="text"
            accessibilityLabel={`${hit.label}, ${t('mapSearch.outsideTerritory')}`}
            testID={`map-search-remote-outside-${index}`}
          >
            {body}
          </View>
        );
      })}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: {
      position: 'absolute',
      left: spacing.mapEdgeMargin,
      right: spacing.mapEdgeMargin,
      gap: spacing.sm,
    },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: spacing.touchTarget,
      paddingHorizontal: spacing.md,
      borderRadius: radius.input,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    // Same lift the floating map controls use, so the search sits in the same
    // plane as the rest of the map chrome.
    floating: {
      elevation: 4,
      shadowColor: colors.ink,
      shadowOpacity: 0.22,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
    },
    input: { flex: 1, ...typography.body, color: colors.textPrimary, paddingVertical: 0 },
    results: {
      borderRadius: radius.input,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: 'hidden',
    },
    // Capped so the dropdown can never swallow the map it is searching.
    resultsScroll: { maxHeight: 260 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: spacing.touchTarget,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    rowBordered: { borderTopWidth: 1, borderTopColor: colors.border },
    pinBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.sm,
      borderRadius: radius.input,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    pinBarLabel: { ...typography.label, color: colors.textPrimary },
    rowMain: { flex: 1, minWidth: 0 },
    dot: { width: 10, height: 10, borderRadius: 5 },
    rowTitle: { flex: 1, ...typography.body, color: colors.textPrimary },
    rowTitleMuted: { color: colors.textSecondary },
    rowMeta: { ...typography.label, color: colors.textSecondary },
    notice: { gap: spacing.sm, padding: spacing.md, alignItems: 'flex-start' },
    noticeText: { ...typography.label, color: colors.textSecondary },
    offlineHint: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    onlineCta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: spacing.touchTarget,
      paddingHorizontal: spacing.md,
      borderRadius: radius.input,
      backgroundColor: colors.accent,
    },
    onlineCtaText: { ...typography.body, fontWeight: '600', color: colors.onAccent },
  });
}
