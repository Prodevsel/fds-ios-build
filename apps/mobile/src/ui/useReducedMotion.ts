import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Tracks the OS "Reduce Motion" accessibility preference (iOS Settings ->
 * Accessibility -> Motion; Android "Remove animations"). Motion-driven UI
 * (the collapsible summary card, swipe-to-dismiss sheets) reads this to fall
 * back to an INSTANT transition (duration 0) instead of an animated one, per
 * the Foundations motion contract ("intentional + ease-out, reduced-motion
 * fallback").
 *
 * Reads the initial value once on mount and subscribes to live changes so a
 * mid-session toggle is honoured without a reload. Never throws — if the
 * native query rejects (unsupported platform), it resolves to `false` (full
 * motion), the safe default that keeps animations working.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (!cancelled) setReduced(enabled);
      })
      .catch(() => {
        if (!cancelled) setReduced(false);
      });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled: boolean) => setReduced(enabled),
    );
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduced;
}
