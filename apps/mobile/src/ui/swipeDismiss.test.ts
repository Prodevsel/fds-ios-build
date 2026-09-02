import { describe, expect, it } from 'vitest';
import {
  DISMISS_DISTANCE,
  DISMISS_VELOCITY,
  shouldDismissSheet,
} from './swipeDismiss';

describe('shouldDismissSheet (swipe-down-to-dismiss decision)', () => {
  it('dismisses when dragged past the distance threshold (slow drag)', () => {
    expect(
      shouldDismissSheet({ translationY: DISMISS_DISTANCE + 1, velocityY: 0 }),
    ).toBe(true);
  });

  it('dismisses exactly AT the distance threshold (inclusive)', () => {
    expect(shouldDismissSheet({ translationY: DISMISS_DISTANCE, velocityY: 0 })).toBe(true);
  });

  it('dismisses on a fast downward flick even when the drag was short', () => {
    expect(
      shouldDismissSheet({ translationY: 10, velocityY: DISMISS_VELOCITY + 0.1 }),
    ).toBe(true);
  });

  it('springs back for a short, slow drag (neither threshold met)', () => {
    expect(shouldDismissSheet({ translationY: 20, velocityY: 0.1 })).toBe(false);
  });

  it('never dismisses on an upward gesture (negative translation and velocity)', () => {
    expect(shouldDismissSheet({ translationY: -200, velocityY: -2 })).toBe(false);
  });

  it('respects caller-provided custom thresholds', () => {
    expect(
      shouldDismissSheet({
        translationY: 50,
        velocityY: 0,
        distanceThreshold: 40,
        velocityThreshold: 5,
      }),
    ).toBe(true);
    expect(
      shouldDismissSheet({
        translationY: 50,
        velocityY: 0,
        distanceThreshold: 120,
        velocityThreshold: 5,
      }),
    ).toBe(false);
  });
});
