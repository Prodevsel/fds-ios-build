import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useNavigation,
  useRoute,
  type NavigationProp,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeSyntheticEvent } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  Camera,
  type CameraRef,
  type VectorSourceRef,
  GeoJSONSource,
  Layer,
  Map as MapView,
  type MapRef,
  Marker,
  type PressEvent,
  UserLocation,
  VectorSource,
} from '@maplibre/maplibre-react-native';
import { bbox, booleanPointInPolygon, point as turfPoint } from '@turf/turf';
import type { AbstractPowerSyncDatabase, SyncStatus } from '@powersync/common';

import { openDatabase } from '../../lib/db/powersync';
import { useRoleScope } from '../auth/useRoleScope';
import { useMarkFirstSync } from '../auth/useMarkFirstSync';
import { getPowerSyncUrl, getSupabase } from '../../lib/auth/supabase';
import { SupabaseConnector, type SyncConflict } from '../../lib/db/connector';
import { createHousesRepo, type HouseRow } from './db/housesRepo';
import {
  deriveBuildingStatus,
  groupUnitsByParent,
  hasNoSolicitationLock,
  type BuildingRollup,
} from './buildingStatus';
import { deriveHouseListRows } from './houseList';
import { resolveSyncConflictToastKey } from './syncConflictToast';
import { HouseListView } from './HouseListView';
import { getSignatureLocationDefault } from '../../lib/location/getSignatureLocation';
import { createTerritoriesRepo, type AssignableTerritoryRow } from './db/territoriesRepo';
import { usePmtilesFile, type PmtilesFileStatus, type TerritoryBounds } from './usePmtilesFile';
import { HousePin } from './HousePin';
import {
  deriveMapToolCluster,
  deriveStatusBarScrimBands,
  mapChromeTop,
  mapControlBottom,
  MAP_CHROME_BOTTOM,
  MAP_CONTROL_SIZE,
} from './mapChrome';
import { MapToolCluster } from './MapToolCluster';
import { MapSearchField } from './MapSearchField';
import { MapFilterSheet } from './MapFilterSheet';
import {
  ALL_STATUSES_VISIBLE,
  deriveDoorProgress,
  deriveTerritoryDoors,
  isFilterActive,
  tapCandidates,
  type DoorProgress,
  type StatusFilter,
  type TerritoryDoor,
} from './territoryDoors';
import {
  forwardGeocode,
  isInsideTerritory,
  matchLocalRows,
  type GeocodeHit,
} from './addressSearch';
import { StatusSheet, type StatusSheetTarget } from './StatusSheet';
import { AssignRepSheet } from './AssignRepSheet';
import { TerritoryDrawControls, TerritoryDrawLayer, useTerritoryDraw } from './TerritoryDraw';
import { ContractListScreen } from '../checkout/ContractListScreen';
import { AbschlussDetailView } from '../checkout/AbschlussDetailScreen';
import { InfoSheet, InfoSheetSection, InfoLegendRow, buildStatusLegend } from '../../ui/InfoSheet';
import { useReducedMotion } from '../../ui/useReducedMotion';
import { useTenantIdentity } from '../profile/useTenantIdentity';
import { TenantBadge } from '../profile/TenantBadge';
import { t } from '../../i18n';
import type { KarteStackParamList } from '../../app/navigation';
import {
  type HouseStatus,
  lightColors,
  radius,
  spacing,
  statusColor,
  typography,
} from '../../design/tokens';
import { useThemeColors } from '../settings/theme/useThemeColors';

/**
 * MAP-01 (view) + MAP-03: the app's home screen — full-bleed offline map
 * with the PMTiles basemap (via usePmtilesFile's tile-proxy fallback, see
 * PMTILES-SPIKE.md VERDICT), territory-boundary overlays (own vs. locked),
 * and traffic-light house pins from local SQLite. Tap-to-set-status
 * (MAP-02) and territory drawing are out of scope here (02-06/02-07).
 *
 * No mapStyle background is loaded from the network — a blank inline style
 * is used and every visible layer is supplied declaratively as children
 * (VectorSource/GeoJSONSource + Layer), so the screen has no online
 * dependency beyond the tile requests themselves.
 */
// glyphs is REQUIRED the moment any symbol layer renders text — without it
// MapLibre Native issues unparseable glyph resource URLs ("Unable to parse
// resourceUrl"). The Protomaps glyph CDN is fetched online and cached by the
// offline pack alongside the tiles, so offline rendering keeps its labels.
/**
 * Taken from the Map component's OWN prop type rather than imported from
 * '@maplibre/maplibre-gl-style-spec'. apps/admin pulled in maplibre-gl@6 for the
 * dashboard territory map, which hoisted that package's v26 to the workspace
 * root — while @maplibre/maplibre-react-native pins 24.8.5. The bare import then
 * resolved v26's StyleSpecification, which no longer assigns to the v24 one this
 * component declares. Deriving the type from the component cannot drift again,
 * whatever else the workspace hoists. Metro never type-checks, so this was a
 * tsc-only break with no runtime symptom — the kind that sits unnoticed.
 */
type MapStyleSpec = NonNullable<ComponentProps<typeof MapView>['mapStyle']>;

const BLANK_STYLE: MapStyleSpec = {
  version: 8,
  glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
  sources: {},
  // Areas outside the territory extract have no tiles at all — without a
  // background layer they render as hard black instead of "edge of map".
  // 'overlay-anchor' is an invisible ordering anchor: basemap layers insert
  // with beforeId="overlay-anchor" (below it), overlay layers (territories,
  // draw draft) insert without beforeId (above it). Without this, whichever
  // source loads LAST stacks on top — the basemap's opaque earth fill was
  // covering the territory overlays.
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#E2E8F0' } },
    { id: 'overlay-anchor', type: 'background', paint: { 'background-opacity': 0 } },
  ],
};

interface TerritoryRow {
  id: string;
  team_id: string;
  name: string;
  locked_by: string | null;
  /** Joined from territory_assignments (0061) — the lead-granted assignee. */
  assigned_rep_id: string | null;
  boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

export interface MapScreenProps {
  /**
   * D-18 forward seam: registers a callback the caller can invoke later to
   * open the "Meine Abschlüsse" list — the checkout success screen (04-08,
   * not yet built) will use this to wire its "Meine Abschlüsse ansehen"
   * secondary CTA without MapScreen needing to know about the checkout
   * flow's internals. Called once on mount; a no-op if omitted (App.tsx
   * mounts MapScreen with no props today).
   */
  onViewContracts?: (openContractList: () => void) => void;
}

/**
 * NO `SafeAreaProvider` HERE — AND NOWHERE ELSE UNDER `features/map/`.
 *
 * This screen used to wrap itself in its own `<SafeAreaProvider>` (02-05),
 * which was correct at the time: MapScreen was mounted straight from App.tsx
 * as the app's root component, so its provider was the ONLY one in the tree.
 * When `RootNavigator` was introduced it took over that job — correctly, with
 * `initialMetrics={initialWindowMetrics}` — and MapScreen became a child of
 * `KarteStack`. The old wrapper was never removed, so the tree carried TWO
 * providers.
 *
 * A nested provider does not inherit; it re-measures its own frame and, until
 * that async `onLayout` lands (and on iOS, for a child of an already-laid-out
 * parent, effectively never), it serves ZEROES. Every `useSafeAreaInsets()`
 * below this point therefore read `{ top: 0, bottom: 0 }` on a real device:
 * the house sheet's cap (`maxSheetHeight`) put its close button inside the
 * status bar, the status-bar scrim collapsed to nothing, and the floating map
 * controls sat on the home indicator.
 *
 * It looked GREEN in every test, because `MapScreen.test.tsx` mocks the whole
 * `react-native-safe-area-context` module (insets are stubbed to zero there by
 * design) — a mocked provider cannot reproduce a real provider's measurement.
 * That is exactly why the guard against a relapse is a SOURCE scan over this
 * directory (`MapScreen.test.tsx` → "no SafeAreaProvider under features/map"),
 * not a render assertion: only a source scan can see the mistake this class of
 * bug actually makes.
 */
export function MapScreen({ onViewContracts }: MapScreenProps = {}) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const reducedMotion = useReducedMotion();
  const route = useRoute<RouteProp<KarteStackParamList, 'Karte'>>();
  const navigation = useNavigation<NavigationProp<KarteStackParamList, 'Karte'>>();
  const focusHouseId = route.params?.focusHouseId ?? null;
  const cameraRef = useRef<CameraRef>(null);
  const mapRef = useRef<MapRef>(null);

  const [db, setDb] = useState<AbstractPowerSyncDatabase | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  // SEC-10/D-16: the rep's home screen always shows which tenant they are
  // logged into — cache-first (MMKV, outside PowerSync), RPC-refreshed.
  const tenantIdentity = useTenantIdentity({ userId });
  const [houses, setHouses] = useState<HouseRow[]>([]);
  // 0088: parties (Parteien) live in the same table behind
  // `parent_house_id IS NOT NULL`, so they arrive on their own subscription —
  // `houses` above now strictly means BUILDINGS.
  const [units, setUnits] = useState<HouseRow[]>([]);
  const [territories, setTerritories] = useState<TerritoryRow[]>([]);
  const [syncState, setSyncState] = useState<'synced' | 'pending' | 'offline'>('offline');
  const [trackingUser, setTrackingUser] = useState(false);
  // D-18: map-menu entry point into the read-only "Meine Abschlüsse" list —
  // presented as a fullScreenFlow-style overlay (same pattern as
  // FlowRunnerScreen inside StatusSheet).
  const [showContractList, setShowContractList] = useState(false);
  // Design SSOT phone map "?" control: the pin-legend + map-help bottom sheet
  // (tablet Pin-Legende, ported to a phone sheet). Static UI copy, no data.
  const [showHelp, setShowHelp] = useState(false);
  // Abschluss-Detail (design SSOT 10b) opened from a contract-list row tap —
  // rendered as a nested overlay above the list (offline, no navigator here).
  const [detailContractId, setDetailContractId] = useState<string | null>(null);

  useEffect(() => {
    onViewContracts?.(() => setShowContractList(true));
    // Registration is a one-shot wiring call, not a reactive subscription —
    // re-registering on every onViewContracts identity change would fight
    // whatever cached the callback on the caller's side.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // MAP-02/MAP-05 tap-to-drop-pin: null = sheet closed; 'create' = a fresh
  // tap on empty map space; 'edit' = an existing pin reopened pre-selected.
  const [sheetTarget, setSheetTarget] = useState<StatusSheetTarget | null>(null);
  // Measured host height for the house sheet's cap. Null until first layout.
  const [hostHeight, setHostHeight] = useState<number | null>(null);
  // Rendering <UserLocation /> (or enabling camera tracking) without the
  // runtime location grant throws a native SecurityException on Android and
  // kills the app — both must stay off until the user grants access.
  const [locationGranted, setLocationGranted] = useState(false);
  // MAP-04 team-lead territory drawing.
  const [assignableTerritories, setAssignableTerritories] = useState<AssignableTerritoryRow[]>([]);
  const [drawMode, setDrawMode] = useState(false);
  // Server-authoritative denials (boundary + lock) surfaced as a non-blocking
  // toast (UI-SPEC: never a full modal) — auto-dismisses after a few seconds.
  const [conflictToast, setConflictToast] = useState<string | null>(null);

  // The house list is an ADDITIONAL view. 'map' is the value this screen opens
  // in and the map's own rendering path below is untouched by the toggle —
  // backward compatibility is the first guarantee here, not a side effect.
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map');
  // D-1: the distance origin is the repo's EXISTING one-shot foreground fix
  // (`getSignatureLocationDefault`, which never throws and degrades to
  // `{ gps: null, reason }`). It is taken ONCE, when the list is first opened,
  // and never watched — `requestLocationAndTrack` above is a continuous
  // MapLibre camera-tracking toggle that never exposes coordinates to JS, so
  // it cannot supply an origin, and turning it into one would add a
  // continuous subscription this feature does not need (T-G01-02).
  const [originFix, setOriginFix] = useState<{ lat: number; lon: number } | null>(null);
  const [fixAttempted, setFixAttempted] = useState(false);

  useEffect(() => {
    if (viewMode !== 'list' || fixAttempted) return;
    let cancelled = false;
    void (async () => {
      const result = await getSignatureLocationDefault();
      if (cancelled) return;
      // `lng` -> `lon`: the location module speaks lng, `houses` rows speak lon.
      if (result.gps) setOriginFix({ lat: result.gps.lat, lon: result.gps.lng });
      // Marked attempted either way — a denial must not retry on every render.
      setFixAttempted(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [viewMode, fixAttempted]);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      setLocationGranted(true);
      return;
    }
    void PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION).then(
      setLocationGranted,
    );
  }, []);

  // T-02-07-04: a server-authoritative denial is never silently dropped —
  // surface it on the non-blocking toast (never a blind retry; the connector
  // already reverted the optimistic local write, or consumed the op).
  //
  // Which conflicts earn a sentence, and which one deliberately does not,
  // lives in `syncConflictToast.ts` — the table filter that used to sit here
  // dropped every contract conflict on the floor, which is exactly the kind
  // of decision that must be testable rather than inlined in a component.
  const handleSyncConflict = (conflict: SyncConflict) => {
    const key = resolveSyncConflictToastKey(conflict);
    if (key) setConflictToast(t(key));
  };

  useEffect(() => {
    if (!conflictToast) return;
    const timer = setTimeout(() => setConflictToast(null), 4000);
    return () => clearTimeout(timer);
  }, [conflictToast]);

  const requestLocationAndTrack = async () => {
    let granted = locationGranted;
    if (!granted && Platform.OS === 'android') {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      );
      granted = result === PermissionsAndroid.RESULTS.GRANTED;
      setLocationGranted(granted);
    }
    if (granted) setTrackingUser(true);
  };

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      const supabase = getSupabase();
      // The real login screen (features/auth/LoginScreen) now gates the app via
      // the RootNavigator's auth gate, so by the time MapScreen mounts a
      // Supabase session already exists — MapScreen just reads it. (The former
      // __DEV__ fixture auto-login lived here and has been removed.)
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setUserId(data.session?.user.id ?? null);

      const opened = await openDatabase();
      if (cancelled) return;
      // Iron Rule 1: PowerSync is the only network data path. connect() is
      // not awaited — the UI stays usable offline and the sync loop drains
      // in the background once network returns (same contract as the
      // skeleton flow). Config/auth rejections surface in the sync pill via
      // the status listener, so a console.warn is enough here.
      const connector = new SupabaseConnector({
        supabase,
        powersyncUrl: getPowerSyncUrl(),
        onConflict: handleSyncConflict,
      });
      opened.connect(connector).catch((err: unknown) => {
        console.warn('[MapScreen] PowerSync connect failed:', err);
      });
      setDb(opened);
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  // ONBD-02/D-01: flips the device's own onboarding state to "synced" exactly
  // once, directly (not via the connector), after the first full PowerSync
  // sync completes — a no-op until db is set (boot() above).
  useMarkFirstSync(db);

  useEffect(() => {
    if (!db) return;
    const repo = createHousesRepo({ db });
    const unsubscribeHouses = repo.watchHouses(setHouses);
    const unsubscribeUnits = repo.watchUnits(setUnits);
    return () => {
      unsubscribeHouses();
      unsubscribeUnits();
    };
  }, [db]);

  // Parties keyed by their building, ordered by created_at — the one lookup
  // every derived value below shares.
  const unitsByParent = useMemo(() => groupUnitsByParent(units), [units]);

  // Deep link from the Termine tab: open the tapped house's StatusSheet on
  // arrival (mockup promise). Waits until the house row has synced/loaded
  // locally, then consumes the param so a back-and-forth doesn't reopen it.
  useEffect(() => {
    if (!focusHouseId) return;
    // watchHouses only carries BUILDINGS since 0088, but an appointment can now
    // hang on a PARTY (appointments.house_id). Fall back to the parties and
    // centre on the party's building, otherwise "Zum Haus" after a party
    // follow-up would silently point at nothing.
    const house =
      houses.find((h) => h.id === focusHouseId) ??
      (() => {
        const unit = units.find((u) => u.id === focusHouseId);
        return unit ? houses.find((h) => h.id === unit.parent_house_id) : undefined;
      })();
    if (!house) return;
    setSheetTarget({ mode: 'edit', house });
    navigation.setParams({ focusHouseId: undefined });
  }, [focusHouseId, houses, units, navigation]);

  useEffect(() => {
    if (!db) return;
    const repo = createTerritoriesRepo({ db });
    return repo.watchAssignableTerritories(setAssignableTerritories);
  }, [db]);

  useEffect(() => {
    if (!db) return;
    const controller = new AbortController();
    db.watch(
      // assigned_rep_id is joined in from territory_assignments (0061) rather
      // than read off territories: the assignee deliberately does NOT live on
      // the territories row, because that row syncs team-wide and would leak
      // who works where to every teammate. LEFT JOIN so an unassigned
      // territory still renders.
      `SELECT t.id, t.team_id, t.name, t.locked_by, t.boundary, a.assigned_rep_id
         FROM territories t
         LEFT JOIN territory_assignments a ON a.territory_id = t.id
        WHERE t.boundary IS NOT NULL`,
      [],
      {
        onResult: (result) => {
          const rows = (result.rows?._array ?? []) as Array<{
            id: string;
            team_id: string;
            name: string;
            locked_by: string | null;
            assigned_rep_id: string | null;
            boundary: string;
          }>;
          setTerritories(
            rows
              .map((row) => {
                try {
                  return { ...row, boundary: JSON.parse(row.boundary) };
                } catch {
                  return null;
                }
              })
              .filter((row): row is TerritoryRow => row !== null),
          );
        },
      },
      { signal: controller.signal },
    );
    return () => controller.abort();
  }, [db]);

  useEffect(() => {
    if (!db) return;
    const applyStatus = (status: SyncStatus) => {
      if (!status.connected) {
        setSyncState('offline');
      } else if (status.dataFlowStatus.uploading) {
        setSyncState('pending');
      } else {
        setSyncState('synced');
      }
    };
    applyStatus(db.currentStatus);
    return db.registerListener({ statusChanged: applyStatus });
  }, [db]);

  /**
   * "My territory" is the ASSIGNMENT, not the lock.
   *
   * This read `locked_by === userId` alone. But 0061_territory_assignments.sql
   * introduced `territory_assignments` precisely because the two are different
   * facts with different lifetimes: `locked_by` is a transient draw/claim
   * session lock, the assignment is what a team lead actually grants. So a rep
   * whose lead had assigned them a territory still got the no-territory empty
   * state (`emptyState.noTerritoryHeading`), and — because `tileSourceTerritory`
   * is this same value — no basemap tiles were ever requested either. One wrong
   * field, two symptoms that look unrelated.
   *
   * The lock is kept as a fallback so a rep who claimed a territory by drawing
   * it in the app still sees it before a lead formalises the assignment.
   */
  const ownTerritory = useMemo(
    () => territories.find((territory) => isOwnTerritory(territory, userId)) ?? null,
    [territories, userId],
  );
  const tileSourceTerritory = ownTerritory;

  const territoryBounds = useMemo<TerritoryBounds | null>(() => {
    if (!tileSourceTerritory) return null;
    try {
      const [west, south, east, north] = bbox(tileSourceTerritory.boundary);
      return [west, south, east, north];
    } catch {
      return null;
    }
  }, [tileSourceTerritory]);

  const { tileUrlTemplate, status: tileStatus } = usePmtilesFile({
    teamId: tileSourceTerritory?.team_id ?? null,
    territoryId: tileSourceTerritory?.id ?? null,
    bounds: territoryBounds,
  });

  const territoriesFeatureCollection = useMemo(
    () => territoriesToFeatureCollection(territories, userId),
    [territories, userId],
  );

  // MAP-04: the team lead's draw target is a territory already assigned
  // (locked_by set, e.g. via an out-of-band admin/seed flow — no in-app
  // rep-assignment picker exists yet, see 02-07-SUMMARY.md) but with no
  // boundary drawn yet. Once drawn, this territory drops out of the list
  // (boundary becomes non-null) — no further draw target until another
  // assigned-but-undrawn territory appears.
  const drawTargetTerritory = useMemo(
    () =>
      assignableTerritories.find(
        (territory) => territory.locked_by !== null && !territory.boundary,
      ) ?? null,
    [assignableTerritories],
  );
  const { isTeamLead } = useRoleScope();
  const canEnterDrawMode = deriveCanEnterDrawMode(drawTargetTerritory, isTeamLead);

  // TASGN-01/02: the assign-rep affordance closes the "no in-app
  // rep-assignment picker exists yet" gap noted above (drawTargetTerritory's
  // comment) — the FIRST team-lead-visible territory (from
  // assignableTerritories, already RLS-scoped) the current user can assign a
  // rep to. UX-only gate (ROLE-02); the direct assign_territory RPC (Plan 01)
  // remains the sole authority regardless of what renders here.
  const assignTargetTerritory = useMemo(
    () => assignableTerritories.find((territory) => isTeamLead(territory.team_id)) ?? null,
    [assignableTerritories, isTeamLead],
  );
  const [showAssignSheet, setShowAssignSheet] = useState(false);

  const territoriesRepoRef = useRef<ReturnType<typeof createTerritoriesRepo> | null>(null);
  useEffect(() => {
    territoriesRepoRef.current = db ? createTerritoriesRepo({ db }) : null;
  }, [db]);

  const territoryDraw = useTerritoryDraw({
    repo: useMemo(
      () => ({
        submitBoundary: (territoryId: string, boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon) => {
          const repo = territoriesRepoRef.current;
          if (!repo) return Promise.reject(new Error('territoriesRepo not ready'));
          return repo.submitBoundary(territoryId, boundary);
        },
      }),
      [],
    ),
    territoryId: drawTargetTerritory?.id ?? '',
    onDone: () => setDrawMode(false),
  });

  // UI-SPEC: tapping a locked (other-rep) territory shows a non-blocking
  // toast, never a full modal — no interactive affordance otherwise.
  const lockedTerritoriesForTapTest = useMemo(
    () =>
      territories.filter(
        (territory) => territory.locked_by !== null && territory.locked_by !== userId,
      ),
    [territories, userId],
  );

  // initialViewState only applies at first mount — on a fresh install the
  // territory arrives from sync AFTER the map mounts, leaving the camera on
  // the world default (black ocean at null island). Follow the bounds once
  // they materialize or change.
  useEffect(() => {
    if (territoryBounds) {
      cameraRef.current?.fitBounds(territoryBounds, {
        padding: { top: 32, right: 32, bottom: 32, left: 32 },
        duration: 0,
      });
    }
  }, [territoryBounds?.join(',')]);

  // The doors, read off the basemap the device already carries.
  //
  // `querySourceFeatures` sees LOADED tiles, so this runs right after the
  // camera has been fitted to the territory bounds above — at that moment the
  // viewport contains the whole territory and its tiles are the ones loaded.
  // A short delay lets the tiles that the fit just requested actually arrive;
  // a query that comes back empty leaves `doors` at null ("unknown"), and the
  // next territory change tries again. It is never wrong, only sometimes
  // late — and a late denominator beats a fabricated one.
  useEffect(() => {
    if (!territoryBounds || !ownTerritory) {
      setDoors(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void basemapSourceRef.current
        ?.querySourceFeatures({ sourceLayer: 'buildings', filter: ['has', 'addr_housenumber'] })
        .then((features) => {
          if (cancelled) return;
          const found = deriveTerritoryDoors(features, ownTerritory.boundary);
          if (found.length > 0) setDoors(found);
        })
        .catch(() => {
          // Tiles not ready, source gone — stays "unknown", never a wrong count.
        });
    }, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [territoryBounds?.join(','), ownTerritory?.id]);

  const cameraCenter = territoryBounds
    ? ([
        (territoryBounds[0] + territoryBounds[2]) / 2,
        (territoryBounds[1] + territoryBounds[3]) / 2,
      ] as [number, number])
    : undefined;

  // Exactly one overlay at a time — these states are mutually exclusive by
  // priority: no territory (nothing else is actionable without one) > map
  // data missing > no houses yet. CR-01: the noTerritory branch consults
  // ownTerritory ALONE — it must never be suppressed by teammate
  // territories/houses existing elsewhere (that was the bug: the old
  // `territories.length === 0` clause let a rep with no own territory see
  // the map instead of the empty state whenever a teammate's territory/
  // houses were already synced down).
  const overlay = deriveMapOverlay({ ownTerritory, tileStatus, housesCount: houses.length });
  // Design SSOT 02/03: bottom street-summary card, live house counts. Hidden
  // while an overlay/sheet/draw mode owns the screen.
  const streetSummary = useMemo(
    () => deriveStreetSummary(houses, unitsByParent),
    [houses, unitsByParent],
  );
  // The same buildings the marker loop renders, ordered for the list. Derived,
  // never a second query — the list cannot show a different world to the map.
  // ── The doors of the territory ────────────────────────────────────────────
  // `null` = not queried yet, which the summary renders as "unknown". Never 0,
  // which would claim the territory has no doors at all.
  const [doors, setDoors] = useState<TerritoryDoor[] | null>(null);
  const basemapSourceRef = useRef<VectorSourceRef>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(ALL_STATUSES_VISIBLE);
  const [filterOpen, setFilterOpen] = useState(false);

  // One rollup per building, computed ONCE. The pin loop and the status filter
  // must never disagree about a building's colour, and the loop used to derive
  // this inline on every render.
  const housesWithRollup = useMemo(
    () =>
      houses.map((house) => ({
        house,
        rollup: deriveBuildingStatus({
          building: house,
          units: unitsByParent.get(house.id) ?? [],
          // blacklist_entries are not watched on this screen; the building's
          // own status is the source the existing UI actually writes (see
          // hasNoSolicitationLock's note).
          noSolicitation: hasNoSolicitationLock([], house.id, house.status),
        }),
      })),
    [houses, unitsByParent],
  );
  const visibleHouses = useMemo(
    () => housesWithRollup.filter((entry) => statusFilter[entry.rollup.status]),
    [housesWithRollup, statusFilter],
  );
  /** A hidden pin must not be tappable either — the filter hides it, fully. */
  const tapTargets = useMemo(() => visibleHouses.map((entry) => entry.house), [visibleHouses]);

  const doorProgress = useMemo(() => deriveDoorProgress(doors, houses), [doors, houses]);

  /** Unfiltered, on purpose: the sheet has to show what a filter is hiding. */
  const statusCounts = useMemo(() => {
    // Typed, not a bare literal: this used to be an untyped object, so adding a
    // status silently produced `undefined + 1` = NaN in the filter sheet
    // instead of a compile error.
    const counts: Record<HouseStatus, number> = {
      new: 0,
      not_home: 0,
      follow_up: 0,
      no_interest: 0,
      success: 0,
      blacklist: 0,
    };
    for (const { rollup } of housesWithRollup) counts[rollup.status] += 1;
    return counts;
  }, [housesWithRollup]);

  const listRows = useMemo(
    () =>
      deriveHouseListRows({ houses, unitsByParent, origin: originFix }).filter(
        // The list is the same set as the map, always — a filter that hid pins
        // but left the list complete would make the two disagree about what
        // exists, which is the one thing this pair must never do.
        (row) => statusFilter[row.status],
      ),
    [houses, unitsByParent, originFix, statusFilter],
  );

  // ── Address search ────────────────────────────────────────────────────────
  // Stage 1 is these three lines: the SAME rows the list renders, filtered on
  // their already-synced addresses. No query, no network, no permission — it
  // works in a cellar with the radio off, which is where the rep usually is.
  const [searchQuery, setSearchQuery] = useState('');
  const localSearchHits = useMemo(
    () => matchLocalRows(listRows, searchQuery),
    [listRows, searchQuery],
  );
  // Stage 2 is opt-in per query: `null` means "the rep has not asked to go
  // online for THIS query yet", which is why editing the field resets it.
  const [remoteHits, setRemoteHits] = useState<(GeocodeHit & { inside: boolean })[] | null>(null);
  const [searchingOnline, setSearchingOnline] = useState(false);
  // The address the camera was sent to. Held ONLY so the rep can then press
  // "Pin setzen" — picking a search hit never writes anything by itself. That
  // is the whole reason to search instead of tapping: surveyed coordinates for
  // the pin, and the decision to drop one at all stays a separate press.
  const [pinCandidate, setPinCandidate] = useState<GeocodeHit | null>(null);
  // Closed by default: the field takes the map's space only while it is in use.
  const [searchOpen, setSearchOpen] = useState(false);


  const flyToPoint = (lat: number, lon: number) => {
    cameraRef.current?.flyTo({
      center: [lon, lat],
      zoom: 17,
      duration: reducedMotion ? 0 : 600,
    });
  };

  const runOnlineSearch = async () => {
    setSearchingOnline(true);
    try {
      const hits = await forwardGeocode(searchQuery, { viewbox: territoryBounds });
      // A hit outside the rep's own territory is kept and LABELLED, never
      // dropped: "that address is not in your area" is a real answer, and it is
      // the one the rep needs before walking there.
      setRemoteHits(
        hits.map((hit) => ({ ...hit, inside: isInsideTerritory(hit, ownTerritory?.boundary) })),
      );
    } finally {
      setSearchingOnline(false);
    }
  };
  // Whether a summary COULD be shown, and whether the rep asked for it.
  //
  // It was permanently visible whenever it had content. On the screen whose
  // entire purpose is the map, a bar that is always there costs its own height
  // AND the lift it forces on every floating control above it. It is now off by
  // default and lives in the tool cluster, next to the other things the rep
  // reaches for rather than reads.
  const summaryAvailable = !!ownTerritory && houses.length > 0 && !drawMode && !sheetTarget;
  const [summaryOpen, setSummaryOpen] = useState(false);
  const summaryVisible = summaryAvailable && summaryOpen;

  const toolCluster = deriveMapToolCluster({
    viewMode,
    drawMode,
    canEnterDrawMode,
    hasAssignTarget: !!assignTargetTerritory,
    hasSummary: summaryAvailable,
    hasSearch: !!ownTerritory,
  });
  const filterActive = isFilterActive(statusFilter);
  const showNoHousesEmptyState = overlay === 'noHouses';
  const showMapDataMissing = overlay === 'mapDataMissing';
  const showNoTerritoryEmptyState = overlay === 'noTerritory';

  // MAP-02: tap on empty map space drops a pin (create mode); tapping an
  // existing HousePin reopens the sheet pre-selected to its current status
  // (edit mode, handled by handleHousePress below). The installed
  // @maplibre/maplibre-react-native version's PressEvent.lngLat is a
  // [longitude, latitude] tuple (LngLat type), not the {lng, lat} object
  // shape RESEARCH.md described for an earlier version.
  const handleMapPress = async (event: NativeSyntheticEvent<PressEvent>) => {
    // React nullifies pooled synthetic events after the handler yields —
    // everything needed must be read BEFORE the first await.
    const { point, lngLat } = event.nativeEvent;

    // MAP-04: while in draw mode, EVERY map tap adds a polygon vertex — this
    // gesture must never overlap with the house-pin tap gesture below
    // (UI-SPEC "mode-toggle control distinct from pin tap").
    if (drawMode) {
      territoryDraw.addVertex(lngLat);
      return;
    }

    // UI-SPEC: a locked (other-rep) territory has no interactive affordance
    // beyond the non-blocking toast — checked before house-pin
    // create/edit so a tap inside someone else's territory never drops a
    // new house pin there.
    const tappedPoint = turfPoint(lngLat);
    if (
      lockedTerritoriesForTapTest.some((territory) => {
        try {
          return booleanPointInPolygon(tappedPoint, territory.boundary);
        } catch {
          return false;
        }
      })
    ) {
      setConflictToast(t('map.lockedTerritoryToast'));
      return;
    }

    // MarkerView/Pressable touches never reach the pin on Android New
    // Architecture — the map wins every touch race. So the map tap itself
    // hit-tests against existing houses in SCREEN space (zoom-independent,
    // same 48dp feel as a real touch target): a tap on/near a pin edits
    // that house instead of stacking a duplicate on top of it.
    //
    // Only the houses within a few hundred metres of the finger are projected.
    // This used to project EVERY house on EVERY tap — one native bridge round
    // trip each, on the screen a rep taps all day. The metric pre-filter is
    // arithmetic on numbers already in memory, so the ones nowhere near the
    // tap cost nothing, and the screen-space test below is unchanged: it still
    // decides the hit, this only decides who gets measured.
    //
    // ponytail: the pins are still one MarkerView each — a native view per
    // house. Migrate to a GeoJSONSource + symbol layer if a territory's pin
    // count grows past a few hundred. Not done here on purpose: the UI-SPEC
    // requires a distinct ICON per status (colourblind safety) plus the open
    // -doors badge, and neither survives a plain circle layer without a
    // sprite sheet that does not exist yet.
    const map = mapRef.current;
    const nearby = tapTargets.length > 0 ? tapCandidates(tapTargets, { lat: lngLat[1], lon: lngLat[0] }) : [];
    if (map && nearby.length > 0) {
      try {
        const projected = await Promise.all(
          nearby.map(async (house) => {
            const [x, y] = await map.project([house.lon, house.lat]);
            return { house, px: Math.hypot(x - point[0], y - point[1]) };
          }),
        );
        const nearest = projected.sort((a, b) => a.px - b.px)[0];
        if (nearest && nearest.px <= 40) {
          setSheetTarget({ mode: 'edit', house: nearest.house });
          return;
        }
      } catch {
        // projection unavailable (map not ready) — fall through to create
      }
    }
    setSheetTarget({ mode: 'create', lngLat });
  };

  const handleHousePress = (house: HouseRow) => {
    setSheetTarget({ mode: 'edit', house });
  };

  return (
    <View
      style={styles.container}
      // The sheet's height cap is computed against THIS box, not the window.
      // The two differ by the tab bar, and that difference is what let the
      // sheet's own exits climb into the status bar.
      onLayout={(event) => setHostHeight(event.nativeEvent.layout.height)}
    >
      <MapView
        ref={mapRef}
        style={styles.map}
        mapStyle={BLANK_STYLE}
        onPress={handleMapPress}
        // The MapLibre wordmark and the native attribution "i" are turned off:
        // both are ornaments the SDK draws in its own visual language, over a
        // surface the rep holds up to a customer. The OpenStreetMap credit that
        // ODbL requires is NOT dropped — it moves into the map help sheet
        // (help.attribution), which is reachable from the "?" button.
        logo={false}
        attribution={false}
      >
        <Camera
          ref={cameraRef}
          initialViewState={cameraCenter ? { center: cameraCenter, zoom: 14 } : { zoom: 5 }}
          trackUserLocation={trackingUser && locationGranted ? 'default' : undefined}
        />
        {locationGranted ? <UserLocation /> : null}

        {tileUrlTemplate ? (
          <VectorSource
            ref={basemapSourceRef}
            id="pmtiles-basemap"
            tiles={[tileUrlTemplate]}
            minzoom={0}
            maxzoom={15}
          >
            <Layer
              id="basemap-earth"
              beforeId="overlay-anchor"
              type="fill"
              source-layer="earth"
              paint={{ 'fill-color': lightColors.mapEarth }}
            />
            <Layer
              id="basemap-landuse"
              beforeId="overlay-anchor"
              type="fill"
              source-layer="landuse"
              paint={{ 'fill-color': lightColors.mapLanduse, 'fill-opacity': 0.7 }}
            />
            <Layer
              id="basemap-water"
              beforeId="overlay-anchor"
              type="fill"
              source-layer="water"
              paint={{ 'fill-color': lightColors.mapWater }}
            />
            <Layer
              id="basemap-buildings"
              beforeId="overlay-anchor"
              type="fill"
              minzoom={14}
              source-layer="buildings"
              paint={{
                'fill-color': lightColors.mapBuilding,
                'fill-outline-color': lightColors.mapBuildingOutline,
              }}
            />
            {/* Casing under the fill gives roads an edge, which is what makes a
                street read as a street rather than a hairline. */}
            <Layer
              id="basemap-roads-casing"
              beforeId="overlay-anchor"
              type="line"
              minzoom={11}
              source-layer="roads"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{
                'line-color': lightColors.mapRoadCasing,
                'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 11, 2, 14, 5, 17, 18],
              }}
            />
            <Layer
              id="basemap-roads-minor"
              beforeId="overlay-anchor"
              type="line"
              source-layer="roads"
              filter={['!=', ['get', 'kind'], 'highway']}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{
                'line-color': lightColors.mapRoadMinor,
                'line-width': [
                  'interpolate',
                  ['exponential', 1.4],
                  ['zoom'],
                  11,
                  1,
                  14,
                  3.5,
                  17,
                  14,
                ],
              }}
            />
            <Layer
              id="basemap-roads-major"
              beforeId="overlay-anchor"
              type="line"
              source-layer="roads"
              filter={['match', ['get', 'kind'], ['highway', 'major_road'], true, false]}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{
                'line-color': lightColors.mapRoadMajor,
                'line-width': [
                  'interpolate',
                  ['exponential', 1.4],
                  ['zoom'],
                  11,
                  1.5,
                  14,
                  5,
                  17,
                  18,
                ],
              }}
            />
            {/* The street NAME on the line. For door-to-door this is the single
                most useful thing on the map, and it was missing entirely. */}
            <Layer
              id="basemap-roads-labels"
              beforeId="overlay-anchor"
              type="symbol"
              minzoom={14}
              source-layer="roads"
              layout={{
                'symbol-placement': 'line',
                'text-field': ['get', 'name'],
                'text-size': 11,
                // Must exist on the Protomaps glyph CDN — the MapLibre default
                // stack (Open Sans/Arial Unicode) is not hosted there.
                'text-font': ['Noto Sans Regular'],
              }}
              paint={{
                'text-color': lightColors.mapLabel,
                'text-halo-color': '#FFFFFF',
                'text-halo-width': 1.4,
              }}
            />
            <Layer
              id="basemap-places"
              beforeId="overlay-anchor"
              type="symbol"
              source-layer="places"
              layout={{
                'text-field': ['get', 'name'],
                'text-size': 12,
                'text-font': ['Noto Sans Regular'],
              }}
              paint={{
                'text-color': lightColors.mapLabel,
                'text-halo-color': '#FFFFFF',
                'text-halo-width': 1.6,
              }}
            />
            {/* House numbers, the one label a rep at a front door actually
                needs. They ride on the SAME buildings layer that is already
                drawn as a fill — the attribute was in the tiles all along
                (`addr_housenumber`), nothing was rendering it.

                From z17 and no lower: at the zoom the screen opens on, an
                entire street's numbers collapse into unreadable mush and bury
                the status pins, which are the actual subject of this map. The
                source tops out at z15 and MapLibre overzooms it, so the
                attribute survives past the extract's own maximum.

                Overlap stays OFF (the default): where numbers collide,
                MapLibre drops some rather than stacking them. A gap is honest;
                two numbers on top of each other are unreadable AND wrong. */}
            <Layer
              id="basemap-housenumbers"
              beforeId="overlay-anchor"
              type="symbol"
              minzoom={17}
              source-layer="buildings"
              filter={['has', 'addr_housenumber']}
              layout={{
                'text-field': ['get', 'addr_housenumber'],
                'text-size': 10,
                'text-font': ['Noto Sans Regular'],
              }}
              paint={{
                'text-color': lightColors.mapLabel,
                'text-halo-color': '#FFFFFF',
                'text-halo-width': 1.4,
              }}
            />
          </VectorSource>
        ) : null}

        {territories.length > 0 ? (
          <GeoJSONSource id="territories" data={territoriesFeatureCollection}>
            <Layer
              id="territory-fill"
              type="fill"
              paint={{
                // Own/assigned territory is BLUE (design screen 02) — amber stays
                // reserved for the one primary CTA per screen (Foundations).
                'fill-color': [
                  'case',
                  ['get', 'isOwn'],
                  lightColors.ownTerritoryOutline,
                  lightColors.lockedTerritoryFill,
                ],
                'fill-opacity': [
                  'case',
                  ['get', 'isOwn'],
                  0.12,
                  lightColors.lockedTerritoryFillOpacity,
                ],
              }}
            />
            <Layer
              id="territory-outline"
              type="line"
              paint={{
                'line-color': [
                  'case',
                  ['get', 'isOwn'],
                  lightColors.ownTerritoryOutline,
                  lightColors.lockedTerritoryOutline,
                ],
                'line-width': 2,
              }}
            />
          </GeoJSONSource>
        ) : null}

        {visibleHouses.map(({ house, rollup }) => {
          return (
            <Marker
              key={house.id}
              id={`house-${house.id}`}
              lngLat={[house.lon, house.lat]}
              onPress={() => handleHousePress(house)}
            >
              <HousePin
                status={rollup.status}
                openUnits={rollup.openUnits}
                allUnitsDone={rollup.hasUnits && rollup.openUnits === 0}
                accessibilityLabel={housePinAccessibilityLabel(house, rollup)}
                onPress={() => handleHousePress(house)}
              />
            </Marker>
          );
        })}

        {drawMode ? (
          <TerritoryDrawLayer
            vertices={territoryDraw.vertices}
            draftFeature={territoryDraw.draftFeature}
          />
        ) : null}
      </MapView>

      <StatusBarScrim insetTop={insets.top} tone={colors.background} styles={styles} />

      {/* The synced state is what the app is in essentially always, and a full
          pill spelling that out sat across the top of the map permanently,
          costing prime screen space to say "nothing to report". Synced now
          renders as a bare dot; the pill expands with its label only for
          pending/offline, the two states that actually tell the rep something.
          The label stays on the accessibility node either way, so a screen
          reader hears the state even when the dot is silent. */}
      <View
        style={[
          syncState === 'synced' ? styles.syncDotOnly : styles.syncPill,
          // Clears the scrim's FULL extent, not just the inset. The old value
          // put this pill's top edge on the last pixel of the fade, which is
          // why it read as sitting in the status bar.
          { top: mapChromeTop(insets.top, spacing.sm) },
        ]}
        accessibilityRole="text"
        accessibilityLabel={t(syncPillKey(syncState))}
      >
        <View
          style={[
            styles.syncDot,
            syncState === 'synced' ? styles.syncDotBare : null,
            {
              backgroundColor: syncState === 'synced' ? statusColor.success : statusColor.follow_up,
            },
          ]}
        />
        {syncState === 'synced' ? null : (
          <Text style={styles.syncPillText}>{t(syncPillKey(syncState))}</Text>
        )}
      </View>

      {/* SEC-10/D-16: the persistent tenant-identity chrome — same top
          overlay row as the sync pill above, anchored independently on the
          left edge so the two never overlap. */}
      <View style={[styles.tenantBadgeContainer, { top: insets.top + spacing.mapEdgeMargin }]}>
        <TenantBadge ready={tenantIdentity.ready} tenantName={tenantIdentity.tenantName} />
      </View>

      {/* Only over the live map, and only with a territory to search: the list
          overlay owns the whole viewport, and draw mode owns every tap. */}
      {searchOpen && viewMode === 'map' && !drawMode && ownTerritory ? (
        <MapSearchField
          // Below the sync pill / tenant badge row, never on top of it.
          top={mapChromeTop(insets.top, spacing.sm) + spacing.touchTarget}
          query={searchQuery}
          onQueryChange={(next) => {
            setSearchQuery(next);
            setRemoteHits(null);
          }}
          localHits={localSearchHits}
          onSelectHouse={(houseId) => {
            const house = houses.find((row) => row.id === houseId);
            if (!house) return;
            flyToPoint(house.lat, house.lon);
            handleHousePress(house);
            setSearchQuery('');
          }}
          online={syncState !== 'offline'}
          searching={searchingOnline}
          remoteHits={remoteHits}
          onSearchOnline={() => void runOnlineSearch()}
          onSelectRemote={(hit) => {
            flyToPoint(hit.lat, hit.lon);
            setSearchQuery('');
            setRemoteHits(null);
            setPinCandidate(hit);
          }}
          pinCandidate={pinCandidate}
          onClose={() => {
            setSearchOpen(false);
            setRemoteHits(null);
            setPinCandidate(null);
          }}
          onPlacePin={() => {
            // The searched address is handed to the sheet, so the pin carries
            // it from the first write — no second Nominatim call for a place
            // that was just geocoded.
            if (!pinCandidate) return;
            setSheetTarget({
              mode: 'create',
              lngLat: [pinCandidate.lon, pinCandidate.lat],
              address: pinCandidate.label,
            });
            setPinCandidate(null);
          }}
          onDismissCandidate={() => setPinCandidate(null)}
        />
      ) : null}

      {/* The dock, not the card: it reserves the bottom-LEFT corner and stops
          short of the floating-control column, so a card sized to its own
          content can never reach the buttons. `alignItems: flex-start` is what
          keeps the card content-width instead of full-bleed — the full-bleed
          bar is what made this collide in the first place. */}
      {summaryVisible ? (
        <View style={styles.summaryDock} pointerEvents="box-none">
          <StreetSummaryCard
            title={ownTerritory?.name || t('map.summaryFallbackTitle')}
            summary={streetSummary}
            doorProgress={doorProgress}
            reducedMotion={reducedMotion}
            styles={styles}
            iconColor={colors.textSecondary}
          />
        </View>
      ) : null}

      <InfoSheet
        visible={showHelp}
        onClose={() => setShowHelp(false)}
        title={t('help.mapTitle')}
        subtitle={t('help.mapSubtitle')}
        testID="map-help-sheet"
      >
        <InfoSheetSection heading={t('help.legendHeading')}>
          {buildStatusLegend().map((entry) => (
            <InfoLegendRow
              key={entry.status}
              dotColor={entry.color}
              iconName={entry.iconName}
              label={entry.label}
              meaning={entry.meaning}
            />
          ))}
        </InfoSheetSection>
        <InfoSheetSection heading={t('help.mapUsageHeading')} body={t('help.mapUsageBody')} />
        <InfoSheetSection heading={t('help.attributionHeading')} body={t('help.attributionBody')} />
      </InfoSheet>

      {/* Map chrome is deliberately minimal — the redundant top-right document
          (Abschlüsse) and wallet (Provisionen) affordances were removed: the
          "Abschlüsse" bottom tab is the canonical contract-list path and the
          Wallet lives under Profil → "Meine Provisionen". The map keeps only
          genuinely map-relevant controls (sync pill, "?" help, recenter, draw).
          The contract list stays reachable in-app via the checkout success
          screen's forward seam (onViewContracts → showContractList overlay). */}

      {drawMode ? (
        <TerritoryDrawControls
          canAssign={territoryDraw.canAssign}
          showDiscardConfirm={territoryDraw.showDiscardConfirm}
          onAssign={() => void territoryDraw.assign()}
          onUndo={territoryDraw.undo}
          onRequestDiscard={territoryDraw.requestDiscard}
          onCancelDiscard={territoryDraw.cancelDiscard}
          onConfirmDiscard={territoryDraw.confirmDiscard}
        />
      ) : null}

      {conflictToast ? (
        <View
          style={[styles.toast, { bottom: insets.bottom + spacing['2xl'] + spacing.touchTarget }]}
          pointerEvents="none"
        >
          <Text style={styles.toastText}>{conflictToast}</Text>
        </View>
      ) : null}

      {showNoHousesEmptyState ? (
        <EmptyStateOverlay
          heading={t('emptyState.noHousesHeading')}
          body={t('emptyState.noHousesBody')}
          styles={styles}
        />
      ) : null}

      {showMapDataMissing ? (
        <EmptyStateOverlay
          heading={t('errorState.mapDataMissingHeading')}
          body={t('errorState.mapDataMissingBody')}
          styles={styles}
        />
      ) : null}

      {showNoTerritoryEmptyState ? (
        <EmptyStateOverlay
          heading={t('emptyState.noTerritoryHeading')}
          body={t('emptyState.noTerritoryBody')}
          styles={styles}
        />
      ) : null}

      {showAssignSheet && db && assignTargetTerritory ? (
        <AssignRepSheet
          visible
          onClose={() => setShowAssignSheet(false)}
          db={db}
          territoryId={assignTargetTerritory.id}
          teamId={assignTargetTerritory.team_id}
          onToast={setConflictToast}
        />
      ) : null}

      {showContractList && db ? (
        <View style={styles.fullScreenOverlay} testID="contract-list-overlay">
          <ContractListScreen
            db={db}
            onClose={() => setShowContractList(false)}
            onOpenDetail={setDetailContractId}
          />
        </View>
      ) : null}

      {detailContractId && db ? (
        <View style={styles.fullScreenOverlay} testID="abschluss-detail-overlay">
          <AbschlussDetailView
            db={db}
            contractId={detailContractId}
            onBack={() => setDetailContractId(null)}
          />
        </View>
      ) : null}

      {/* The list is an overlay ON TOP of the untouched map, never a
          replacement for it. A row tap opens the same StatusSheet a pin tap
          opens, through the same handleHousePress — and the sheet is rendered
          LAST below, so it paints above this overlay on iOS too. */}
      {viewMode === 'list' ? (
        <View style={styles.fullScreenOverlay} testID="house-list-overlay">
          <HouseListView
            rows={listRows}
            hasFix={originFix !== null}
            onSelect={(houseId) => {
              const house = houses.find((row) => row.id === houseId);
              if (house) handleHousePress(house);
            }}
          />
        </View>
      ) : null}

      {/* The five floating controls are one cluster now (defect 5). It is
          rendered after the list overlay so its list-mode member — the map/list
          toggle, the only way back out of that overlay — stays reachable above
          it, and BEFORE the sheet below, whose backdrop must not be painted
          over on iOS. `deriveMapToolCluster` decides what exists and whether a
          disclosure trigger is warranted at all; this call site only supplies
          the state and the two column offsets. */}
      <MapToolCluster
        cluster={toolCluster}
        viewMode={viewMode}
        reducedMotion={reducedMotion}
        anchorBottom={mapControlBottom({ index: 0 })}
        stackBottom={mapControlBottom({ index: 1 })}
        onRecenter={() => void requestLocationAndTrack()}
        onToggleViewMode={() => setViewMode((mode) => (mode === 'map' ? 'list' : 'map'))}
        onHelp={() => setShowHelp(true)}
        onToggleSummary={() => setSummaryOpen((open) => !open)}
        summaryOpen={summaryVisible}
        onToggleSearch={() =>
          setSearchOpen((open) => {
            // Closing drops the query and the parked address with it — reopening
            // starts clean rather than resuming yesterday's search.
            if (open) {
              setSearchQuery('');
              setRemoteHits(null);
              setPinCandidate(null);
            }
            return !open;
          })
        }
        searchOpen={searchOpen}
        onOpenFilter={() => setFilterOpen(true)}
        filterActive={filterActive}
        onEnterDrawMode={() => setDrawMode(true)}
        onAssignRep={() => setShowAssignSheet(true)}
      />

      <MapFilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        filter={statusFilter}
        onChange={setStatusFilter}
        counts={statusCounts}
      />

      {/* LAST overlay child, deliberately. On iOS paint order follows JSX order,
          and the map/list toggle above used to render after the sheet: harmless
          while the sheet had no backdrop, but a real defect now — a tap aimed at
          the backdrop near the bottom right would have hit the toggle instead.
          Anything added to this return goes BEFORE this block. */}
      {sheetTarget && db && userId && ownTerritory ? (
        <StatusSheet
          // The success screen's "Meine Abschluesse" CTA. The whole chain —
          // SuccessScreen -> DirectSignFlowScreen/FlowRunnerScreen ->
          // ConsultationFlow -> StatusSheet — already carried this prop, and
          // nothing ever supplied it, so the button simply never appeared. The
          // opener it needs has been sitting right here since 04-08
          // (`setShowContractList`, exposed to the host at :235).
          // Closing the sheet is HALF THE ACTION, not tidiness. The contract
          // list is a plain overlay View (:1309); StatusSheet is a fullScreen
          // Modal, and a Modal renders above sibling views whatever the tree
          // order. Setting showContractList alone mounted the list BEHIND the
          // success screen, so the CTA looked dead while doing exactly what it
          // was told. The contract is persisted and syncing by the time this
          // screen exists, so dismissing the flow here loses nothing — it is
          // the same exit onDismiss performs.
          onViewContracts={() => {
            setSheetTarget(null);
            setShowContractList(true);
          }}
          availableHeight={hostHeight}
          visible
          db={db}
          teamId={ownTerritory.team_id}
          createdBy={userId}
          target={sheetTarget}
          onDismiss={() => setSheetTarget(null)}
        />
      ) : null}
    </View>
  );
}

/**
 * Map empty/error states float over the LIVE map (pointerEvents none), so they
 * use a compact centred card rather than the full-screen shared EmptyState
 * component (which owns the whole viewport for the list screens). Same paper /
 * Ink-Navy / muted-body language, driven by the same tokens.
 */
function EmptyStateOverlay({
  heading,
  body,
  styles,
}: {
  heading: string;
  body: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.emptyState} pointerEvents="none">
      <View style={styles.emptyStateCard}>
        <Text style={styles.emptyStateHeading}>{heading}</Text>
        <Text style={styles.emptyStateBody}>{body}</Text>
      </View>
    </View>
  );
}

/**
 * Defect 4: over light map tiles the system clock (dark glyphs in light mode,
 * per RootNavigator's `StatusBar style`) becomes unreadable. A scrim in the
 * theme's own background tone restores the contrast in BOTH appearances with
 * one piece of code: light paper under dark glyphs, dark tone under light ones.
 *
 * It is a translucent, non-interactive overlay drawn OVER the MapLibre view —
 * the map keeps its full extent and is never clipped, so nothing about tile
 * rendering or gesture handling changes. `expo-linear-gradient` is not a
 * dependency here, so the gradient is a short stack of decreasing-opacity
 * bands (see `deriveStatusBarScrimBands`).
 */
function StatusBarScrim({
  insetTop,
  tone,
  styles,
}: {
  insetTop: number;
  tone: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  const bands = deriveStatusBarScrimBands(insetTop);
  if (bands.length === 0) return null;
  return (
    <View style={styles.statusBarScrim} pointerEvents="none" testID="map-status-bar-scrim">
      {bands.map((band, index) => (
        <View
          key={`scrim-${index}`}
          style={{ height: band.height, opacity: band.opacity, backgroundColor: tone }}
        />
      ))}
    </View>
  );
}

/** Restores a >= 48dp effective touch target on the condensed toggle row. */
const SUMMARY_TOGGLE_HIT_SLOP = {
  top: spacing.sm,
  bottom: spacing.sm,
  left: spacing.sm,
  right: spacing.sm,
};

/** Min vertical drag (dp) before the summary card claims the gesture as a drag
 * (below this, a touch is a tap that toggles via the Pressable). */
const SUMMARY_DRAG_CLAIM = 6;
/** Drag distance (dp) past which releasing commits the expand/collapse. */
const SUMMARY_DRAG_THRESHOLD = 20;

/**
 * Design SSOT 02/03 bottom street-summary card — now COLLAPSIBLE so it no
 * longer eats vertical space over the map by default. One `Animated.Value`
 * (`progress`: 0 = peek, 1 = expanded) drives both states:
 *  - Peek (default): a single compact line — territory name + a tiny coloured
 *    stat-glyph row (dot + count, no words). Short enough to never cover the map.
 *  - Expanded: the same header plus the full labeled "N besucht · M offen ·
 *    K Abschlüsse" stats row, revealed with an ease-out height/opacity
 *    transition (INSTANT when the OS "Reduce Motion" setting is on).
 *
 * Toggle by tapping the header or dragging it up (expand) / down (collapse).
 * The card is interactive now (no longer pointerEvents="none"). The three
 * counts + colours mirror the previous card exactly (visited = new-hue,
 * open = follow-up-hue, deals = success-hue). No "Heute" chip: the house
 * status rows carry no timestamp, so the counts are all-time.
 */
function StreetSummaryCard({
  title,
  summary,
  doorProgress,
  reducedMotion,
  styles,
  iconColor,
}: {
  title: string;
  summary: StreetSummary;
  /** Doors read off the basemap — the denominator the counts belong to. */
  doorProgress: DoorProgress;
  reducedMotion: boolean;
  styles: ReturnType<typeof makeStyles>;
  iconColor: string;
}) {
  const [expanded, setExpanded] = useState(false);
  // Natural height of the expanded detail, measured off-screen so the reveal
  // animates to a real px value instead of a magic number.
  const [detailHeight, setDetailHeight] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;

  const animateTo = useCallback(
    (next: boolean) => {
      setExpanded(next);
      Animated.timing(progress, {
        toValue: next ? 1 : 0,
        duration: reducedMotion ? 0 : 220,
        easing: Easing.out(Easing.cubic),
        // Height + layout opacity are not supported by the native driver.
        useNativeDriver: false,
      }).start();
    },
    [progress, reducedMotion],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Claim the gesture ONLY for a deliberate vertical drag — a plain tap
        // (no movement) falls through to the Pressable's onPress toggle.
        onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dy) > SUMMARY_DRAG_CLAIM,
        onPanResponderRelease: (_evt, gesture) => {
          if (gesture.dy <= -SUMMARY_DRAG_THRESHOLD) animateTo(true);
          else if (gesture.dy >= SUMMARY_DRAG_THRESHOLD) animateTo(false);
        },
      }),
    [animateTo],
  );

  const detailAnimatedStyle = {
    height:
      detailHeight > 0
        ? progress.interpolate({ inputRange: [0, 1], outputRange: [0, detailHeight] })
        : 0,
    opacity: progress,
  };
  const peekOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const chevronRotate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  return (
    <Animated.View
      style={styles.summaryCard}
      testID="map-street-summary"
      {...panResponder.panHandlers}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={t(expanded ? 'map.summaryCollapseLabel' : 'map.summaryExpandLabel')}
        onPress={() => animateTo(!expanded)}
        // The visual row is now shorter than 48dp, so the EFFECTIVE target is
        // restored with hitSlop (the ScreenScaffold back-button technique)
        // rather than a minHeight, which would simply undo the condensation.
        hitSlop={SUMMARY_TOGGLE_HIT_SLOP}
        testID="map-street-summary-toggle"
      >
        {/* The counts ARE the content and they lead now. The territory name
            used to take the widest run of the widest element on the screen to
            say something a rep with one territory already knows; it belongs to
            the expanded state, where there is room for a heading. */}
        <View style={styles.summaryTopRow}>
          {/* The one number a rep on a street wants: how much is left. It only
              exists once the buildings layer has been read — until then the
              card says so rather than printing a fraction of an unknown. */}
          <Animated.View style={[styles.summaryPeekStats, { opacity: peekOpacity }]}>
            <Text style={styles.summaryDoors} numberOfLines={1}>
              {doorProgress.total === null || doorProgress.open === null
                ? t('map.summaryDoorsUnknown')
                : t('map.summaryDoorsOpen')
                    .replace('{open}', String(doorProgress.open))
                    .replace('{total}', String(doorProgress.total))}
            </Text>
          </Animated.View>
          <Animated.View style={[styles.summaryPeekStats, { opacity: peekOpacity }]}>
            <SummaryGlyph dotColor={statusColor.new} count={summary.visited} styles={styles} />
            <SummaryGlyph dotColor={statusColor.follow_up} count={summary.open} styles={styles} />
            <SummaryGlyph dotColor={statusColor.success} count={summary.deals} styles={styles} />
          </Animated.View>
          <Animated.View style={{ transform: [{ rotate: chevronRotate }] }}>
            <MaterialCommunityIcons name="chevron-up" size={20} color={iconColor} />
          </Animated.View>
        </View>
      </Pressable>

      <Animated.View style={[styles.summaryDetail, detailAnimatedStyle]}>
        <Text style={styles.summaryTitle} numberOfLines={1}>
          {title}
        </Text>
        <SummaryStatsRow summary={summary} styles={styles} />
      </Animated.View>

      {/* Off-screen measuring copy: reports the detail's natural height via
          onLayout so the reveal animates to a real px value. Inert + invisible. */}
      <View
        style={styles.summaryMeasure}
        pointerEvents="none"
        onLayout={(event) => setDetailHeight(event.nativeEvent.layout.height)}
      >
        <SummaryStatsRow summary={summary} styles={styles} />
      </View>
    </Animated.View>
  );
}

/** The full labeled stats row (expanded state + the measuring copy). */
function SummaryStatsRow({
  summary,
  styles,
}: {
  summary: StreetSummary;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.summaryStatsRow}>
      <SummaryStat
        dotColor={statusColor.new}
        label={t('map.summaryVisited').replace('{count}', String(summary.visited))}
        styles={styles}
      />
      <SummaryStat
        dotColor={statusColor.follow_up}
        label={t('map.summaryOpen').replace('{count}', String(summary.open))}
        styles={styles}
      />
      <SummaryStat
        dotColor={statusColor.success}
        label={t('map.summaryDeals').replace('{count}', String(summary.deals))}
        styles={styles}
      />
    </View>
  );
}

function SummaryStat({
  dotColor,
  label,
  styles,
}: {
  dotColor: string;
  label: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.summaryStat}>
      <View style={[styles.summaryDot, { backgroundColor: dotColor }]} />
      <Text style={styles.summaryStatText}>{label}</Text>
    </View>
  );
}

/** Compact peek glyph: a coloured status dot + its count, no label word. */
function SummaryGlyph({
  dotColor,
  count,
  styles,
}: {
  dotColor: string;
  count: number;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.summaryGlyph}>
      <View style={[styles.summaryDot, { backgroundColor: dotColor }]} />
      <Text style={styles.summaryGlyphText}>{count}</Text>
    </View>
  );
}

/**
 * CR-01: derives which (if any) full-screen empty-state overlay to show.
 * Deliberately consults `ownTerritory` ALONE for the noTerritory branch —
 * never `territories.length`/`housesCount` — so a rep with no own territory
 * always sees the empty state, even if teammate territories/houses are
 * already synced down (the exact regression this function fixes).
 */
export function deriveMapOverlay(params: {
  ownTerritory: unknown | null;
  tileStatus: PmtilesFileStatus;
  housesCount: number;
}): 'noTerritory' | 'mapDataMissing' | 'noHouses' | null {
  const { ownTerritory, tileStatus, housesCount } = params;
  return !ownTerritory && tileStatus !== 'loading'
    ? 'noTerritory'
    : tileStatus === 'missing'
      ? 'mapDataMissing'
      : tileStatus === 'ready' && housesCount === 0 && !!ownTerritory
        ? 'noHouses'
        : null;
}

/**
 * MAP-04 draw-mode role gate (ROLE-01): a team lead may enter draw mode for
 * their own assigned-but-undrawn territory; a plain rep never can, even for
 * their own team's territory — the draw toggle itself must not exist as a
 * dead-end for a rep. Pure so it is unit-testable without rendering
 * MapScreen or PowerSync (mirrors deriveMapOverlay above); the real
 * authority remains the create_territory_boundary RPC server-side (UX-only
 * gate, ROLE-02).
 */
export function deriveCanEnterDrawMode(
  drawTargetTerritory: { team_id: string } | null,
  isTeamLead: (teamId: string) => boolean,
): boolean {
  return isTeamLead(drawTargetTerritory?.team_id ?? '') && !!drawTargetTerritory;
}

export interface StreetSummary {
  visited: number;
  open: number;
  deals: number;
}

/**
 * Design SSOT 02/03 street-summary counts from the live local house rows:
 * visited = any house whose status left 'new'; open = still 'new'; deals =
 * status 'success' (a highlighted subset of visited). Pure/exported. Real data
 * only — never invented (CLAUDE.md no-fakes).
 */
export function deriveStreetSummary(
  houses: HouseRow[],
  unitsByParent?: Map<string, HouseRow[]>,
): StreetSummary {
  let visited = 0;
  let open = 0;
  let deals = 0;
  const count = (row: Pick<HouseRow, 'status'>) => {
    if (row.status === 'new') open += 1;
    else visited += 1;
    if (row.status === 'success') deals += 1;
  };
  for (const house of houses) {
    // 0088: the summary counts DOORS. A building with parties contributes its
    // parties and is never counted a second time on top of them; a building
    // without parties is itself the door, exactly as before.
    const units = unitsByParent?.get(house.id);
    if (units && units.length > 0) {
      for (const unit of units) count(unit);
    } else {
      count(house);
    }
  }
  return { visited, open, deals };
}

/**
 * The pin's spoken label. Without parties this is WORD FOR WORD what it was
 * before 0088 (asserted in MapScreen.test.tsx) — the demo stock must not start
 * saying something new. With parties, the derived status is spoken and the
 * number of open doors is appended, from the rollup rather than the row.
 */
export function housePinAccessibilityLabel(house: HouseRow, rollup?: BuildingRollup): string {
  if (!rollup || !rollup.hasUnits) {
    return t(`status.${house.status}` as Parameters<typeof t>[0]);
  }
  const statusLabel = t(`status.${rollup.status}` as Parameters<typeof t>[0]);
  if (rollup.openUnits !== null && rollup.openUnits > 0) {
    // t() has no interpolation; the placeholder is replaced at the call site
    // (the map.summaryOpen pattern).
    return `${statusLabel}, ${t('map.pinOpenUnits').replace('{count}', String(rollup.openUnits))}`;
  }
  return `${statusLabel}, ${t('map.pinAllUnitsDone')}`;
}

export function syncPillKey(state: 'synced' | 'pending' | 'offline'): Parameters<typeof t>[0] {
  return `syncPill.${state}` as Parameters<typeof t>[0];
}

/** Shared by the map overlay and the empty-state gate so the two cannot disagree. */
export function isOwnTerritory(
  territory: Pick<TerritoryRow, 'assigned_rep_id' | 'locked_by'>,
  userId: string | null,
): boolean {
  if (userId === null) return false;
  if (territory.assigned_rep_id !== null) return territory.assigned_rep_id === userId;
  return territory.locked_by !== null && territory.locked_by === userId;
}

export function territoriesToFeatureCollection(
  territories: TerritoryRow[],
  userId: string | null,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: territories.map((territory) => ({
      type: 'Feature',
      id: territory.id,
      geometry: territory.boundary,
      // Same precedence as ownTerritory above: the lead-granted assignment
      // first, the transient claim lock only as a fallback. Colouring a
      // territory "someone else's" while the rep is standing in it, because the
      // fact was read off the wrong column, is the visible half of the same bug.
      properties: { isOwn: isOwnTerritory(territory, userId) },
    })),
  };
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1 },
    map: { flex: 1 },
    syncPill: {
      position: 'absolute',
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      paddingVertical: spacing.xs + 2,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      elevation: 3,
      shadowColor: colors.ink,
      shadowOpacity: 0.28,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 },
    },
    syncDotOnly: {
      position: 'absolute',
      alignSelf: 'center',
      backgroundColor: colors.surface,
      padding: spacing.xs + 1,
      borderRadius: radius.pill,
      elevation: 3,
      shadowColor: colors.ink,
      shadowOpacity: 0.28,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 },
    },
    syncDot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.sm - 2 },
    syncDotBare: { marginRight: 0 },
    syncPillText: { ...typography.label, fontWeight: '600', color: colors.textSecondary },
    statusBarScrim: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
    },
    tenantBadgeContainer: {
      position: 'absolute',
      left: spacing.mapEdgeMargin,
    },
    fullScreenOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.background,
      // BEIDE, und zwar absichtlich: `elevation` wirkt nur auf Android. Auf iOS
      // entscheidet allein die JSX-Reihenfolge, und MapToolCluster wird SPAETER
      // gerendert — die schwebenden Kartenknoepfe lagen also ueber der
      // Abschlussliste, genau auf dem Weg, den der Berater direkt nach einem
      // Abschluss nimmt. Aufgeklappt schluckte ihr Hintergrund zusaetzlich die
      // Tipps auf die Liste darunter.
      elevation: 10,
      zIndex: 10,
    },
    toast: {
      position: 'absolute',
      left: spacing.lg,
      right: spacing.lg,
      alignSelf: 'center',
      backgroundColor: colors.ink,
      borderRadius: radius.input,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.md,
      elevation: 6,
    },
    toastText: { ...typography.body, color: colors.onAccent, textAlign: 'center' },
    emptyState: {
      position: 'absolute',
      top: '38%',
      left: spacing.lg,
      right: spacing.lg,
      alignItems: 'center',
    },
    emptyStateCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: spacing.lg,
      paddingHorizontal: spacing.lg,
      alignItems: 'center',
      shadowColor: colors.ink,
      shadowOpacity: 0.18,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
      elevation: 3,
    },
    emptyStateHeading: { ...typography.heading, textAlign: 'center', color: colors.textPrimary },
    emptyStateBody: {
      ...typography.body,
      textAlign: 'center',
      color: colors.textSecondary,
      marginTop: spacing.sm,
    },
    // Reserves the bottom-left corner and stops one control column short of
    // the right edge, so whatever the card grows to it cannot reach the
    // floating buttons. box-none: the map keeps every tap the card does not.
    summaryDock: {
      position: 'absolute',
      left: spacing.mapEdgeMargin,
      right: spacing.mapEdgeMargin + MAP_CONTROL_SIZE + spacing.sm,
      bottom: MAP_CHROME_BOTTOM,
      alignItems: 'flex-start',
    },
    summaryCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: colors.border,
      // Defect 2: the collapsed card is a BAR, not a card that owns the
      // screen. Padding drops one step and the title drops from heading to a
      // 600-weight body — a recombination of existing tokens, not a new
      // primitive — taking the collapsed content box from ~56dp to ~38-40dp.
      // The border, radius.card corner and shadow deliberately STAY: they are
      // what separates the card from the map tiles underneath, exactly like the
      // pin ring in the pin work.
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      shadowColor: colors.ink,
      shadowOpacity: 0.18,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
      elevation: 4,
    },
    summaryTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    summaryTitle: {
      ...typography.body,
      fontWeight: '600',
      color: colors.textPrimary,
      marginBottom: spacing.xs,
    },
    summaryDoors: { ...typography.label, fontWeight: '600', color: colors.textPrimary },
    // Peek (collapsed) compact glyph row: dot + count, no label words.
    // flexShrink 0: on the narrowest phone (320pt - 2x mapEdgeMargin = 288pt of
    // content) the three glyphs + the 20dp chevron + gaps stay well under half
    // the row, so the counters are never compressed and the title truncates
    // instead. No information is lost collapsed — all three numbers stay on
    // screen, and the expanded labelled row is untouched.
    summaryPeekStats: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm + 2,
      flexShrink: 0,
    },
    summaryGlyph: { flexDirection: 'row', alignItems: 'center' },
    summaryGlyphText: { ...typography.label, fontWeight: '700', color: colors.textPrimary },
    // Expanded detail wrapper — clipped to the animated height during the reveal.
    summaryDetail: { overflow: 'hidden' },
    // Off-screen measuring copy: laid out at natural size, never visible/tappable.
    summaryMeasure: { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 },
    summaryStatsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.md,
      paddingTop: spacing.sm + 2,
    },
    summaryStat: { flexDirection: 'row', alignItems: 'center' },
    summaryDot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.xs + 1 },
    summaryStatText: { ...typography.label, fontWeight: '600', color: colors.textPrimary },
  });
}
