import { describe, expect, it, vi } from 'vitest';

// Node test environment (vitest.config.ts): never load native RN/Expo/MapLibre
// modules. Mirrors StatusSheet.test.tsx's pattern — test the pure, exported
// core-logic functions directly, never mount the component tree (no
// react-test-renderer in this repo).
vi.mock('react-native', () => ({
  View: () => null,
  Text: () => null,
  Pressable: () => null,
  StyleSheet: { create: (styles: unknown) => styles },
  Appearance: { getColorScheme: () => 'light', addChangeListener: vi.fn() },
}));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
vi.mock('@maplibre/maplibre-react-native', () => ({
  GeoJSONSource: () => null,
  Layer: () => null,
  Marker: () => null,
}));
// TerritoryDraw.tsx's TerritoryDrawControls (12-10) now calls useThemeColors()
// -> ThemeProvider/AccessibilityProvider's own native deps — mocked here too
// (AccessibilityProvider.test.tsx / 12-08's precedent). This file only
// exercises the pure, exported core-logic functions, never renders the
// component tree.
vi.mock('../../app/useSessionDb', () => ({
  useSessionDb: () => ({ db: null, userId: null, ready: false }),
}));
vi.mock('../settings/settingsCache', () => ({
  createSettingsCache: () => ({ get: () => null, set: () => {} }),
}));
vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));

import {
  appendVertex,
  assignTerritory,
  buildDraftPolygon,
  canAssignTerritory,
  undoLastVertex,
  type TerritoryDrawRepo,
} from './TerritoryDraw';

function fakeRepo(overrides: Partial<TerritoryDrawRepo> = {}): TerritoryDrawRepo {
  return {
    submitBoundary: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('appendVertex (tap-to-add-vertex, never a freehand/drag gesture)', () => {
  it('appends the tapped [lng, lat] point to the vertex array', () => {
    const result = appendVertex([[13.0, 52.0]], [13.1, 52.1]);
    expect(result).toEqual([
      [13.0, 52.0],
      [13.1, 52.1],
    ]);
  });

  it('starts from an empty array', () => {
    expect(appendVertex([], [13.4, 52.5])).toEqual([[13.4, 52.5]]);
  });
});

describe('undoLastVertex (undo-last-vertex control)', () => {
  it('removes only the most recently added vertex', () => {
    const vertices: [number, number][] = [
      [1, 1],
      [2, 2],
      [3, 3],
    ];
    expect(undoLastVertex(vertices)).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  it('is a no-op on an empty array', () => {
    expect(undoLastVertex([])).toEqual([]);
  });
});

describe('canAssignTerritory (`Gebiet zuweisen` enable gate — disabled until ≥3 vertices)', () => {
  it('is false below 3 vertices', () => {
    expect(canAssignTerritory([])).toBe(false);
    expect(canAssignTerritory([[1, 1]])).toBe(false);
    expect(
      canAssignTerritory([
        [1, 1],
        [2, 2],
      ]),
    ).toBe(false);
  });

  it('is true at exactly 3 vertices and beyond', () => {
    expect(
      canAssignTerritory([
        [1, 1],
        [2, 2],
        [3, 3],
      ]),
    ).toBe(true);
    expect(
      canAssignTerritory([
        [1, 1],
        [2, 2],
        [3, 3],
        [4, 4],
      ]),
    ).toBe(true);
  });
});

describe('buildDraftPolygon (live draft polygon preview)', () => {
  it('returns null below 3 vertices', () => {
    expect(buildDraftPolygon([])).toBeNull();
    expect(buildDraftPolygon([[1, 1]])).toBeNull();
  });

  it('closes the ring by repeating the first vertex at ≥3 vertices', () => {
    const vertices: [number, number][] = [
      [1, 1],
      [2, 2],
      [3, 1],
    ];
    const feature = buildDraftPolygon(vertices);
    expect(feature?.geometry.coordinates).toEqual([
      [
        [1, 1],
        [2, 2],
        [3, 1],
        [1, 1],
      ],
    ]);
  });
});

describe('assignTerritory (`Gebiet zuweisen` submit)', () => {
  it('submits a closed-ring polygon via territoriesRepo.submitBoundary', async () => {
    const repo = fakeRepo();
    const vertices: [number, number][] = [
      [1, 1],
      [2, 2],
      [3, 1],
    ];

    await assignTerritory({ repo, territoryId: 'territory-1', vertices });

    expect(repo.submitBoundary).toHaveBeenCalledExactlyOnceWith('territory-1', {
      type: 'Polygon',
      coordinates: [
        [
          [1, 1],
          [2, 2],
          [3, 1],
          [1, 1],
        ],
      ],
    });
  });

  it('throws below 3 vertices — never submits a degenerate polygon, even if the disabled button is bypassed', async () => {
    const repo = fakeRepo();

    await expect(
      assignTerritory({
        repo,
        territoryId: 'territory-1',
        vertices: [
          [1, 1],
          [2, 2],
        ],
      }),
    ).rejects.toThrow(/at least 3 vertices/);
    expect(repo.submitBoundary).not.toHaveBeenCalled();
  });
});

describe('i18n copy (no hardcoded German strings in TerritoryDraw.tsx)', () => {
  it('every user-facing string comes from t(), not a literal German word', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./TerritoryDraw.tsx', import.meta.url));
    const source = readFileSync(sourcePath, 'utf-8');
    const germanWords = ['Gebiet zuweisen', 'Zeichnung verwerfen', 'Abbrechen'];
    for (const word of germanWords) {
      expect(source).not.toContain(`'${word}'`);
      expect(source).not.toContain(`"${word}"`);
    }
  });
});

describe('no freehand/drag drawing gesture', () => {
  it('TerritoryDraw.tsx contains no PanResponder / drag-gesture drawing implementation', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./TerritoryDraw.tsx', import.meta.url));
    const source = readFileSync(sourcePath, 'utf-8');
    expect(source).not.toContain('PanResponder');
    expect(source).not.toContain('onPanResponderMove');
  });
});
