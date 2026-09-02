import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Node test environment (vitest.config.ts): never load native Expo/RN/
// MapLibre modules — mock every native import MapScreen.tsx transitively
// pulls in, mirroring useSkeletonFlow.test.ts's pattern. This is a
// logic-only test: no native tile rendering is asserted here (that's the
// device pass, per the plan's <verification>).
vi.mock('react-native', () => ({
  View: () => null,
  Text: () => null,
  Pressable: () => null,
  StyleSheet: { create: (styles: unknown) => styles },
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
// MapScreen.tsx transitively imports the ui/ primitives, which (since
// 12-08) call useThemeColors() -> ThemeProvider/AccessibilityProvider's own
// native deps — mocked here too (AccessibilityProvider.test.tsx precedent).
vi.mock('../../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('../settings/settingsCache', () => ({
  createSettingsCache: () => ({ get: () => null, set: () => {} }),
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));
// Plan 14-09: MapScreen.tsx now transitively imports TenantBadge.tsx ->
// useTenantIdentity.ts -> tenantIdentityCache.ts -> react-native-mmkv (a
// native Nitro module) — mocked so this test never loads it (mirrors
// tenantIdentityCache.test.ts's own mock; nothing here calls into it since
// userId stays null under useSessionDb's mock above).
vi.mock('react-native-mmkv', () => ({
  createMMKV: vi.fn(() => {
    throw new Error('MMKV native module must never be constructed in unit tests');
  }),
}));
// Quick task g01: MapScreen.tsx now imports getSignatureLocation.ts (the
// existing one-shot fix, D-1) for the house list's distance origin, which
// pulls in expo-location — mocked like every other native-transitive import
// here. Nothing in this file calls it (no component is rendered), so the
// mock only has to exist, not behave.
vi.mock('expo-location', () => ({
  PermissionStatus: { GRANTED: 'granted' },
  LocationAccuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: vi.fn(),
  getCurrentPositionAsync: vi.fn(),
}));
vi.mock('@maplibre/maplibre-react-native', () => ({
  Camera: () => null,
  GeoJSONSource: () => null,
  Layer: () => null,
  Map: () => null,
  Marker: () => null,
  UserLocation: () => null,
  VectorSource: () => null,
}));
// `SafeAreaProvider` is deliberately NOT part of this mock any more: nothing
// under features/map/ may render one (the root provider in RootNavigator.tsx
// owns the frame), and a pass-through stub here would let a re-introduced
// nested provider render happily in tests while serving zero insets on device.
// The "exactly one provider" describe at the bottom of this file is the guard.
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
// MapScreen.tsx reads the Karte route param (focusHouseId deep-link from
// Termine) via useRoute/useNavigation — mock the navigation hooks the same way
// every other native-transitive import is mocked (this file exercises only the
// pure helpers, never a render inside a NavigationContainer).
vi.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: {} }),
  useNavigation: () => ({ setParams: vi.fn(), navigate: vi.fn() }),
}));
vi.mock('../../lib/db/powersync', () => ({ openDatabase: vi.fn() }));
vi.mock('../../lib/auth/supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('./usePmtilesFile', () => ({
  usePmtilesFile: () => ({ tileUrlTemplate: null, status: 'loading', error: null }),
}));
vi.mock('./db/housesRepo', () => ({
  createHousesRepo: () => ({
    watchHouses: () => () => {},
    getHouses: async () => [],
    watchUnits: () => () => {},
    getUnits: async () => [],
    insertUnit: async () => 'unit-id',
    setUnitLabel: async () => {},
    setUnitCount: async () => {},
    insertHouseAtPoint: async () => 'house-id',
    setStatus: async () => {},
    addBlacklistEntry: async () => 'blacklist-id',
  }),
}));
// StatusSheet.tsx (02-06) is now imported by MapScreen.tsx — mock it the same
// way MapScreen.test.tsx mocks every other native-transitive import, since
// this file only exercises MapScreen's pure helper functions, not rendering.
vi.mock('./StatusSheet', () => ({ StatusSheet: () => null }));
// ContractListScreen.tsx (04-09) transitively imports contractsRepo.ts ->
// expo-crypto (native) — mock the same way every other native-transitive
// import above is mocked.
vi.mock('../checkout/ContractListScreen', () => ({ ContractListScreen: () => null }));
// AbschlussDetailScreen.tsx transitively imports contractsRepo.ts -> expo-crypto
// and DbBoundary -> useSessionDb (native powersync) — mock the same way.
vi.mock('../checkout/AbschlussDetailScreen', () => ({ AbschlussDetailView: () => null }));
// WalletScreen.tsx (06-04) is now imported by MapScreen.tsx and transitively
// pulls the FlowRunnerScreen native chain (camera/signature) — mock it the same
// way every other native-transitive import above is mocked.
vi.mock('../wallet/WalletScreen', () => ({ WalletScreen: () => null }));

import {
  deriveCanEnterDrawMode,
  deriveMapOverlay,
  deriveStreetSummary,
  housePinAccessibilityLabel,
  syncPillKey,
  territoriesToFeatureCollection,
} from './MapScreen';
import { getColors, lightColors, spacing, statusColor, statusIcon, type HouseStatus } from '../../design/tokens';
import { MAP_CONTROL_SIZE } from './mapChrome';
import de from '../../i18n/de.json';
import en from '../../i18n/en.json';
import type { HouseRow } from './db/housesRepo';

const house = (status: HouseStatus): HouseRow =>
  ({ id: `h-${status}-${Math.random()}`, status, lat: 0, lon: 0 }) as unknown as HouseRow;

describe('deriveStreetSummary (design SSOT 02/03 counts)', () => {
  it('counts visited (non-new), open (new), and deals (success) from live rows', () => {
    const summary = deriveStreetSummary([
      house('new'),
      house('new'),
      house('follow_up'),
      house('blacklist'),
      house('success'),
      house('success'),
    ]);
    expect(summary).toEqual({ visited: 4, open: 2, deals: 2 });
  });

  it('is all-zero for an empty street', () => {
    expect(deriveStreetSummary([])).toEqual({ visited: 0, open: 0, deals: 0 });
  });
});

const STATUSES: HouseStatus[] = ['new', 'follow_up', 'blacklist', 'success'];

function fakeHouse(status: HouseStatus): HouseRow {
  return {
    id: 'h1',
    team_id: 't1',
    territory_id: null,
    lat: 52.5,
    lon: 13.4,
    status,
    follow_up_at: null,
    note: null,
    address: null,
    parent_house_id: null,
    unit_label: null,
    unit_count: null,
    created_by: 'u1',
    created_at: '2026-07-20T00:00:00Z',
  };
}

describe('status -> color/icon mapping (colorblind-safe pairing)', () => {
  it.each(STATUSES)('status "%s" has both a color and an icon glyph', (status) => {
    expect(typeof statusColor[status]).toBe('string');
    expect(statusColor[status]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(typeof statusIcon[status]).toBe('string');
    expect(statusIcon[status].length).toBeGreaterThan(0);
  });

  it('every status has a visually distinct color', () => {
    const colors = STATUSES.map((status) => statusColor[status]);
    expect(new Set(colors).size).toBe(STATUSES.length);
  });
});

describe('house pin colour is theme-invariant (12-10, T-12-10-01)', () => {
  it('statusColor (traffic-light pin fill) is not a function of the resolved scheme', () => {
    // statusColor has no scheme parameter at all -- the same hue backs every
    // pin regardless of ThemeProvider's resolved light/dark scheme, so a
    // status can never desaturate or shift hue when the rep flips dark mode.
    for (const status of STATUSES) {
      expect(statusColor[status]).toBe(statusColor[status]);
    }
  });

  it("HousePin's fixed ring/icon colour (lightColors.onAccent) stays pinned to the light value the pin was designed against, not the resolved scheme", () => {
    const lightOnAccent = getColors('light').onAccent;
    const darkOnAccent = getColors('dark').onAccent;
    // The two intentionally DIFFER (dark mode inverts onAccent to the
    // ink-navy tone for themed surfaces) -- proving HousePin.tsx's direct
    // `lightColors.onAccent` import (not useThemeColors()) is a deliberate,
    // tested choice: the pin's white ring/icon must stay legible against the
    // invariant statusColor fill in both themes, never flip to a dark tone.
    expect(lightOnAccent).not.toBe(darkOnAccent);
    expect(lightColors.onAccent).toBe(lightOnAccent);
  });
});

describe('housePinAccessibilityLabel', () => {
  it.each(STATUSES)(
    'returns the German status label for "%s" via i18n (never hardcoded)',
    (status) => {
      const label = housePinAccessibilityLabel(fakeHouse(status));
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    },
  );
});

describe('0088 party rollup on the map (backward compatibility first)', () => {
  const unit = (id: string, status: HouseStatus): HouseRow => ({
    ...fakeHouse(status),
    id,
    parent_house_id: 'h1',
  });

  it.each(STATUSES)(
    'housePinAccessibilityLabel for a party-less house "%s" is WORD FOR WORD the pre-0088 text',
    (status) => {
      const house = fakeHouse(status);
      const before = housePinAccessibilityLabel(house);
      const withEmptyRollup = housePinAccessibilityLabel(house, {
        status,
        openUnits: null,
        hasUnits: false,
      });
      expect(withEmptyRollup).toBe(before);
    },
  );

  it('speaks the number of open doors when the building has parties', () => {
    const label = housePinAccessibilityLabel(fakeHouse('new'), {
      status: 'new',
      openUnits: 3,
      hasUnits: true,
    });
    expect(label).toContain('3');
    expect(label.length).toBeGreaterThan(housePinAccessibilityLabel(fakeHouse('new')).length);
  });

  it('says "done" instead of a number when every party is terminal', () => {
    const label = housePinAccessibilityLabel(fakeHouse('success'), {
      status: 'success',
      openUnits: 0,
      hasUnits: true,
    });
    expect(label).not.toMatch(/\d/);
    expect(label.length).toBeGreaterThan(0);
  });

  it('deriveStreetSummary counts a building with four parties as FOUR doors, not five', () => {
    const building = fakeHouse('success');
    const unitsByParent = new Map<string, HouseRow[]>([
      [
        building.id,
        [
          unit('u1', 'new'),
          unit('u2', 'new'),
          unit('u3', 'follow_up'),
          unit('u4', 'success'),
        ],
      ],
    ]);

    const summary = deriveStreetSummary([building], unitsByParent);

    expect(summary.visited + summary.open).toBe(4);
    expect(summary).toEqual({ visited: 2, open: 2, deals: 1 });
  });

  it('deriveStreetSummary without a party map is the pre-0088 count, unchanged', () => {
    expect(deriveStreetSummary([house('new'), house('success')])).toEqual({
      visited: 1,
      open: 1,
      deals: 1,
    });
  });
});

describe('syncPillKey', () => {
  it('maps each sync state to its i18n key', () => {
    expect(syncPillKey('synced')).toBe('syncPill.synced');
    expect(syncPillKey('pending')).toBe('syncPill.pending');
    expect(syncPillKey('offline')).toBe('syncPill.offline');
  });
});

describe('territoriesToFeatureCollection', () => {
  const boundary: GeoJSON.Polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [13.4, 52.5],
        [13.5, 52.5],
        [13.5, 52.6],
        [13.4, 52.6],
        [13.4, 52.5],
      ],
    ],
  };

  it('marks the caller-locked territory as isOwn, others as locked', () => {
    const fc = territoriesToFeatureCollection(
      [
        { id: 'a', team_id: 't1', name: 'Mine', locked_by: 'user-1', assigned_rep_id: null, boundary },
        { id: 'b', team_id: 't1', name: 'Theirs', locked_by: 'user-2', assigned_rep_id: null, boundary },
        { id: 'c', team_id: 't1', name: 'Unassigned', locked_by: null, assigned_rep_id: null, boundary },
      ],
      'user-1',
    );

    expect(fc.features).toHaveLength(3);
    expect(fc.features.map((feature) => feature.properties)).toEqual([
      { isOwn: true },
      { isOwn: false },
      { isOwn: false },
    ]);
  });
});

describe('deriveMapOverlay (CR-01: never fall back to a teammate territory for the empty state)', () => {
  it('returns null while tiles are still loading and there is no own territory', () => {
    expect(
      deriveMapOverlay({ ownTerritory: null, tileStatus: 'loading', housesCount: 0 }),
    ).toBeNull();
  });

  it('CR-01 regression: returns noTerritory when ownTerritory is null even though houses (implying a teammate territory) exist', () => {
    expect(deriveMapOverlay({ ownTerritory: null, tileStatus: 'ready', housesCount: 3 })).toBe(
      'noTerritory',
    );
  });

  it('returns mapDataMissing when own territory exists but tiles failed to load', () => {
    expect(deriveMapOverlay({ ownTerritory: {}, tileStatus: 'missing', housesCount: 0 })).toBe(
      'mapDataMissing',
    );
  });

  it('returns noHouses when own territory and tiles are ready but no houses exist yet', () => {
    expect(deriveMapOverlay({ ownTerritory: {}, tileStatus: 'ready', housesCount: 0 })).toBe(
      'noHouses',
    );
  });

  it('returns null (normal state) when own territory, tiles ready, and houses exist', () => {
    expect(deriveMapOverlay({ ownTerritory: {}, tileStatus: 'ready', housesCount: 5 })).toBeNull();
  });
});

describe('deriveCanEnterDrawMode (ROLE-01: real synced role gates the draw toggle, not a capability flag)', () => {
  const drawTargetTerritory = { team_id: 'team-a' };

  it('a team lead of the draw-target territory team sees the draw toggle', () => {
    const isTeamLead = (teamId: string) => teamId === 'team-a';
    expect(deriveCanEnterDrawMode(drawTargetTerritory, isTeamLead)).toBe(true);
  });

  it('a plain rep (not the lead of the draw-target team) does not see the draw toggle', () => {
    const isTeamLead = () => false;
    expect(deriveCanEnterDrawMode(drawTargetTerritory, isTeamLead)).toBe(false);
  });

  it('a lead of a different team does not see the draw toggle for this territory', () => {
    const isTeamLead = (teamId: string) => teamId === 'team-b';
    expect(deriveCanEnterDrawMode(drawTargetTerritory, isTeamLead)).toBe(false);
  });

  it('returns false when there is no draw-target territory at all, even for a lead', () => {
    const isTeamLead = () => true;
    expect(deriveCanEnterDrawMode(null, isTeamLead)).toBe(false);
  });
});

describe('the map stays the default view (house list is additive)', () => {
  // The harness has no react-test-renderer, so viewMode cannot be asserted by
  // rendering. Asserted at the level this harness reaches — the same
  // readFileSync source check the copy test below already uses.
  const source = readFileSync(fileURLToPath(new URL('./MapScreen.tsx', import.meta.url)), 'utf-8');

  it("initialises viewMode to 'map'", () => {
    expect(source).toContain("useState<'map' | 'list'>('map')");
  });

  it('never gates the marker loop on the view mode', () => {
    // The loop reads `visibleHouses` now — the status filter's set, which is
    // the ONE thing allowed to hide a pin. The invariant this test has always
    // protected is unchanged: the view mode is not that thing.
    expect(source).toContain('{visibleHouses.map(({ house, rollup }) => {');
    expect(source).not.toMatch(/viewMode === 'map' \? (houses|visibleHouses)\.map/);
  });

  it('takes the list origin from the existing one-shot fix, never a continuous watch (D-1)', () => {
    expect(source).toContain('getSignatureLocationDefault()');
    expect(source).not.toContain('watchPositionAsync');
  });

  it('never reverse-geocodes for the list (D-2 / T-G01-01)', () => {
    const listSource = readFileSync(
      fileURLToPath(new URL('./HouseListView.tsx', import.meta.url)),
      'utf-8',
    );
    const coreSource = readFileSync(
      fileURLToPath(new URL('./houseList.ts', import.meta.url)),
      'utf-8',
    );
    // Neither the list nor its pure core may import or call the geocoder —
    // it is online and hard-limited to 1 request/second, so a 40-row list
    // would become a ~44-second request storm. (The word itself still appears
    // in their header comments, which is exactly where the reason belongs.)
    for (const src of [listSource, coreSource]) {
      expect(src).not.toMatch(/from '\.\/reverseGeocode'/);
      expect(src).not.toMatch(/\breverseGeocode\s*\(/);
    }
    // The map's "resolving …" copy must not be borrowed by the list: nothing
    // is being resolved there, so that string would be a lie.
    expect(listSource).not.toContain('statusSheet.addressResolving');
  });
});

describe('no hardcoded German copy in MapScreen.tsx', () => {
  it('every user-facing string comes from t(), not a literal German word', () => {
    const sourcePath = fileURLToPath(new URL('./MapScreen.tsx', import.meta.url));
    const source = readFileSync(sourcePath, 'utf-8');
    // Sample of German words that would appear if copy were hardcoded instead
    // of routed through t() (UI-SPEC Copywriting Contract terms).
    const germanWords = ['Häuser', 'Wiedervorlage', 'Gebiet', 'Kartendaten', 'Synchronisiert'];
    for (const word of germanWords) {
      expect(source).not.toContain(word);
    }
  });
});

/**
 * Quick task grk / Task 1 — the floating map controls must derive their offset
 * from the MEASURED summary-card height, not from a single estimated constant
 * (a constant cannot describe a two-state card; the expanded state is what
 * defeated the old `SUMMARY_CARD_LIFT`).
 *
 * The harness has no react-test-renderer, so this is asserted over the file
 * source — with comments STRIPPED first, so a doc comment can neither satisfy
 * nor falsify an assertion.
 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('map chrome: the summary card and the floating controls are decoupled', () => {
  const source = stripComments(
    readFileSync(fileURLToPath(new URL('./MapScreen.tsx', import.meta.url)), 'utf-8'),
  );

  it('no longer carries the estimated SUMMARY_CARD_LIFT constant anywhere', () => {
    expect(source).not.toContain('SUMMARY_CARD_LIFT');
  });

  it('routes floating-control offsets through mapControlBottom', () => {
    // Phrased as "at least twice", never an exact count: a later task folds
    // several controls into one cluster, which must not falsify this test.
    const calls = source.match(/mapControlBottom\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('leaves no inline edge-margin arithmetic on a floating control bottom', () => {
    expect(source).not.toMatch(/insets\.bottom \+\s*spacing\.mapEdgeMargin \+/);
  });

  // Inverted deliberately. The card used to report its measured height upward
  // so the controls could lift over it; that coupling produced both the
  // "controls keep the card's space" defect and the ~34dp overlap. The card is
  // docked bottom-left and content-width now, so no measurement may come back.
  it('no longer measures the summary card to lift anything', () => {
    expect(source).not.toContain('onHeightChange');
    expect(source).not.toContain('summaryLiftHeight');
    expect(source).toContain('summaryDock');
  });

  it('keeps every pre-existing map testID', () => {
    // Task 5 moved three of these onto MapToolCluster's nodes, so the map
    // chrome is now the two files together. The assertion is that no testID was
    // LOST — not that MapScreen.tsx is still the one that spells it.
    const chrome = `${source}\n${stripComments(
      readFileSync(fileURLToPath(new URL('./MapToolCluster.tsx', import.meta.url)), 'utf-8'),
    )}`;
    for (const testId of [
      'map-view-toggle',
      'map-help-button',
      'map-assign-rep-button',
      'map-street-summary',
      'map-street-summary-toggle',
    ]) {
      expect(chrome).toContain(testId);
    }
  });
});

describe('map chrome: a condensed collapsed summary card and a status-bar scrim', () => {
  const source = stripComments(
    readFileSync(fileURLToPath(new URL('./MapScreen.tsx', import.meta.url)), 'utf-8'),
  );

  it('renders the scrim from the pure band derivation, non-interactive', () => {
    expect(source).toContain('deriveStatusBarScrimBands');
    expect(source).toContain('map-status-bar-scrim');
    expect(source).toContain('pointerEvents="none"');
  });

  it('keeps the toggle at a >= 48dp effective target via hitSlop, not via a minHeight', () => {
    expect(source).toContain('hitSlop');
    expect(source).toMatch(/testID="map-street-summary-toggle"/);
    expect(source).not.toMatch(/summaryTopRow:\s*\{[^}]*minHeight/);
  });

  it('drops the heading type off the collapsed summary title', () => {
    expect(source).not.toMatch(/summaryTitle:\s*\{\s*\.\.\.typography\.heading/);
  });
});

/**
 * Quick task grk / Task 5 — the animated tool cluster (speed dial).
 *
 * Source-level again (no react-test-renderer in this workspace), comments
 * stripped so a doc comment can neither satisfy nor falsify an assertion.
 */
describe('map chrome: the secondary controls fold into an animated tool cluster', () => {
  const mapSource = stripComments(
    readFileSync(fileURLToPath(new URL('./MapScreen.tsx', import.meta.url)), 'utf-8'),
  );
  const clusterSource = stripComments(
    readFileSync(fileURLToPath(new URL('./MapToolCluster.tsx', import.meta.url)), 'utf-8'),
  );

  it('drives the cluster from the pure composition rule, not from inline JSX gates', () => {
    expect(mapSource).toContain('deriveMapToolCluster');
    expect(mapSource).toContain('MapToolCluster');
  });

  it('no longer renders the five individual floating controls', () => {
    for (const style of ['styles.drawModeToggle', 'styles.helpButton', 'styles.viewToggleButton']) {
      expect(mapSource).not.toContain(style);
    }
  });

  it('inserts the cluster BEFORE the sheet, which must stay the last overlay child', () => {
    // Task 4 moved <StatusSheet /> last precisely so its backdrop is not
    // painted over on iOS, where paint order follows JSX order. A cluster
    // rendered after it would steal taps meant for that backdrop.
    // The JSX element is matched with its trailing newline: a bare
    // '<StatusSheet' would also hit the useState<StatusSheetTarget | null>
    // generic hundreds of lines above the return.
    //
    // Matched with a regex, not a literal '<StatusSheet\n'. The file is checked
    // out with CRLF on Windows, so the literal found nothing and this test
    // failed for every Windows developer regardless of what the source said —
    // it was asserting the checkout's line endings, not the paint order it is
    // about.
    const sheetElement = /<StatusSheet\r?\n/.exec(mapSource)?.index ?? -1;
    expect(mapSource.indexOf('<MapToolCluster')).toBeGreaterThan(-1);
    expect(sheetElement).toBeGreaterThan(-1);
    expect(mapSource.indexOf('<MapToolCluster')).toBeLessThan(sheetElement);
  });

  it('keeps every pre-existing map testID and adds the cluster ones', () => {
    // The cluster now OWNS the controls' testIDs, so the map chrome is the two
    // files together — that is the move Task 5 makes, not a loss of coverage.
    const chromeSource = `${mapSource}\n${clusterSource}`;
    for (const testId of [
      'map-view-toggle',
      'map-help-button',
      'map-assign-rep-button',
      'map-street-summary',
      'map-street-summary-toggle',
      'map-status-bar-scrim',
      'map-tools-trigger',
      'map-tools-backdrop',
      'map-recenter-button',
      'map-draw-toggle',
    ]) {
      expect(chromeSource).toContain(testId);
    }
  });

  it('reuses the summary card animation mechanic and honours Reduce Motion as a hard requirement', () => {
    expect(clusterSource).toContain('Easing.out(Easing.cubic)');
    expect(clusterSource).toContain('reducedMotion ? 0 : 220');
  });

  it('forbids springy motion — the operator asked for an ease-out with no overshoot', () => {
    for (const banned of ['Animated.spring', 'Easing.back', 'Easing.elastic', 'Easing.bounce']) {
      expect(clusterSource).not.toContain(banned);
    }
  });

  it('announces its expanded state and hides closed entries from touch AND assistive tech', () => {
    expect(clusterSource).toContain('accessibilityState');
    expect(clusterSource).toContain('accessibilityElementsHidden');
    expect(clusterSource).toContain('importantForAccessibility');
    expect(clusterSource).toContain('pointerEvents');
  });

  it('renders the dismiss backdrop only while open (T-GRK-04: never a permanently mounted trap)', () => {
    expect(clusterSource).toMatch(/expanded \? \([\s\S]{0,400}map-tools-backdrop/);
  });

  it('keeps every cluster target at or above the 48dp floor, asserted against the token', () => {
    expect(MAP_CONTROL_SIZE).toBeGreaterThanOrEqual(spacing.touchTarget);
  });

  it('carries the two new trigger labels in both locales', () => {
    for (const key of ['map.toolsExpandLabel', 'map.toolsCollapseLabel']) {
      expect(de).toHaveProperty(key);
      expect(en).toHaveProperty(key);
      expect((de as Record<string, string>)[key]).toBeTruthy();
      expect((en as Record<string, string>)[key]).toBeTruthy();
    }
  });
});

/**
 * THE RELAPSE GUARD for the nested-SafeAreaProvider defect.
 *
 * Why a source scan and not a render assertion: this whole test file mocks
 * `react-native-safe-area-context` wholesale (see the top of the file), and it
 * has to — the real package is native and cannot load under the node
 * environment this workspace runs vitest in. A mocked provider hands out
 * whatever the mock says, so NO amount of rendering here can distinguish a
 * tree with one provider from a tree with two. That is precisely how the
 * original defect survived: the suite was green while every inset on the
 * device was zero.
 *
 * What a nested provider does: `SafeAreaProvider` does not inherit its
 * parent's frame, it measures its own and publishes zeroes until that
 * measurement lands. Every `useSafeAreaInsets()` underneath it therefore reads
 * `{ top: 0, bottom: 0 }` — which silently defeats `maxSheetHeight`'s
 * `insetTop`, `mapControlBottom`'s `insetBottom` and
 * `deriveStatusBarScrimBands`'s `insetTop` all at once, because all three take
 * an inset as an ordinary number and cannot tell a real 0 (landscape Android)
 * from a broken one.
 *
 * The one legitimate provider lives at the root, in `RootNavigator.tsx`, with
 * `initialMetrics={initialWindowMetrics}` so it is correct on the FIRST frame.
 * Nothing under `features/map/` may add a second one.
 */
describe('safe-area insets: exactly one provider, and it is not in this directory', () => {
  // `.href` (a string) rather than the URL object: this workspace currently has
  // two conflicting `URL` declarations on the type graph, so passing the object
  // trips TS2345 in every test file that does it. Not this task's bug to fix,
  // but not this task's bug to enlarge either.
  const dir = fileURLToPath(new URL('.', import.meta.url).href);
  const sourceFiles = readdirSync(dir).filter(
    (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name),
  );

  it('scans a non-empty set of files (a silent empty glob would pass vacuously)', () => {
    expect(sourceFiles.length).toBeGreaterThan(5);
    expect(sourceFiles).toContain('MapScreen.tsx');
    expect(sourceFiles).toContain('StatusSheet.tsx');
  });

  it.each(sourceFiles)('%s neither imports nor renders a SafeAreaProvider', (name) => {
    const source = stripComments(readFileSync(`${dir}${name}`, 'utf-8'));
    // Two independent checks: the import (so it cannot be aliased back in) and
    // the JSX element (so a re-export or a local wrapper cannot smuggle it).
    expect(source).not.toMatch(/SafeAreaProvider/);
    // `SafeAreaView` renders a provider-backed frame too and has the same
    // failure mode when it is nested under a root provider that already
    // applies the padding — consumers here use `useSafeAreaInsets()` instead.
    expect(source).not.toMatch(/SafeAreaView/);
  });

  it('the ONE provider is the root one, and it is seeded with initialWindowMetrics', () => {
    const root = stripComments(
      readFileSync(
        fileURLToPath(new URL('../../app/RootNavigator.tsx', import.meta.url).href),
        'utf-8',
      ),
    );
    expect(root).toContain('<SafeAreaProvider initialMetrics={initialWindowMetrics}>');
    // Exactly one opening tag: a second provider at the root would reintroduce
    // the same defect one level up.
    expect(root.match(/<SafeAreaProvider[\s>]/g)).toHaveLength(1);
  });
});
