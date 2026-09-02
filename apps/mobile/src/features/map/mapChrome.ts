/**
 * Pure map-chrome geometry. No React, no react-native import — every value is
 * derived from the design tokens, so the whole module is unit-testable under
 * vitest/node without a renderer (this repo has no `react-test-renderer`).
 *
 * Owns the answer to "how far above the bottom edge does floating control N
 * sit?", which used to be inline arithmetic repeated at five call sites in
 * `MapScreen.tsx`.
 */
import { spacing } from '../../design/tokens';

/** Floating map-control edge length (recenter / help "?" / map-list toggle), from the design SSOT. */
export const MAP_CONTROL_SIZE = 52;

/**
 * The ONE bottom anchor every piece of map chrome sits on.
 *
 * The summary card used to add `useSafeAreaInsets().bottom` on top of this
 * while `mapControlBottom` deliberately did not, so the card floated ~34dp
 * higher than the lift math believed and the floating controls came down ON
 * TOP of it — the recenter button covered the card's own counts. Both call
 * sites read this constant now; a future divergence has to be typed out
 * explicitly instead of hiding in an inset.
 */
export const MAP_CHROME_BOTTOM = spacing.mapEdgeMargin;

export interface MapControlBottomParams {
  /** 0-based step within a floating-control column, counted from the bottom. */
  index: number;
  /**
   * Vertical stride between two controls in this column. Defaults to the 52dp
   * FAB column; the bottom-left column stacks text pills and passes
   * `spacing.touchTarget + spacing.sm` instead.
   */
  step?: number;
}

/**
 * Bottom offset (dp) of the `index`-th floating control in a column.
 *
 * ── It no longer lifts for the summary card, and that is the fix ────────────
 * This used to take the card's measured height and hoist the whole right-hand
 * column above it, because the card was a full-bleed bar spanning both edge
 * margins — it ran straight under the controls, so the only way past it was
 * arithmetic. Two defects came out of that coupling: the controls kept the
 * card's space after it was hidden, and the card's own bottom offset drifted
 * from this one by an `insets.bottom`, which put the recenter button on top of
 * the counts the card exists to show.
 *
 * The card is content-width and bottom-LEFT now (`summaryDock` in MapScreen),
 * so it cannot reach the right-hand column at all. Overlap is prevented by
 * geometry rather than by measurement, the controls stop moving when the card
 * opens, and this function has nothing left to know about it.
 *
 * ── No bottom inset ─────────────────────────────────────────────────────────
 * The map screen is a tab screen: its bottom edge IS the top of the tab bar,
 * and the tab bar already consumes the home-indicator inset itself
 * (MainTabs.tsx sets `paddingBottom: bottomPad` and `height: 56 + bottomPad`).
 * Adding `useSafeAreaInsets().bottom` again inside that box counts the same
 * strip twice and floats every control ~34dp too high.
 */
export function mapControlBottom({
  index,
  step = MAP_CONTROL_SIZE + spacing.sm,
}: MapControlBottomParams): number {
  return MAP_CHROME_BOTTOM + index * step;
}

/**
 * Minimum top strip to keep clear, whatever the platform reports.
 *
 * `useSafeAreaInsets().top` has come back as 0 on device more than once here —
 * a nested SafeAreaProvider did it in 02-05, and the reported symptom this time
 * was the house sheet's close button sitting on the battery icon, which is
 * exactly what a 0 inset produces: sheet top at 12px, the 48dp close box from
 * 28 to 76, its centre at 52 — the status bar.
 *
 * Chasing the provider is the right fix and has been done once already. This is
 * the floor that makes the class of bug non-fatal: a screen that draws under
 * the status bar reserves at least a status bar's worth of room, so the only
 * exit from the app's primary interaction can never land under the clock, on
 * any device, whatever the inset says. 24dp is the smallest real status bar
 * (Android pre-notch); on a notched iPhone the true inset is larger and wins.
 */
export const MIN_TOP_SAFE_STRIP = 24;

/** The inset to lay out against: what the platform says, or the floor. */
export function effectiveTopInset(insetTop: number): number {
  return Math.max(insetTop, MIN_TOP_SAFE_STRIP);
}

export interface StatusBarScrimBand {
  /** dp tall. */
  height: number;
  /** 0 < opacity <= 1, applied to the theme's background tone. */
  opacity: number;
}

/**
 * The fade below the near-opaque strip, as a RAMP rather than a few steps.
 *
 * It used to be three bands — 8px at 0.55, 4px at 0.30, 4px at 0.12 — under a
 * band at 0.92. On a light map that reads as a separate grey bar with a visible
 * edge under the status bar, and the reported symptom was "it looks like
 * several maps lying on top of each other". It was one scrim with a staircase
 * in it.
 *
 * The old test asserted the opacities DECREASE, which they did. Monotonic is
 * not the same as smooth, and that gap is exactly the defect: a property that
 * three coarse steps satisfy just as well as a gradient.
 *
 * 1px bands make each step smaller than the eye resolves at this contrast, so
 * the same total height now reads as a gradient. No dependency: this is
 * 16 views, and expo-linear-gradient would be a native module in the render
 * path of the app's primary screen for one decoration.
 */
const SCRIM_TAIL_HEIGHT = spacing.md;
const SCRIM_TAIL_STEP = 1;
/** Fast initial falloff, long approach to zero — reads better against a solid. */
const SCRIM_TAIL_EASE = 1.6;

/** Opacity of the band that sits directly under the status-bar glyphs. */
const SCRIM_PEAK_OPACITY = 0.92;

/**
 * Bands for the status-bar scrim, top-down: one near-opaque band exactly as
 * tall as the safe-area inset (the strip the clock and the indicators occupy),
 * then the fade tail below it.
 *
 * Returns `[]` when there is no top inset at all (most Android devices,
 * landscape) — no inset means no clock strip to protect, and a stray band there
 * would just be a bar across the map.
 */
export function deriveStatusBarScrimBands(insetTop: number): StatusBarScrimBand[] {
  if (insetTop <= 0) return [];
  const steps = Math.round(SCRIM_TAIL_HEIGHT / SCRIM_TAIL_STEP);
  const tail: StatusBarScrimBand[] = [];
  for (let i = 1; i <= steps; i += 1) {
    tail.push({
      height: SCRIM_TAIL_STEP,
      opacity: SCRIM_PEAK_OPACITY * Math.pow(1 - i / steps, SCRIM_TAIL_EASE),
    });
  }
  // The last band would be exactly 0 and is not worth rendering.
  return [{ height: insetTop, opacity: SCRIM_PEAK_OPACITY }, ...tail.filter((b) => b.opacity > 0)];
}

/**
 * Total height the scrim occupies, inset included.
 *
 * Exported because anything the map floats near the top edge has to clear it.
 * The sync dot sat at `insetTop + mapEdgeMargin`, which put its top edge
 * exactly on the tail's last pixel — it was reported as overlapping the status
 * bar, and it was: the scrim's own extent was never a number anyone could ask
 * for, so the placement was a guess that happened to collide.
 */
export function statusBarScrimHeight(insetTop: number): number {
  return insetTop <= 0 ? 0 : insetTop + SCRIM_TAIL_HEIGHT;
}

/**
 * Where map chrome may start below the top edge.
 *
 * Not `statusBarScrimHeight`: that is 0 when the inset is 0, and a control at
 * 8px is under the clock on every phone that has one. This clears the scrim
 * when there is one and the floor when there is not.
 */
export function mapChromeTop(insetTop: number, gap: number): number {
  return Math.max(statusBarScrimHeight(insetTop), effectiveTopInset(insetTop)) + gap;
}

/**
 * Absolute floor for the house sheet's height cap.
 *
 * A pathologically small window (split view, a tiny simulator, a future foldable
 * cover display) must never compute a negative or unusably tiny cap — the sheet
 * would then have room for its header and nothing else, or for nothing at all.
 * At this floor the fixed header (grabber + 48dp close button) plus a scrollable
 * remainder still fit, so all three exits stay operable.
 */
export const SHEET_MIN_HEIGHT = 160;

export interface MaxSheetHeightParams {
  /**
   * The height of the box the sheet is actually laid out in — NOT the window.
   *
   * This parameter was called `windowHeight` and callers duly passed
   * `useWindowDimensions().height`. The sheet is an absolutely positioned child
   * of the map screen, and the map screen is shorter than the window by the tab
   * bar: 844 window, ~83 tab bar, 761 available. The cap came out at
   * 844 - 0 - 12 = 832, which is larger than 761, so it NEVER BOUND. The sheet
   * filled its parent from y = 0, the grabber landed behind the notch and the
   * close button landed on the battery — the reported "das X ist über der
   * Batterie und ich kann es nicht schließen".
   *
   * A cap computed against a box the element does not live in is not a cap.
   * The name is part of the fix: it is what made passing the wrong number look
   * correct.
   */
  availableHeight: number;
  /** `useSafeAreaInsets().top`. */
  insetTop: number;
  /**
   * Gap kept between the sheet's rounded top edge and the safe area, so the
   * sheet never collides with the status-bar scrim.
   */
  minTopGap?: number;
}

/**
 * The height the house sheet may never exceed.
 *
 * DELIBERATELY viewport-only: there is no content parameter, and adding one would
 * re-create the bug this function exists to prevent. The 0088 regression
 * happened precisely because the sheet's height was an EMERGENT property of its
 * content — `styles.sheet` had no `maxHeight`, so the sheet was as tall as its
 * children summed to, and the grabber (its only exit, pinned to the top edge)
 * left the viewport as soon as the parties field, the product buttons and the
 * offer-code row were added. Height is therefore a BOUNDED property of the
 * viewport here: no future field can raise this number.
 */
export function maxSheetHeight({
  availableHeight,
  insetTop,
  minTopGap = spacing.md,
}: MaxSheetHeightParams): number {
  // effectiveTopInset, not insetTop: a 0 inset would put the sheet's top edge —
  // and with it the grabber and the close button, its only two visible exits —
  // 12px from the screen top, i.e. under the status bar. That is the reported
  // "the X sits on the battery and I cannot close it".
  const available = availableHeight - effectiveTopInset(insetTop) - minTopGap;
  // The floor comes first, then the window itself clamps it: on a window so
  // small that even the floor does not fit, "the whole window" is the only
  // honest answer, and it is still > 0.
  return Math.min(availableHeight, Math.max(SHEET_MIN_HEIGHT, available));
}

/** Every floating control the map screen owns. */
export type MapToolId =
  | 'recenter'
  | 'search'
  | 'filter'
  | 'viewToggle'
  | 'summary'
  | 'help'
  | 'draw'
  | 'assign';

export interface MapToolCluster {
  /**
   * The control that is ALWAYS one tap away, rendered outside the cluster.
   * `null` while no anchor is warranted (draw mode, list mode).
   */
  anchor: MapToolId | null;
  /** The collapsible entries, nearest-the-trigger first. */
  entries: MapToolId[];
  /** `cluster` = render a disclosure trigger; `direct` = render the entries inline. */
  mode: 'direct' | 'cluster';
}

/**
 * Fixed, frequency-ranked entry order, nearest the trigger first: the map/list
 * toggle is a per-session mode switch, help is an onboarding legend, and
 * draw/assign are lead-only territory-lifecycle actions used a handful of times
 * ever. Recenter is deliberately absent — see `deriveMapToolCluster`.
 */
const MAP_TOOL_ENTRY_ORDER: readonly MapToolId[] = [
  // Address search is a TOOL for the same reason the summary is one: a
  // permanent field across the top of the map spends the screen's whole
  // purpose on a question that is asked a few times a day. It opens on a tap
  // and takes the map's space only while it is being used.
  'search',
  // Hiding finished doors is what makes a real territory readable, so it sits
  // next to search rather than down with the lead-only lifecycle actions.
  'filter',
  'viewToggle',
  // The street summary is a TOOL, not furniture. It used to sit on the map
  // permanently, and it cost twice: its own ~40dp bar plus the lift it forced
  // on every floating control above it, on the one screen whose whole job is
  // showing the map. It answers a question the rep asks occasionally ("how far
  // am I through this street"), not continuously.
  'summary',
  'help',
  'draw',
  'assign',
];

/**
 * Below this many entries a disclosure trigger is pure friction: an extra tap
 * that reveals a single button buys the user nothing and costs them a tap.
 */
const MAP_TOOL_CLUSTER_MIN_ENTRIES = 2;

export interface MapToolClusterParams {
  viewMode: 'map' | 'list';
  /**
   * There is an own territory, so an address search has somewhere to look.
   * Same conservative FALSE default as `hasSummary`.
   */
  hasSearch?: boolean;
  drawMode: boolean;
  /** Team lead standing on their own, still-undrawn territory. */
  canEnterDrawMode: boolean;
  /**
   * There is an own territory with houses, so a street summary has content.
   *
   * Optional and defaulting to FALSE on purpose: absent means "no summary
   * tool", which is the conservative answer. A caller that forgets to pass it
   * loses a control; the inverse default would put a control on the map that
   * opens an empty card.
   */
  hasSummary?: boolean;
  /** Team lead with an assignable territory under the current view. */
  hasAssignTarget: boolean;
}

/**
 * The single source of truth for WHICH map controls exist, in WHAT order, and
 * WHETHER a disclosure trigger is warranted.
 *
 * Two rules carry the whole design:
 *
 * 1. Recenter is the ANCHOR and is never bundled. Recentring on own position is
 *    the highest-frequency action on a field-sales map — it is used between
 *    doors, not once per session — so hiding it behind a disclosure would tax
 *    every single use. Help, draw and assign are all low-frequency and belong
 *    inside.
 * 2. A cluster needs at least two entries. With one entry the trigger is
 *    dropped and that entry renders inline; with none, nothing renders.
 *
 * The list-mode branch is not an optimisation but a safety rule: while the
 * house-list overlay covers the map, the map/list toggle is the ONLY way back
 * out, and every other control sits beneath the overlay. Burying that one
 * control behind a disclosure would strand the user, so list mode always
 * returns `mode: 'direct'` with the toggle as its sole entry — byte-for-byte
 * today's behaviour.
 *
 * Draw mode drops every ENTRY but deliberately keeps the ANCHOR — see the
 * branch comment below; it is the one place where the anchor and the entries
 * are gated differently, and that asymmetry is the point.
 *
 * The zero- and one-entry branches are not defensive decoration: draw mode
 * makes the zero-entry branch live today, and the one-entry branch becomes
 * live the moment any of the four controls gains a gate.
 */
export function deriveMapToolCluster({
  viewMode,
  drawMode,
  canEnterDrawMode,
  hasAssignTarget,
  hasSummary = false,
  hasSearch = false,
}: MapToolClusterParams): MapToolCluster {
  // Draw mode hides every ENTRY — help, the draw toggle itself and assign are
  // all noise while a boundary is being traced, and `TerritoryDrawControls`
  // owns the screen instead.
  //
  // The ANCHOR is the deliberate exception, and it must stay one: a territory
  // is drawn by walking its boundary or tracing it on the map, and recentring
  // on own position is how you check you are still in the right place. It is
  // the normal case during a draw, not an edge case — suppressing it here would
  // remove the action exactly where it is needed most. This is also why the
  // recenter control was the ONE floating control shipped without a `!drawMode`
  // gate; that was intent, not an oversight. Do not "unify" this branch with a
  // bare `{ anchor: null, entries: [] }`.
  //
  // Zero entries plus an anchor is `mode: 'direct'` — no trigger may be
  // rendered for an empty set.
  if (drawMode) return { anchor: 'recenter', entries: [], mode: 'direct' };

  if (viewMode === 'list') {
    return { anchor: null, entries: ['viewToggle'], mode: 'direct' };
  }

  const entries = MAP_TOOL_ENTRY_ORDER.filter((id) => {
    if (id === 'draw') return canEnterDrawMode;
    if (id === 'assign') return hasAssignTarget;
    // Nothing to summarise without an own territory that has houses in it.
    if (id === 'summary') return hasSummary;
    // Nothing to search without an own territory to search inside.
    if (id === 'search') return hasSearch;
    // Nothing to filter before there are pins to hide.
    if (id === 'filter') return hasSummary;
    return true;
  });

  return {
    anchor: 'recenter',
    entries,
    mode: entries.length >= MAP_TOOL_CLUSTER_MIN_ENTRIES ? 'cluster' : 'direct',
  };
}
