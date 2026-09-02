/**
 * Pure decision logic for swipe-down-to-dismiss on bottom sheets (StatusSheet,
 * InfoSheet). Kept in its own module with NO react-native import so it is
 * unit-testable in the vitest/node environment without mocking native modules
 * (mirrors the repo's "test the exported logic, never mount" pattern).
 *
 * A release dismisses the sheet when the finger has travelled far enough DOWN,
 * OR when it is still moving down fast enough (a quick flick that never covered
 * the full distance). Everything else springs the sheet back to rest.
 */

/** Default drag distance (dp) past which a release dismisses the sheet. */
export const DISMISS_DISTANCE = 80;
/** Default downward velocity (dp/ms) past which a release dismisses even on a short drag. */
export const DISMISS_VELOCITY = 0.5;

export interface DismissDecisionInput {
  /** Downward drag translation at release (dp). Positive = dragged down. */
  translationY: number;
  /** Vertical velocity at release (dp/ms). Positive = moving down. */
  velocityY: number;
  /** Distance threshold (dp); defaults to DISMISS_DISTANCE. */
  distanceThreshold?: number;
  /** Velocity threshold (dp/ms); defaults to DISMISS_VELOCITY. */
  velocityThreshold?: number;
}

/**
 * Decide whether a released swipe-down gesture should dismiss the sheet.
 * Dismisses when dragged past the distance threshold OR flicked down past the
 * velocity threshold. Upward gestures (negative translation/velocity) never
 * dismiss — the caller only feeds downward drags, but this stays correct
 * regardless.
 */
export function shouldDismissSheet(input: DismissDecisionInput): boolean {
  const distanceThreshold = input.distanceThreshold ?? DISMISS_DISTANCE;
  const velocityThreshold = input.velocityThreshold ?? DISMISS_VELOCITY;
  return input.translationY >= distanceThreshold || input.velocityY >= velocityThreshold;
}
