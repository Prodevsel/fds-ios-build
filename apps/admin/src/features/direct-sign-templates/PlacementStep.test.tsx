import { describe, expect, it } from 'vitest';
import { screenToPageFraction } from './pageFraction';

/**
 * Pitfall 6 (10-RESEARCH.md): the signature anchor MUST be captured in
 * PDF-page-space (page + normalized 0-1 fraction of the ACTUAL rendered page
 * dimensions), never raw screen pixels — this pure conversion is the
 * load-bearing, unit-testable half of PlacementStep (the canvas render itself
 * is verified on the manual admin pass, Plan 10-10).
 */
describe('screenToPageFraction (D-03/Pitfall 6)', () => {
  it('maps a click at the top-left corner to {0,0}', () => {
    const result = screenToPageFraction({ width: 600, height: 800 }, 0, 0);
    expect(result).toEqual({ xFrac: 0, yFrac: 0 });
  });

  it('maps a click at the bottom-right corner to {1,1}', () => {
    const result = screenToPageFraction({ width: 600, height: 800 }, 600, 800);
    expect(result).toEqual({ xFrac: 1, yFrac: 1 });
  });

  it('maps a click at the center to {0.5,0.5}', () => {
    const result = screenToPageFraction({ width: 600, height: 800 }, 300, 400);
    expect(result).toEqual({ xFrac: 0.5, yFrac: 0.5 });
  });

  it('normalizes proportionally regardless of the rendered page size (resolution-independent)', () => {
    // Same relative position (25%, 75%) at two different zoom/render sizes must
    // produce the SAME normalized fraction — this is exactly what makes the
    // anchor reusable by the server assembler (10-04) at the PDF's real point
    // size, independent of whatever pixel size the admin browser rendered.
    const small = screenToPageFraction({ width: 300, height: 400 }, 75, 300);
    const large = screenToPageFraction({ width: 1200, height: 1600 }, 300, 1200);
    expect(small).toEqual({ xFrac: 0.25, yFrac: 0.75 });
    expect(large).toEqual({ xFrac: 0.25, yFrac: 0.75 });
  });

  it('rejects a click outside the rendered page bounds (negative)', () => {
    expect(screenToPageFraction({ width: 600, height: 800 }, -1, 400)).toBeNull();
  });

  it('rejects a click outside the rendered page bounds (beyond width/height)', () => {
    expect(screenToPageFraction({ width: 600, height: 800 }, 601, 400)).toBeNull();
    expect(screenToPageFraction({ width: 600, height: 800 }, 300, 801)).toBeNull();
  });

  it('rejects a degenerate (zero-size) rendered page rect', () => {
    expect(screenToPageFraction({ width: 0, height: 800 }, 0, 0)).toBeNull();
    expect(screenToPageFraction({ width: 600, height: 0 }, 0, 0)).toBeNull();
  });
});
