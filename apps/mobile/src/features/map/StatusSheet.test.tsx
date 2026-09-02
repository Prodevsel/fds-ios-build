import { beforeEach, describe, expect, it, vi } from 'vitest';

// Node test environment (vitest.config.ts): never load native RN/Expo
// modules. StatusSheet's write/schedule core logic (writeHouseStatus,
// confirmBlacklist, saveFollowUp) is pure and DI'd — mirrors
// useSkeletonFlow.test.ts's pattern: test the logic directly against fakes,
// never mount the component tree (no react-test-renderer in this repo).
vi.mock('react-native', () => ({
  View: () => null,
  Text: () => null,
  Pressable: () => null,
  StyleSheet: { create: (styles: unknown) => styles },
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
// StatusSheet.tsx reads useSafeAreaInsets() directly. Every other screen test
// in this repo stubs this module; this file was the one that did not, and the
// real package fails to parse under the Node test environment — which is why
// the whole suite loaded as zero tests instead of failing loudly.
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
// StatusSheet.tsx transitively imports the ui/ primitives, which (since
// 12-08) call useThemeColors() -> ThemeProvider/AccessibilityProvider's own
// native deps — mocked here too (AccessibilityProvider.test.tsx precedent),
// even though no component is ever mounted in this file.
vi.mock('../../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('../settings/settingsCache', () => ({
  createSettingsCache: () => ({ get: () => null, set: () => {} }),
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));
// StatusSheet.tsx renders the InfoSheet QoL primitive (status-meaning sheet +
// blacklist explainer), which imports Modal/ScrollView + react-native-safe-area-
// context transitively. Only the pure write/schedule logic is under test here,
// so stub the whole UI module (same pattern as the repo/screen mocks below).
vi.mock('../../ui/InfoSheet', () => ({
  InfoSheet: () => null,
  InfoSheetSection: () => null,
  InfoLegendRow: () => null,
  InfoIconButton: () => null,
  HintRow: () => null,
  buildStatusLegend: () => [],
}));
// StatusSheet.tsx's own imports of housesRepo/useFollowUpSchedule pull in
// expo-crypto/expo-notifications transitively — never load those native
// modules in Node (mirrors MapScreen.test.tsx's pattern). Only the pure,
// exported core-logic functions below are under test, so plain no-op stubs
// are enough; the real modules are never exercised.
vi.mock('./db/housesRepo', () => ({ createHousesRepo: vi.fn() }));
vi.mock('./useFollowUpSchedule', () => ({
  defaultFollowUpDate: () => new Date(),
  useFollowUpSchedule: () => ({
    state: { status: 'idle', error: null },
    scheduleFollowUp: vi.fn(),
  }),
}));
// 03-05: StatusSheet.tsx's "Beratung starten" wiring imports the flow-runner
// repos/screen, which transitively pull in expo-crypto — same rationale as
// the housesRepo/useFollowUpSchedule mocks above.
vi.mock('../flow-runner/db/flowDraftsRepo', () => ({ createFlowDraftsRepo: vi.fn() }));
vi.mock('../flow-runner/FlowRunnerScreen', () => ({ FlowRunnerScreen: () => null }));
// The sheet now routes through ConsultationFlow, which pulls in expo-crypto and
// expo-file-system at module scope — native modules this node environment
// cannot load. The sheet's own logic is what these tests cover; which screen the
// router lands on has its own coverage.
vi.mock('../flow-runner/ConsultationFlow', () => ({ ConsultationFlow: () => null }));
// StatusSheet.tsx now imports createAppointmentsRepo (the follow-up producer),
// which transitively pulls in expo-crypto — mock it the same way the
// housesRepo/flowDraftsRepo native chains above are mocked (the pure saveFollowUp
// logic takes its appointmentsRepo via DI, so no real module is needed here).
vi.mock('../termine/db/appointmentsRepo', () => ({ createAppointmentsRepo: vi.fn() }));

import {
  applyUnitCount,
  confirmBlacklist,
  flowTerritoryId,
  saveFollowUp,
  saveHouseNote,
  writeHouseStatus,
  writeUnitLabel,
  writeUnitStatus,
  type StatusSheetAppointmentsRepo,
  type StatusSheetRepo,
  type StatusSheetTarget,
} from './StatusSheet';
import type { HouseRow } from './db/housesRepo';

function fakeRepo(overrides: Partial<StatusSheetRepo> = {}): StatusSheetRepo {
  return {
    insertHouseAtPoint: vi.fn(async () => 'new-house-id'),
    setStatus: vi.fn(async () => {}),
    setNote: vi.fn(async () => {}),
    setAddress: vi.fn(async () => {}),
    addBlacklistEntry: vi.fn(async () => 'blacklist-id'),
    insertUnit: vi.fn(async () => 'new-unit-id'),
    setUnitLabel: vi.fn(async () => {}),
    setUnitCount: vi.fn(async () => {}),
    ...overrides,
  };
}

function fakeAppointmentsRepo(): StatusSheetAppointmentsRepo {
  return { createFollowUpAppointment: vi.fn(async () => 'appointment-id') };
}

function fakeHouse(overrides: Partial<HouseRow> = {}): HouseRow {
  return {
    id: 'house-1',
    team_id: 'team-1',
    territory_id: null,
    lat: 52.5,
    lon: 13.4,
    status: 'new',
    address: null,
    follow_up_at: null,
    note: null,
    parent_house_id: null,
    unit_label: null,
    unit_count: null,
    created_by: 'user-1',
    created_at: '2026-07-20T00:00:00Z',
    ...overrides,
  };
}

const createTarget: StatusSheetTarget = { mode: 'create', lngLat: [13.4, 52.5] };

describe('flowTerritoryId (RBTT-02 territory attribution at flow start)', () => {
  it('edit mode forwards the house row territory_id to the flow', () => {
    const editTarget: StatusSheetTarget = {
      mode: 'edit',
      house: fakeHouse({ territory_id: 'territory-1' }),
    };
    expect(flowTerritoryId(editTarget)).toBe('territory-1');
  });

  it('create mode has no local territory yet (server-side assignment) — null', () => {
    expect(flowTerritoryId(createTarget)).toBeNull();
  });
});

describe('writeHouseStatus (one-tap status, no confirmation)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('create mode with no active house id: inserts at the tap point, never sets territory_id', async () => {
    const repo = fakeRepo();

    const id = await writeHouseStatus({
      repo,
      target: createTarget,
      activeHouseId: null,
      status: 'success',
      teamId: 'team-1',
      createdBy: 'user-1',
    });

    expect(id).toBe('new-house-id');
    expect(repo.insertHouseAtPoint).toHaveBeenCalledWith({
      lngLat: [13.4, 52.5],
      status: 'success',
      teamId: 'team-1',
      createdBy: 'user-1',
      // A map tap knows no address; only the address search supplies one.
      address: null,
    });
    expect(repo.setStatus).not.toHaveBeenCalled();
  });

  it('edit mode (existing pin, one-tap change): updates via setStatus, never inserts', async () => {
    const repo = fakeRepo();
    const editTarget: StatusSheetTarget = { mode: 'edit', house: fakeHouse({ status: 'new' }) };

    const id = await writeHouseStatus({
      repo,
      target: editTarget,
      activeHouseId: 'house-1',
      status: 'success',
      teamId: 'team-1',
      createdBy: 'user-1',
    });

    expect(id).toBe('house-1');
    expect(repo.setStatus).toHaveBeenCalledWith('house-1', 'success');
    expect(repo.insertHouseAtPoint).not.toHaveBeenCalled();
  });

  it('an already-created house this sheet-open (activeHouseId set) updates rather than re-inserting', async () => {
    const repo = fakeRepo();

    const id = await writeHouseStatus({
      repo,
      target: createTarget,
      activeHouseId: 'already-created-id',
      status: 'follow_up',
      teamId: 'team-1',
      createdBy: 'user-1',
    });

    expect(id).toBe('already-created-id');
    expect(repo.setStatus).toHaveBeenCalledWith('already-created-id', 'follow_up');
    expect(repo.insertHouseAtPoint).not.toHaveBeenCalled();
  });
});

describe('saveFollowUp (MAP-02: persist follow_up_at, then schedule the OS notification)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists follow_up_at, creates a matching Folgetermin, and schedules the notification for the same house', async () => {
    const repo = fakeRepo();
    const appointmentsRepo = fakeAppointmentsRepo();
    const scheduleFollowUp = vi.fn(async () => true);
    const when = new Date('2026-07-21T17:30:00.000Z');

    const houseId = await saveFollowUp({
      repo,
      appointmentsRepo,
      target: createTarget,
      activeHouseId: null,
      teamId: 'team-1',
      createdBy: 'user-1',
      when,
      scheduleFollowUp,
    });

    expect(houseId).toBe('new-house-id');
    expect(repo.insertHouseAtPoint).toHaveBeenCalledWith({
      lngLat: [13.4, 52.5],
      status: 'follow_up',
      teamId: 'team-1',
      createdBy: 'user-1',
      // A map tap knows no address; only the address search supplies one.
      address: null,
    });
    expect(repo.setStatus).toHaveBeenCalledWith('new-house-id', 'follow_up', when.toISOString());
    // The real producer: a Folgetermin row for the acting rep + house + time.
    expect(appointmentsRepo.createFollowUpAppointment).toHaveBeenCalledWith({
      repId: 'user-1',
      teamId: 'team-1',
      houseId: 'new-house-id',
      scheduledAt: when,
    });
    expect(scheduleFollowUp).toHaveBeenCalledWith('new-house-id', when);
  });

  it('for an existing pin, updates its follow_up_at without a second insert', async () => {
    const repo = fakeRepo();
    const appointmentsRepo = fakeAppointmentsRepo();
    const scheduleFollowUp = vi.fn(async () => true);
    const editTarget: StatusSheetTarget = { mode: 'edit', house: fakeHouse() };
    const when = new Date('2026-07-21T09:00:00.000Z');

    const houseId = await saveFollowUp({
      repo,
      appointmentsRepo,
      target: editTarget,
      activeHouseId: 'house-1',
      teamId: 'team-1',
      createdBy: 'user-1',
      when,
      scheduleFollowUp,
    });

    expect(houseId).toBe('house-1');
    expect(repo.insertHouseAtPoint).not.toHaveBeenCalled();
    expect(repo.setStatus).toHaveBeenNthCalledWith(1, 'house-1', 'follow_up');
    expect(repo.setStatus).toHaveBeenNthCalledWith(2, 'house-1', 'follow_up', when.toISOString());
    expect(appointmentsRepo.createFollowUpAppointment).toHaveBeenCalledWith({
      repId: 'user-1',
      teamId: 'team-1',
      houseId: 'house-1',
      scheduledAt: when,
    });
    expect(scheduleFollowUp).toHaveBeenCalledWith('house-1', when);
  });
});

describe('saveHouseNote (0060: persist the free-text Notiz, offline via the houses write path)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('edit mode: updates the note on the existing house, never inserts', async () => {
    const repo = fakeRepo();
    const editTarget: StatusSheetTarget = { mode: 'edit', house: fakeHouse() };

    const houseId = await saveHouseNote({
      repo,
      target: editTarget,
      activeHouseId: 'house-1',
      teamId: 'team-1',
      createdBy: 'user-1',
      note: 'Nachbar abends nochmal fragen',
    });

    expect(houseId).toBe('house-1');
    expect(repo.insertHouseAtPoint).not.toHaveBeenCalled();
    expect(repo.setNote).toHaveBeenCalledWith('house-1', 'Nachbar abends nochmal fragen');
  });

  it('create mode with no house yet: materializes a fresh "new" pin, then saves the note', async () => {
    const repo = fakeRepo();

    const houseId = await saveHouseNote({
      repo,
      target: createTarget,
      activeHouseId: null,
      teamId: 'team-1',
      createdBy: 'user-1',
      note: 'Klingelt nicht — Seiteneingang',
    });

    expect(houseId).toBe('new-house-id');
    expect(repo.insertHouseAtPoint).toHaveBeenCalledWith({
      lngLat: [13.4, 52.5],
      status: 'new',
      teamId: 'team-1',
      createdBy: 'user-1',
      // A map tap knows no address; only the address search supplies one.
      address: null,
    });
    expect(repo.setNote).toHaveBeenCalledWith('new-house-id', 'Klingelt nicht — Seiteneingang');
  });

  it('passes null through to clear a note on an existing house', async () => {
    const repo = fakeRepo();
    const editTarget: StatusSheetTarget = { mode: 'edit', house: fakeHouse() };

    await saveHouseNote({
      repo,
      target: editTarget,
      activeHouseId: 'house-1',
      teamId: 'team-1',
      createdBy: 'user-1',
      note: null,
    });

    expect(repo.setNote).toHaveBeenCalledWith('house-1', null);
    expect(repo.insertHouseAtPoint).not.toHaveBeenCalled();
  });
});

describe('confirmBlacklist (MAP-05: only writes after the destructive confirm)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes the blacklist status THEN a minimal blacklist_entries row (no PII fields)', async () => {
    const repo = fakeRepo();

    const result = await confirmBlacklist({
      repo,
      target: createTarget,
      activeHouseId: null,
      teamId: 'team-1',
      createdBy: 'user-1',
    });

    expect(result).toEqual({ houseId: 'new-house-id', blacklistId: 'blacklist-id' });
    expect(repo.insertHouseAtPoint).toHaveBeenCalledWith({
      lngLat: [13.4, 52.5],
      status: 'blacklist',
      teamId: 'team-1',
      createdBy: 'user-1',
      // A map tap knows no address; only the address search supplies one.
      address: null,
    });
    expect(repo.addBlacklistEntry).toHaveBeenCalledWith({
      teamId: 'team-1',
      createdBy: 'user-1',
      lat: 52.5,
      lon: 13.4,
      houseId: 'new-house-id',
    });
    const call = (repo.addBlacklistEntry as ReturnType<typeof vi.fn>).mock.calls[0];
    if (!call) throw new Error('addBlacklistEntry was never called');
    expect(Object.keys(call[0] as object).sort()).toEqual(
      ['createdBy', 'houseId', 'lat', 'lon', 'teamId'].sort(),
    );
  });

  it('for an existing pin, reuses its point/id rather than re-inserting', async () => {
    const repo = fakeRepo();
    const editTarget: StatusSheetTarget = { mode: 'edit', house: fakeHouse() };

    const result = await confirmBlacklist({
      repo,
      target: editTarget,
      activeHouseId: 'house-1',
      teamId: 'team-1',
      createdBy: 'user-1',
    });

    expect(result.houseId).toBe('house-1');
    expect(repo.insertHouseAtPoint).not.toHaveBeenCalled();
    expect(repo.setStatus).toHaveBeenCalledWith('house-1', 'blacklist');
    expect(repo.addBlacklistEntry).toHaveBeenCalledWith({
      teamId: 'team-1',
      createdBy: 'user-1',
      lat: 52.5,
      lon: 13.4,
      houseId: 'house-1',
    });
  });
});

describe('i18n copy (no hardcoded German strings in StatusSheet.tsx)', () => {
  it('every user-facing string comes from t(), not a literal German word', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./StatusSheet.tsx', import.meta.url));
    const source = readFileSync(sourcePath, 'utf-8');
    const germanWords = ['Wiedervorlage speichern', 'Auf Blacklist setzen', 'Abbrechen'];
    for (const word of germanWords) {
      expect(source).not.toContain(`'${word}'`);
      expect(source).not.toContain(`"${word}"`);
    }
  });
});

describe('0088 parties in the house sheet', () => {
  const building = fakeHouse({
    id: 'building-1',
    team_id: 'team-1',
    lat: 52.515,
    lon: 13.405,
  });

  it("applyUnitCount creates twelve parties with the BUILDING's team_id and never a territory_id", async () => {
    const repo = fakeRepo();

    const { createdIds, storedCount } = await applyUnitCount({
      repo,
      buildingId: building.id,
      existingUnits: [],
      desiredCount: 12,
      teamId: building.team_id,
      createdBy: 'user-1',
      lat: building.lat,
      lon: building.lon,
    });

    expect(storedCount).toBe(12);
    expect(createdIds).toHaveLength(12);
    expect(repo.setUnitCount).toHaveBeenCalledWith('building-1', 12);
    expect(repo.insertUnit).toHaveBeenCalledTimes(12);
    for (const call of vi.mocked(repo.insertUnit).mock.calls) {
      expect(call[0]).toEqual({
        parentHouseId: 'building-1',
        teamId: 'team-1',
        createdBy: 'user-1',
        lat: 52.515,
        lon: 13.405,
      });
      expect(call[0]).not.toHaveProperty('territoryId');
      expect(call[0]).not.toHaveProperty('territory_id');
    }
  });

  it('a second call with the same number creates nothing new', async () => {
    const repo = fakeRepo();
    const existing = Array.from({ length: 12 }, (_, index) =>
      fakeHouse({ id: `unit-${index}`, parent_house_id: 'building-1' }),
    );

    const { createdIds } = await applyUnitCount({
      repo,
      buildingId: building.id,
      existingUnits: existing,
      desiredCount: 12,
      teamId: building.team_id,
      createdBy: 'user-1',
      lat: building.lat,
      lon: building.lon,
    });

    expect(createdIds).toEqual([]);
    expect(repo.insertUnit).not.toHaveBeenCalled();
    // The number is still written — the field must reflect what the rep typed.
    expect(repo.setUnitCount).toHaveBeenCalledWith('building-1', 12);
  });

  it('lowering the number never deletes a party (no upload path for a delete)', async () => {
    const repo = fakeRepo();
    const existing = Array.from({ length: 5 }, (_, index) =>
      fakeHouse({ id: `unit-${index}`, parent_house_id: 'building-1' }),
    );

    await applyUnitCount({
      repo,
      buildingId: building.id,
      existingUnits: existing,
      desiredCount: 2,
      teamId: building.team_id,
      createdBy: 'user-1',
      lat: building.lat,
      lon: building.lon,
    });

    expect(repo.insertUnit).not.toHaveBeenCalled();
    expect(repo.setUnitCount).toHaveBeenCalledWith('building-1', 2);
    expect(repo).not.toHaveProperty('deleteUnit');
  });

  it('clamps a mistyped count at 200 instead of enqueueing thousands of rows', async () => {
    const repo = fakeRepo();

    const { storedCount, createdIds } = await applyUnitCount({
      repo,
      buildingId: building.id,
      existingUnits: [],
      desiredCount: 5000,
      teamId: building.team_id,
      createdBy: 'user-1',
      lat: building.lat,
      lon: building.lon,
    });

    expect(storedCount).toBe(200);
    expect(createdIds).toHaveLength(200);
  });

  it('writeUnitStatus writes to the PARTY id, never the building id', async () => {
    const repo = fakeRepo();

    const written = await writeUnitStatus({ repo, unitId: 'unit-7', status: 'success' });

    expect(written).toBe('unit-7');
    expect(repo.setStatus).toHaveBeenCalledWith('unit-7', 'success');
    expect(repo.setStatus).not.toHaveBeenCalledWith('building-1', 'success');
  });

  it('writeUnitLabel trims and clears an empty label back to NULL', async () => {
    const repo = fakeRepo();

    await writeUnitLabel({ repo, unitId: 'unit-7', label: '  3. OG links  ' });
    expect(repo.setUnitLabel).toHaveBeenCalledWith('unit-7', '3. OG links');

    await writeUnitLabel({ repo, unitId: 'unit-7', label: '   ' });
    expect(repo.setUnitLabel).toHaveBeenCalledWith('unit-7', null);
  });
});

/**
 * Defect 6 (BLOCKING): tap a pin on a real iPhone and there was no way back to
 * the map. The sheet had no maxHeight and no scroll container, so its height was
 * whatever its children summed to — and its ONLY exit, the grabber, sits at the
 * sheet's top edge. Once 0088's parties field plus the product buttons plus the
 * offer-code row pushed the total past the viewport, that top edge left the
 * screen with the exit on it.
 *
 * These are source-level assertions over COMMENT-STRIPPED source: the repo has
 * no react-test-renderer, and stripping first means the root-cause comments this
 * fix carries can never themselves satisfy a grep.
 */
describe('house sheet structure (defect 6: the exit can never be pushed off-screen again)', () => {
  async function strippedSheetSource(): Promise<string> {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const raw = readFileSync(fileURLToPath(new URL('./StatusSheet.tsx', import.meta.url)), 'utf-8');
    return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  }

  it('bounds the sheet from the viewport, not from its content', async () => {
    const source = await strippedSheetSource();
    expect(source).toContain('maxSheetHeight(');
    expect(source).toContain('maxHeight');
    expect(source).toContain('useWindowDimensions');
  });

  // THE anti-regression assertion. `useSwipeToDismiss`'s own doc comment states
  // the rule: attach panHandlers to the grabber, NOT to a scrollable body. If a
  // later change nests the handle inside the scrolled content, the swipe exit
  // becomes unreachable again (and hijacks the scroll gesture on the way), so
  // this test fails the moment the exit re-enters the content flow.
  it('keeps the grabber OUTSIDE the scroll container', async () => {
    const source = await strippedSheetSource();
    const handleAt = source.indexOf('panHandlers');
    const scrollAt = source.indexOf('<ScrollView');
    expect(handleAt).toBeGreaterThan(-1);
    expect(scrollAt).toBeGreaterThan(-1);
    expect(handleAt).toBeLessThan(scrollAt);
  });

  // Without flexShrink the children still force the sheet taller and the cap is
  // inert — the maxHeight would be satisfied by clipping, not by scrolling.
  it('lets the scroll container yield inside the capped parent', async () => {
    const source = await strippedSheetSource();
    expect(source).toContain('flexShrink: 1');
    expect(source).toContain('keyboardShouldPersistTaps="handled"');
  });

  // The bright full-height rule the operator photographed down the sheet's
  // right edge. Hidden because `indicatorStyle` is iOS-only and has no value
  // that is correct on BOTH the light (#FFFFFF) and dark (#16223B) sheet
  // surface, and because the clip at the scroll viewport is already the
  // theme-independent "continues below" cue. Pinned so a later change does not
  // quietly restore it — and so the `flexShrink: 1` clip that now carries the
  // affordance alone stays asserted right next to it (above).
  it('hides the platform scroll indicator on the sheet body', async () => {
    const source = await strippedSheetSource();
    expect(source).toContain('showsVerticalScrollIndicator={false}');
    // Never re-enabled elsewhere in the file, and never via the iOS-only prop
    // that cannot be right in both themes.
    expect(source).not.toMatch(/showsVerticalScrollIndicator(?!=\{false\})/);
    expect(source).not.toContain('indicatorStyle');
  });

  it('offers three independent exits where there were zero', async () => {
    const source = await strippedSheetSource();
    expect(source).toContain('status-sheet-close');
    expect(source).toContain('status-sheet-backdrop');
    expect(source).toContain('BackHandler');
    expect(source).toContain('hardwareBackPress');
  });

  it('gives the close button a literal 48dp target and a real label', async () => {
    const source = await strippedSheetSource();
    expect(source).toContain('spacing.touchTarget');
    expect(source).toContain("t('common.closeSheet')");
  });

  // Enumerated from the file BEFORE the restructure: none may disappear.
  it('keeps every pre-existing testID inside the sheet', async () => {
    const source = await strippedSheetSource();
    const preExisting = [
      'status-sheet',
      'flow-runner-overlay',
      'status-sheet-address',
      'derived-building-status',
      'status-info-button',
      'status-info-sheet',
      'status-note-input',
      'unit-count-input',
      'unit-list',
      'blacklist-blocked-hint',
      'offer-redeem-input',
      'offer-redeem-error',
      'followup-chosen-value',
      'followup-preset-',
      'unit-row-',
      'unit-label-input-',
    ];
    for (const testId of preExisting) {
      expect(source).toContain(testId);
    }
  });

  it('carries the close label in both locales', async () => {
    const de = (await import('../../i18n/de.json')).default as Record<string, string>;
    const en = (await import('../../i18n/en.json')).default as Record<string, string>;
    expect(de['common.closeSheet']).toBeTruthy();
    expect(en['common.closeSheet']).toBeTruthy();
  });

  it('renders the sheet as the LAST overlay child of MapScreen (iOS paints in JSX order)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const raw = readFileSync(fileURLToPath(new URL('./MapScreen.tsx', import.meta.url)), 'utf-8');
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    // `[\s/>]` so the generic `useState<StatusSheetTarget | null>` earlier in
    // the file cannot masquerade as the JSX element.
    const sheetAt = source.search(/<StatusSheet[\s/>]/);
    expect(sheetAt).toBeGreaterThan(-1);
    // Nothing that paints may follow it: on iOS the map/list toggle used to sit
    // after the sheet in JSX and would steal taps aimed at the new backdrop.
    expect(source.indexOf('map-view-toggle')).toBeLessThan(sheetAt);
    expect(source.indexOf('house-list-overlay')).toBeLessThan(sheetAt);
  });
});
