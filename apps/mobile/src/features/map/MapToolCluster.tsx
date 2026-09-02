import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, spacing, typography } from '../../design/tokens';
import { t } from '../../i18n';
import { useThemeColors } from '../settings/theme/useThemeColors';
import {
  MAP_CONTROL_SIZE,
  type MapToolCluster as MapToolClusterModel,
  type MapToolId,
} from './mapChrome';

type MciName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
type ThemeColors = ReturnType<typeof useThemeColors>;

/**
 * The map's floating tool cluster (defect 5, "mach das doch aufklappbar oder
 * pfeil nach oben mit animation").
 *
 * WHAT STAYS OUTSIDE, and why: the cluster presents whatever
 * `deriveMapToolCluster` hands it, and that rule keeps recenter as an anchor
 * rendered beside the trigger rather than inside it — recentring is used
 * between doors, so a disclosure tap would be charged on every single use. The
 * same rule renders the map/list toggle DIRECTLY while the house-list overlay
 * is up, because there it is the only way back to the map.
 *
 * MOTION: this reuses `StreetSummaryCard`'s mechanic rather than introducing a
 * second one — a single `Animated.Value` driven by `Animated.timing` at 220ms
 * with `Easing.out(Easing.cubic)`, collapsing to duration 0 (and stagger 0)
 * under Reduce Motion. Springs and overshooting easings are deliberately
 * absent: the ask was an ease-out fan, not a bounce.
 *
 * DRIVER: unlike the summary card (which animates `height`, unsupported by the
 * native driver), this component animates ONLY `translateY` and `opacity`, both
 * native-driver-safe — so `useNativeDriver: true` is correct here. No
 * layout-affecting style on those same nodes is JS-animated; mixing drivers on
 * one node is the classic failure mode and is avoided by keeping each entry's
 * resting `bottom` a static value.
 */

/**
 * Per-entry offset into the shared 220ms timeline: ~40ms of it, so the entries
 * arrive one after the other instead of as a block. Zeroed under Reduce Motion,
 * where the whole set must switch at once.
 */
const ENTRY_STAGGER_RATIO = 0.18;

/** Vertical stride of the floating-control column, identical to `mapControlBottom`'s default step. */
const CLUSTER_STEP = MAP_CONTROL_SIZE + spacing.sm;

export interface MapToolClusterProps {
  /** The composition decided by `deriveMapToolCluster` — this component never re-decides it. */
  cluster: MapToolClusterModel;
  viewMode: 'map' | 'list';
  reducedMotion: boolean;
  /** Resolved `mapControlBottom` offset for column index 0 (the anchor's slot). */
  anchorBottom: number;
  /** Resolved `mapControlBottom` offset for column index 1 (the trigger's slot). */
  stackBottom: number;
  onRecenter: () => void;
  onToggleViewMode: () => void;
  onHelp: () => void;
  /** Shows or hides the street summary card. */
  onToggleSummary: () => void;
  /** Shows or hides the address search field. */
  onToggleSearch: () => void;
  /** Opens the status-filter sheet. */
  onOpenFilter: () => void;
  /** A filter is hiding something — the control says so instead of looking idle. */
  filterActive: boolean;
  /** Drives the search icon and label, same as `summaryOpen` does for the card. */
  searchOpen: boolean;
  /** Drives the icon and the label, so the control states what it will do. */
  summaryOpen: boolean;
  onEnterDrawMode: () => void;
  onAssignRep: () => void;
}

export function MapToolCluster({
  cluster,
  viewMode,
  reducedMotion,
  anchorBottom,
  stackBottom,
  onRecenter,
  onToggleViewMode,
  onHelp,
  onToggleSummary,
  onToggleSearch,
  onOpenFilter,
  filterActive,
  searchOpen,
  summaryOpen,
  onEnterDrawMode,
  onAssignRep,
}: MapToolClusterProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [expanded, setExpanded] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;

  const clustered = cluster.mode === 'cluster';

  // A cluster that stops being a cluster (draw mode entered, list mode opened,
  // a role gate closing) must not leave the open state behind — the backdrop
  // would otherwise outlive the trigger that dismisses it.
  useEffect(() => {
    if (!clustered) setExpanded(false);
  }, [clustered]);

  useEffect(() => {
    Animated.timing(progress, {
      toValue: expanded ? 1 : 0,
      duration: reducedMotion ? 0 : 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [expanded, reducedMotion, progress]);

  const describeTool = (id: MapToolId): ToolPresentation => {
    switch (id) {
      case 'recenter':
        return {
          icon: 'crosshairs-gps',
          label: t('map.recenterLabel'),
          testID: 'map-recenter-button',
          onPress: onRecenter,
        };
      case 'viewToggle':
        return {
          icon: viewMode === 'map' ? 'format-list-bulleted' : 'map-outline',
          label: viewMode === 'map' ? t('houseList.toggleToList') : t('houseList.toggleToMap'),
          testID: 'map-view-toggle',
          onPress: onToggleViewMode,
        };
      case 'filter':
        return {
          icon: filterActive ? 'filter' : 'filter-outline',
          label: t(filterActive ? 'mapFilter.activeLabel' : 'mapFilter.openLabel'),
          testID: 'map-filter-button',
          onPress: onOpenFilter,
        };
      case 'search':
        return {
          icon: searchOpen ? 'magnify-close' : 'magnify',
          label: t(searchOpen ? 'mapSearch.hideLabel' : 'mapSearch.showLabel'),
          testID: 'map-search-button',
          onPress: onToggleSearch,
        };
      case 'summary':
        return {
          icon: summaryOpen ? 'chart-box' : 'chart-box-outline',
          label: t(summaryOpen ? 'map.summaryHideLabel' : 'map.summaryShowLabel'),
          testID: 'map-summary-toggle',
          onPress: onToggleSummary,
        };
      case 'help':
        return {
          icon: 'help-circle-outline',
          label: t('help.mapButtonLabel'),
          testID: 'map-help-button',
          onPress: onHelp,
        };
      case 'draw':
        return {
          icon: 'shape-polygon-plus',
          label: t('map.enterDrawModeLabel'),
          testID: 'map-draw-toggle',
          onPress: onEnterDrawMode,
        };
      case 'assign':
        return {
          icon: 'account-plus-outline',
          label: t('cta.assignTerritory'),
          testID: 'map-assign-rep-button',
          onPress: onAssignRep,
        };
    }
  };

  const anchor = cluster.anchor ? describeTool(cluster.anchor) : null;

  // z-ORDER, deliberately asymmetric — do NOT "simplify" this into one value.
  // The map/list toggle has always carried elevation 11 so it stays reachable
  // above `fullScreenOverlay` (10) while the house list covers the map; that is
  // exactly the `direct` list-mode case. The map-mode cluster stays on the
  // ordinary floating-control tier, because help, draw and assign sit BELOW the
  // contract-list and Abschluss-detail overlays today, and promoting them would
  // newly float them over those full-screen surfaces.
  const aboveOverlay = viewMode === 'list';
  const tierStyle = aboveOverlay ? styles.aboveOverlay : styles.floatingTier;

  const entryCount = cluster.entries.length;
  const staggerRatio = reducedMotion ? 0 : ENTRY_STAGGER_RATIO;
  const windowSpan = Math.max(0.01, 1 - staggerRatio * Math.max(0, entryCount - 1));

  const chevronRotate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  return (
    <>
      {/* T-GRK-04: the dismiss backdrop exists ONLY while the cluster is open.
          Left mounted while closed it would swallow every map pan, pin tap and
          territory press — i.e. silently disable the primary screen. */}
      {expanded ? (
        <Pressable
          style={[styles.backdrop, tierStyle]}
          testID="map-tools-backdrop"
          accessible={false}
          onPress={() => setExpanded(false)}
        />
      ) : null}

      {cluster.entries.map((id, index) => {
        const tool = describeTool(id);
        const reachable = !clustered || expanded;
        const restingBottom = clustered
          ? stackBottom + (index + 1) * CLUSTER_STEP
          : (cluster.anchor ? stackBottom : anchorBottom) + index * CLUSTER_STEP;

        // Each entry rests where `mapControlBottom` would place it at the
        // trigger's index + index + 1; the helper is linear in `index` with
        // exactly this stride, so the addition is the same number without
        // threading the insets through a second time.
        const start = Math.min(index * staggerRatio, 1 - windowSpan);
        const entryProgress = clustered
          ? progress.interpolate({
              inputRange: [start, start + windowSpan],
              outputRange: [0, 1],
              extrapolate: 'clamp',
            })
          : null;

        return (
          <Animated.View
            key={id}
            style={[
              styles.entryRow,
              tierStyle,
              { bottom: restingBottom },
              entryProgress
                ? {
                    opacity: entryProgress,
                    transform: [
                      {
                        // Fans UPWARD: closed, the entry sits on the trigger.
                        translateY: entryProgress.interpolate({
                          inputRange: [0, 1],
                          outputRange: [(index + 1) * CLUSTER_STEP, 0],
                        }),
                      },
                    ],
                  }
                : null,
            ]}
            // Closed entries are unreachable by touch AND by assistive tech
            // (T-GRK-05): a screen reader must never focus an action the
            // sighted UI has hidden.
            pointerEvents={reachable ? 'box-none' : 'none'}
            accessibilityElementsHidden={!reachable}
            importantForAccessibility={reachable ? 'auto' : 'no-hide-descendants'}
          >
            {/* Draw and assign lost their text pills when they became icon
                FABs, so every expanded entry carries its label to the left —
                the standard speed-dial affordance. `pointerEvents="none"`
                keeps the FAB itself the tap target. */}
            <View style={styles.entryLabel} pointerEvents="none">
              <Text style={styles.entryLabelText} numberOfLines={1}>
                {tool.label}
              </Text>
            </View>
            <Pressable
              style={styles.control}
              accessibilityRole="button"
              accessibilityLabel={tool.label}
              testID={tool.testID}
              onPress={() => {
                setExpanded(false);
                tool.onPress();
              }}
            >
              <MaterialCommunityIcons name={tool.icon} size={22} color={colors.textPrimary} />
            </Pressable>
          </Animated.View>
        );
      })}

      {clustered ? (
        <Pressable
          style={[styles.control, styles.stackSlot, tierStyle, { bottom: stackBottom }]}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={t(expanded ? 'map.toolsCollapseLabel' : 'map.toolsExpandLabel')}
          testID="map-tools-trigger"
          onPress={() => setExpanded((open) => !open)}
        >
          <Animated.View style={{ transform: [{ rotate: chevronRotate }] }}>
            <MaterialCommunityIcons name="chevron-up" size={26} color={colors.textPrimary} />
          </Animated.View>
        </Pressable>
      ) : null}

      {anchor ? (
        <Pressable
          style={[styles.control, styles.stackSlot, tierStyle, { bottom: anchorBottom }]}
          accessibilityRole="button"
          accessibilityLabel={anchor.label}
          testID={anchor.testID}
          onPress={anchor.onPress}
        >
          <MaterialCommunityIcons name={anchor.icon} size={22} color={colors.textPrimary} />
        </Pressable>
      ) : null}
    </>
  );
}

interface ToolPresentation {
  icon: MciName;
  label: string;
  testID: string;
  onPress: () => void;
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    /** The ordinary floating-control tier, shared with the recenter control. */
    floatingTier: { elevation: 4 },
    /** Above `MapScreen`'s `fullScreenOverlay` (10) — list mode only. */
    aboveOverlay: { elevation: 11 },
    entryRow: {
      position: 'absolute',
      right: spacing.mapEdgeMargin,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    stackSlot: {
      position: 'absolute',
      right: spacing.mapEdgeMargin,
    },
    control: {
      width: MAP_CONTROL_SIZE,
      height: MAP_CONTROL_SIZE,
      borderRadius: radius.card - 2,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      // No drop shadow. On a dark surface over a light basemap it read as a
      // backlight glowing out of the button rather than as depth. A 1dp border
      // is what actually does the job the shadow was there for: separating the
      // control from the tiles underneath.
      borderWidth: 1,
      borderColor: colors.border,
    },
    entryLabel: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.input,
      backgroundColor: colors.surface,
      borderWidth: 1.5,
      borderColor: colors.borderStrong,
    },
    entryLabelText: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  });
