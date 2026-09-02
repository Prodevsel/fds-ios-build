/**
 * The slider's arithmetic, with no React and no react-native import.
 *
 * Same posture as `reviewRows.ts` and `map/buildingStatus.ts`: the mobile test
 * harness cannot parse a module that pulls in react-native, so anything that
 * must be asserted lives outside the component. Snapping and clamping is
 * exactly where an off-by-one hides, and both the drag and the +/- buttons go
 * through here, so the two can never disagree about what a valid value is.
 */

export interface SliderRange {
  min: number;
  max: number;
  step: number;
}

/** Snap a raw value onto the step grid and clamp it to [min, max]. */
export function steppedValue(raw: number, { min, max, step }: SliderRange): number {
  if (!Number.isFinite(raw)) return min;
  // A step of 0 (or negative) would divide by zero and yield NaN, which renders
  // as "NaN Standorte". Fall back to plain clamping.
  if (!(step > 0)) return Math.min(max, Math.max(min, raw));
  // The grid is anchored to MIN, not to zero: a min that is not a multiple of
  // step would otherwise snap to values the block never allows.
  const stepped = min + Math.round((raw - min) / step) * step;
  return Math.min(max, Math.max(min, stepped));
}

/**
 * The value under a horizontal drag, given the touch position as a fraction of
 * the track's width. Fractions outside [0,1] are clamped rather than rejected:
 * the track carries a `hitSlop`, so a legitimate touch just past either end
 * reports exactly that.
 */
export function valueFromFraction(fraction: number, range: SliderRange): number {
  const clamped = Math.min(1, Math.max(0, fraction));
  return steppedValue(range.min + clamped * (range.max - range.min), range);
}
