import { describe, expect, it } from 'vitest';
import { steppedValue, valueFromFraction } from './sliderValue';

/**
 * The slider's arithmetic. The component itself is untestable here (no
 * `react-test-renderer`), but the part that can be wrong in a way nobody
 * notices — snapping and clamping — is pure and lives outside it.
 */
const STANDORTE = { min: 1, max: 10, step: 1 };
const KWH = { min: 500, max: 10000, step: 250 };

describe('steppedValue', () => {
  it('snaps onto the grid rather than to the nearest integer', () => {
    expect(steppedValue(1600, KWH)).toBe(1500);
    expect(steppedValue(1650, KWH)).toBe(1750);
  });

  it('clamps to the ends, so +/- at the edge cannot walk out of range', () => {
    expect(steppedValue(0, STANDORTE)).toBe(1);
    expect(steppedValue(99, STANDORTE)).toBe(10);
  });

  it('keeps the grid anchored to min, not to zero', () => {
    // min 40, step 300 -> the allowed values are 40, 340, 640, 940. A grid
    // anchored to ZERO would answer 600 here, which this block never allows.
    expect(steppedValue(500, { min: 40, max: 1000, step: 300 })).toBe(640);
    expect(steppedValue(180, { min: 40, max: 1000, step: 300 })).toBe(40);
  });

  it('never returns NaN for a malformed block or reading', () => {
    expect(steppedValue(Number.NaN, STANDORTE)).toBe(1);
    expect(steppedValue(5, { min: 1, max: 10, step: 0 })).toBe(5);
  });
});

describe('valueFromFraction', () => {
  it('maps the track ends to min and max', () => {
    expect(valueFromFraction(0, STANDORTE)).toBe(1);
    expect(valueFromFraction(1, STANDORTE)).toBe(10);
  });

  it('clamps a touch inside hitSlop, which reports x outside the track', () => {
    expect(valueFromFraction(-0.4, STANDORTE)).toBe(1);
    expect(valueFromFraction(1.7, STANDORTE)).toBe(10);
  });

  it('lands on the value under the finger, not near it', () => {
    expect(valueFromFraction(0.5, STANDORTE)).toBe(6);
    expect(valueFromFraction(0.5, KWH)).toBe(5250);
  });
});
