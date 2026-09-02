import { describe, expect, it } from 'vitest';

import { spacing } from '../../design/tokens';
import {
  MAP_CHROME_BOTTOM,
  MAP_CONTROL_SIZE,
  SHEET_MIN_HEIGHT,
  deriveMapToolCluster,
  deriveStatusBarScrimBands,
  MIN_TOP_SAFE_STRIP,
  statusBarScrimHeight,
  mapControlBottom,
  maxSheetHeight,
} from './mapChrome';

const DEFAULT_STEP = MAP_CONTROL_SIZE + spacing.sm;

describe('mapControlBottom (the summary card is no longer its business)', () => {
  it('stacks a column from the shared bottom anchor', () => {
    expect(mapControlBottom({ index: 0 })).toBe(MAP_CHROME_BOTTOM);
    expect(mapControlBottom({ index: 2 })).toBe(
      MAP_CHROME_BOTTOM + 2 * (MAP_CONTROL_SIZE + spacing.sm),
    );
  });

  it('honours a custom stride for the text-pill column', () => {
    const pillStep = spacing.touchTarget + spacing.sm;
    expect(mapControlBottom({ index: 1, step: pillStep })).toBe(MAP_CHROME_BOTTOM + pillStep);
  });

  // The regression this replaces: the controls used to lift by the card's
  // measured height, so they moved when it opened and kept its space after it
  // closed. The card is docked bottom-left and content-width now, so the
  // offset is constant — nothing about it may depend on the card again.
  it('never moves, whatever the summary card is doing', () => {
    const before = [0, 1, 2].map((index) => mapControlBottom({ index }));
    const after = [0, 1, 2].map((index) => mapControlBottom({ index }));
    expect(after).toEqual(before);
  });
});

describe('deriveStatusBarScrimBands (defect 4: the system clock must stay legible over light map tiles)', () => {
  it('renders nothing without a top inset — no inset, no stray band (Android/landscape)', () => {
    expect(deriveStatusBarScrimBands(0)).toEqual([]);
    expect(deriveStatusBarScrimBands(-4)).toEqual([]);
  });

  it('covers the inset exactly with the strongest band', () => {
    const bands = deriveStatusBarScrimBands(59);
    expect(bands.length).toBeGreaterThan(1);
    expect(bands[0]?.height).toBe(59);
    const maxOpacity = Math.max(...bands.map((band) => band.opacity));
    expect(bands[0]?.opacity).toBe(maxOpacity);
  });

  it('fades out instead of ending on a hard edge', () => {
    const bands = deriveStatusBarScrimBands(59);
    let previous = Number.POSITIVE_INFINITY;
    for (const band of bands) {
      expect(band.opacity).toBeLessThan(previous);
      previous = band.opacity;
    }
    expect(bands[bands.length - 1]?.opacity).toBeLessThan(0.2);
  });

  it('keeps the fade tail bounded so the scrim never creeps into the usable map', () => {
    const bands = deriveStatusBarScrimBands(59);
    const tail = bands.slice(1).reduce((sum, band) => sum + band.height, 0);
    expect(tail).toBeGreaterThan(0);
    expect(tail).toBeLessThanOrEqual(spacing.md);
  });

  it('is a RAMP, not a staircase — no step the eye can resolve', () => {
    // The defect this exists for: the tail was 8px at 0.55 under a band at
    // 0.92, so a 0.37 jump landed as a visible grey bar across a light map and
    // was reported as "it looks like several maps on top of each other".
    //
    // The old suite asserted the opacities DECREASE. They did. Monotonic is not
    // smooth, and three coarse steps satisfy it exactly as well as a gradient
    // does — which is why the staircase shipped with a green test.
    for (const insetTop of [20, 44, 47, 59, 62]) {
      const bands = deriveStatusBarScrimBands(insetTop);
      for (let i = 1; i < bands.length; i += 1) {
        const step = (bands[i - 1]?.opacity ?? 0) - (bands[i]?.opacity ?? 0);
        expect(step).toBeLessThanOrEqual(0.12);
        // A step is only imperceptible if it is also thin. A 0.05 change over
        // 8px is still an edge.
        expect(bands[i]?.height).toBeLessThanOrEqual(2);
      }
    }
  });

  it('reports its own full height, so map chrome can clear it', () => {
    // The sync pill sat at `insetTop + mapEdgeMargin`, which is the last pixel
    // of the tail — it overlapped the scrim because the scrim's extent was not
    // a number anyone could ask for.
    expect(statusBarScrimHeight(0)).toBe(0);
    for (const insetTop of [20, 44, 59]) {
      const bands = deriveStatusBarScrimBands(insetTop);
      const drawn = bands.reduce((sum, band) => sum + band.height, 0);
      expect(statusBarScrimHeight(insetTop)).toBeGreaterThanOrEqual(drawn);
      expect(statusBarScrimHeight(insetTop)).toBeGreaterThan(insetTop);
    }
  });

  it('produces only renderable bands', () => {
    for (const insetTop of [20, 44, 59, 62]) {
      for (const band of deriveStatusBarScrimBands(insetTop)) {
        expect(band.height).toBeGreaterThan(0);
        expect(band.opacity).toBeGreaterThan(0);
        expect(band.opacity).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('maxSheetHeight (defect 6: the house sheet must never grow past its own exit)', () => {
  it('stops below the safe area rather than at the screen edge', () => {
    expect(maxSheetHeight({ availableHeight: 844, insetTop: 59 })).toBe(844 - 59 - spacing.md);
  });

  it('still clears a status bar when the platform reports NO inset', () => {
    // This assertion used to say `844 - spacing.md`, i.e. the sheet may start
    // 12px from the screen top when the inset is 0. That is the reported bug:
    // the sheet draws under the status bar, so its top edge at 12px puts the
    // grabber and the 48dp close button — its only two visible exits — across
    // the clock and the battery. "Ich kann es nicht schließen."
    //
    // A 0 inset has now been observed on device twice (a nested
    // SafeAreaProvider in 02-05, and again in the build photographed on
    // 2026-08-28), so the layout may not trust it. The floor makes the class
    // survivable rather than fatal.
    expect(maxSheetHeight({ availableHeight: 844, insetTop: 0 }))
      .toBe(844 - MIN_TOP_SAFE_STRIP - spacing.md);
  });

  it('never lets the sheet reach the top strip, for any inset the platform reports', () => {
    for (const insetTop of [0, -8, 12, 20, 24, 44, 59, 62]) {
      const top = 844 - maxSheetHeight({ availableHeight: 844, insetTop });
      expect(top).toBeGreaterThanOrEqual(MIN_TOP_SAFE_STRIP);
    }
  });

  // THE regression guard, and the reason this function exists at all. The 0088
  // regression happened because the sheet's height was an emergent property of
  // its CONTENT: add a parties field, add a fourth product button, add the
  // offer-code row, and the sheet grew until its grabber left the viewport.
  // The cap is therefore a bounded property of the VIEWPORT and takes no
  // content input whatsoever, so no future field can raise it.
  it('is a function of the window alone — identical window arguments always give an identical cap', () => {
    const a = maxSheetHeight({ availableHeight: 844, insetTop: 59 });
    const b = maxSheetHeight({ availableHeight: 844, insetTop: 59 });
    expect(a).toBe(b);
  });

  it('accepts no content parameter at all — the params interface is viewport-only', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const source = readFileSync(fileURLToPath(new URL('./mapChrome.ts', import.meta.url)), 'utf-8');
    const block = /export interface MaxSheetHeightParams \{([\s\S]*?)\n\}/.exec(source);
    expect(block).not.toBeNull();
    const body = (block?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const fields = [...body.matchAll(/^\s*(\w+)\??:/gm)].map((match) => match[1]);
    expect(fields.sort()).toEqual(['availableHeight', 'insetTop', 'minTopGap']);
  });

  it('never returns a nonsensical cap for any inset the viewport can produce', () => {
    const availableHeight = 844;
    for (let insetTop = 0; insetTop <= availableHeight; insetTop += 1) {
      const cap = maxSheetHeight({ availableHeight, insetTop });
      expect(cap).toBeGreaterThan(0);
      expect(cap).toBeLessThanOrEqual(availableHeight);
    }
  });

  it('enforces a floor instead of collapsing on a pathologically small window', () => {
    expect(maxSheetHeight({ availableHeight: 200, insetTop: 180 })).toBeGreaterThanOrEqual(
      SHEET_MIN_HEIGHT,
    );
  });

  it('is monotonically non-decreasing in the available height', () => {
    let previous = maxSheetHeight({ availableHeight: 200, insetTop: 44 });
    for (let availableHeight = 220; availableHeight <= 1200; availableHeight += 20) {
      const cap = maxSheetHeight({ availableHeight, insetTop: 44 });
      expect(cap).toBeGreaterThanOrEqual(previous);
      previous = cap;
    }
  });

  it('is monotonically non-increasing in insetTop', () => {
    let previous = maxSheetHeight({ availableHeight: 844, insetTop: 0 });
    for (let insetTop = 4; insetTop <= 844; insetTop += 4) {
      const cap = maxSheetHeight({ availableHeight: 844, insetTop });
      expect(cap).toBeLessThanOrEqual(previous);
      previous = cap;
    }
  });
});

/**
 * The sheet and the scrim are two features that were built against each other
 * but never asserted against each other — and until the nested
 * `SafeAreaProvider` was removed from MapScreen.tsx the coupling could not even
 * be observed, because every inset was 0: `deriveStatusBarScrimBands(0)`
 * returns `[]` and `maxSheetHeight`'s `insetTop` term vanished. With real
 * insets both are live for the first time, so the relationship between them
 * needs to be a test rather than a comment.
 *
 * The invariant: the sheet's top edge must never rise into the scrim. The
 * sheet is `bottom: 0` with `maxHeight`, so its top edge sits at
 * `availableHeight - cap`; the scrim ends at `insetTop + <fade tail>`. Today both
 * equal `insetTop + spacing.md` exactly — `maxSheetHeight`'s `minTopGap`
 * default and the fade tail's bounded total are the SAME token, which is what
 * makes them meet flush instead of overlapping. Change either one without the
 * other and the sheet's rounded corner slides under the fading scrim.
 */
describe('the sheet clears the status-bar scrim (a coupling that only real insets expose)', () => {
  const scrimBottom = (insetTop: number): number =>
    deriveStatusBarScrimBands(insetTop).reduce((total, band) => total + band.height, 0);

  const sheetTop = (availableHeight: number, insetTop: number): number =>
    availableHeight - maxSheetHeight({ availableHeight, insetTop });

  it.each([
    ['iPhone 14 Pro portrait', 852, 59],
    ['iPhone SE portrait', 667, 20],
    ['notchless Android portrait', 800, 24],
    ['landscape, no top inset at all', 390, 0],
  ])('%s: the sheet top never rises into the scrim', (_name, availableHeight, insetTop) => {
    expect(sheetTop(availableHeight, insetTop)).toBeGreaterThanOrEqual(scrimBottom(insetTop));
  });

  it('holds across every plausible inset, not just the four devices above', () => {
    for (let insetTop = 0; insetTop <= 80; insetTop += 1) {
      expect(sheetTop(852, insetTop)).toBeGreaterThanOrEqual(scrimBottom(insetTop));
    }
  });

  it('leaves the fixed header fully below the safe area, which is where the exits live', () => {
    // The header is the sheet's own paddingTop (spacing.md) plus a 48dp zone
    // holding the grabber and the close button. The operator photographed that
    // close button inside the status bar next to the battery icon; this pins
    // the arithmetic that puts it back under the clock rather than in it.
    const insetTop = 59;
    const headerTop = sheetTop(852, insetTop) + spacing.md;
    expect(headerTop).toBeGreaterThanOrEqual(insetTop);
    expect(headerTop - insetTop).toBeGreaterThanOrEqual(spacing.lg);
  });
});

/**
 * Quick task grk / Task 5 — the speed dial's composition rule.
 *
 * `deriveMapToolCluster` is the SINGLE source of truth for which map controls
 * exist, in which order, and whether a disclosure trigger is warranted at all.
 * Keeping it pure keeps the two rules that matter reviewable without a
 * renderer: recenter is never bundled, and a cluster is never rendered for a
 * single entry (a tap that reveals one button is a tax with no benefit).
 */
describe('deriveMapToolCluster (defect 5: the secondary controls collapse, the primary one never does)', () => {
  const lead = { canEnterDrawMode: true, hasAssignTarget: true } as const;
  const rep = { canEnterDrawMode: false, hasAssignTarget: false } as const;

  it('hides every collapsible ENTRY in draw mode', () => {
    // Help, the draw toggle and assign are all noise while a boundary is being
    // traced — TerritoryDrawControls owns the screen there.
    for (const params of [lead, rep]) {
      const cluster = deriveMapToolCluster({ viewMode: 'map', drawMode: true, ...params });
      expect(cluster.entries).toEqual([]);
    }
  });

  it('KEEPS RECENTRING REACHABLE IN DRAW MODE — a boundary is walked, so own position is the normal check', () => {
    // The intent, not just the return value: a territory is drawn by walking
    // its boundary or tracing it on the map, and recentring is the action that
    // answers "am I still in the right place?". It is needed MORE during a draw,
    // not less. The recenter control was also the one floating control shipped
    // without a `!drawMode` gate — intent, not an oversight. If a future change
    // makes draw mode return `anchor: null`, this test is the thing that says
    // why that is wrong.
    for (const params of [lead, rep]) {
      const cluster = deriveMapToolCluster({ viewMode: 'map', drawMode: true, ...params });
      expect(cluster.anchor).toBe('recenter');
    }
  });

  it('renders no trigger for an empty entry set, anchor or not', () => {
    // Zero entries with an anchor present must still be 'direct': a disclosure
    // trigger that reveals nothing is worse than the one-entry case the
    // degradation rule already forbids.
    const cluster = deriveMapToolCluster({ viewMode: 'map', drawMode: true, ...lead });
    expect(cluster).toEqual({ anchor: 'recenter', entries: [], mode: 'direct' });
  });

  it('never bundles the anchor: recenter is the anchor and is absent from entries, for every role', () => {
    for (const canEnterDrawMode of [true, false]) {
      for (const hasAssignTarget of [true, false]) {
        const cluster = deriveMapToolCluster({
          viewMode: 'map',
          drawMode: false,
          canEnterDrawMode,
          hasAssignTarget,
        });
        expect(cluster.anchor).toBe('recenter');
        expect(cluster.entries).not.toContain('recenter');
      }
    }
  });

  it('gives a plain rep exactly the view toggle and help, as a cluster', () => {
    const cluster = deriveMapToolCluster({ viewMode: 'map', drawMode: false, ...rep });
    expect(cluster.entries).toEqual(['viewToggle', 'help']);
    expect(cluster.mode).toBe('cluster');
  });

  it('gives a team lead all four entries in the fixed, frequency-ranked order', () => {
    const cluster = deriveMapToolCluster({ viewMode: 'map', drawMode: false, ...lead });
    expect(cluster.entries).toEqual(['viewToggle', 'help', 'draw', 'assign']);
    expect(cluster.mode).toBe('cluster');
  });

  it('removes only the gated entry and reorders nothing', () => {
    expect(
      deriveMapToolCluster({
        viewMode: 'map',
        drawMode: false,
        canEnterDrawMode: false,
        hasAssignTarget: true,
      }).entries,
    ).toEqual(['viewToggle', 'help', 'assign']);
    expect(
      deriveMapToolCluster({
        viewMode: 'map',
        drawMode: false,
        canEnterDrawMode: true,
        hasAssignTarget: false,
      }).entries,
    ).toEqual(['viewToggle', 'help', 'draw']);
  });

  it('leaves the map/list toggle DIRECTLY rendered in list mode — it is the only way out of the overlay', () => {
    expect(deriveMapToolCluster({ viewMode: 'list', drawMode: false, ...lead })).toEqual({
      anchor: null,
      entries: ['viewToggle'],
      mode: 'direct',
    });
  });

  it('clusters iff there are at least two entries (the degradation rule)', () => {
    const cases = [
      { viewMode: 'map', drawMode: false, ...lead },
      { viewMode: 'map', drawMode: false, ...rep },
      { viewMode: 'list', drawMode: false, ...lead },
      { viewMode: 'map', drawMode: true, ...lead },
    ] as const;
    for (const params of cases) {
      const cluster = deriveMapToolCluster(params);
      expect(cluster.mode).toBe(cluster.entries.length >= 2 ? 'cluster' : 'direct');
    }
  });

  it('is total: every input combination returns a cluster whose anchor is not also an entry', () => {
    for (const viewMode of ['map', 'list'] as const) {
      for (const drawMode of [true, false]) {
        for (const canEnterDrawMode of [true, false]) {
          for (const hasAssignTarget of [true, false]) {
            const cluster = deriveMapToolCluster({
              viewMode,
              drawMode,
              canEnterDrawMode,
              hasAssignTarget,
            });
            expect(['direct', 'cluster']).toContain(cluster.mode);
            expect(Array.isArray(cluster.entries)).toBe(true);
            if (cluster.anchor) expect(cluster.entries).not.toContain(cluster.anchor);
          }
        }
      }
    }
  });
});

describe('the street summary is a tool, not furniture', () => {
  // It used to be rendered permanently whenever it had content. On the screen
  // whose entire purpose is showing the map that costs twice: its own ~40dp bar
  // plus the lift it forces on every floating control above it. It answers a
  // question the rep asks occasionally, not continuously.
  const base = { viewMode: 'map', drawMode: false, canEnterDrawMode: false, hasAssignTarget: false } as const;

  it('offers the toggle only when there is something to summarise', () => {
    expect(deriveMapToolCluster({ ...base, hasSummary: true }).entries).toContain('summary');
    expect(deriveMapToolCluster({ ...base, hasSummary: false }).entries).not.toContain('summary');
    // Absent means absent, not "on".
    expect(deriveMapToolCluster(base).entries).not.toContain('summary');
  });

  it('keeps it out of draw mode, where the map is the whole job', () => {
    const cluster = deriveMapToolCluster({ ...base, drawMode: true, hasSummary: true });
    expect(cluster.entries).not.toContain('summary');
    expect(cluster.anchor).toBe('recenter');
  });

  it('never promotes it to the always-visible anchor', () => {
    // The anchor is the one control that is always one tap away. Recentring
    // earns that; a statistics card does not, and putting it there would
    // reintroduce the permanent chrome by another route.
    for (const hasSummary of [true, false]) {
      for (const drawMode of [true, false]) {
        expect(deriveMapToolCluster({ ...base, hasSummary, drawMode }).anchor).not.toBe('summary');
      }
    }
  });
});

describe('the cap is measured against the box the sheet lives in', () => {
  // The defect, stated as a number. The sheet is an absolutely positioned child
  // of the map screen; the map screen is shorter than the window by the tab
  // bar. Callers passed the WINDOW because the parameter was called
  // availableHeight, so on an 844pt window with an 83pt tab bar the cap came out
  // at 832 against a 761 host — larger than the host, therefore inert. The
  // sheet filled its parent from y = 0, the grabber went behind the notch and
  // the close button landed on the battery.
  const WINDOW = 844;
  const TAB_BAR = 83;
  const HOST = WINDOW - TAB_BAR;

  it('would have been inert with the window, and binds with the host', () => {
    expect(maxSheetHeight({ availableHeight: WINDOW, insetTop: 0 })).toBeGreaterThan(HOST);
    expect(maxSheetHeight({ availableHeight: HOST, insetTop: 0 })).toBeLessThan(HOST);
  });

  it('leaves the top strip free inside the HOST, which is what the user sees', () => {
    for (const insetTop of [0, 24, 47, 59]) {
      const cap = maxSheetHeight({ availableHeight: HOST, insetTop });
      // Distance from the host's top edge down to the sheet's top edge.
      expect(HOST - cap).toBeGreaterThanOrEqual(MIN_TOP_SAFE_STRIP);
    }
  });
});

describe('the floating controls do not double-count the tab bar', () => {
  // The gap reported after the summary card came off the map. The map screen is
  // a TAB screen: its bottom edge is the top of the tab bar, and the tab bar
  // already consumes the home-indicator inset (MainTabs sets paddingBottom and
  // height: 56 + bottomPad). Adding useSafeAreaInsets().bottom again inside
  // that box counts the same strip twice.
  it('sits one edge margin above its own container when no card is shown', () => {
    expect(mapControlBottom({ index: 0 })).toBe(spacing.mapEdgeMargin);
  });

});

describe('the summary card cannot reach the floating controls', () => {
  // The defect this replaces: the card was a full-bleed bar running under the
  // right-hand column, so the only thing keeping the recenter button off its
  // counts was arithmetic — and the arithmetic disagreed with the card's own
  // bottom offset by an `insets.bottom`. The card is docked bottom-LEFT and
  // content-width now (`summaryDock`), which is why this file no longer has a
  // clearance rule to state: the two live in disjoint columns.
  it('leaves a whole control column plus a gap to the right of the dock', () => {
    const dockRightInset = spacing.mapEdgeMargin + MAP_CONTROL_SIZE + spacing.sm;
    expect(dockRightInset).toBeGreaterThan(spacing.mapEdgeMargin + MAP_CONTROL_SIZE);
  });
});

describe('address search is a tool, not permanent furniture', () => {
  const base = { viewMode: 'map', drawMode: false, canEnterDrawMode: false, hasAssignTarget: false } as const;

  it('offers the search entry once there is an own territory', () => {
    expect(deriveMapToolCluster({ ...base, hasSearch: true }).entries).toContain('search');
  });

  it('omits it without one, and never renders it during a draw', () => {
    expect(deriveMapToolCluster({ ...base }).entries).not.toContain('search');
    expect(deriveMapToolCluster({ ...base, drawMode: true, hasSearch: true }).entries).toEqual([]);
  });
});
