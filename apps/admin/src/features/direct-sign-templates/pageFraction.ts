/**
 * PURE coordinate conversion (D-03/Pitfall 6, the load-bearing, independently
 * testable half of PlacementStep.tsx): a click at screen (clickX, clickY)
 * relative to the rendered page's top-left corner maps to a normalized [0,1]
 * fraction of the ACTUAL rendered page dimensions — resolution-independent,
 * so the same relative position always yields the same fraction regardless of
 * zoom/DPI. Returns null for a degenerate rect or an out-of-bounds click
 * (never clamps silently — an out-of-bounds click is a caller bug, not a
 * valid placement).
 *
 * Deliberately dependency-free (no pdfjs-dist import): pdfjs-dist requires
 * browser-only globals (DOMMatrix etc.) that are unavailable in the jsdom
 * test environment at module-import time, so the coordinate math — the part
 * the plan calls out as load-bearing and unit-testable — is isolated here,
 * away from PlacementStep.tsx's pdfjs-dist import (the canvas render itself
 * is exercised on the manual admin pass, Plan 10-10).
 */

export interface PageRect {
  width: number;
  height: number;
}

export interface PageFraction {
  xFrac: number;
  yFrac: number;
}

export function screenToPageFraction(rect: PageRect, clickX: number, clickY: number): PageFraction | null {
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  const xFrac = clickX / rect.width;
  const yFrac = clickY / rect.height;
  if (xFrac < 0 || xFrac > 1 || yFrac < 0 || yFrac > 1) {
    return null;
  }
  return { xFrac, yFrac };
}
