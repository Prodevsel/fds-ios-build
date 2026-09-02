import { useMemo, useRef } from 'react';
import { Animated, Easing, PanResponder, type PanResponderInstance } from 'react-native';
import { shouldDismissSheet } from './swipeDismiss';

/**
 * Swipe-down-to-dismiss for a controlled bottom sheet, built on RN built-ins
 * only (`Animated` + `PanResponder`) — no gesture-handler / reanimated native
 * dependency. `translateY` follows the finger while dragging DOWN; on release
 * the pure `shouldDismissSheet` decision either animates the sheet off-screen
 * and calls `onClose`, or springs it back to rest. Upward drags are ignored so
 * the sheet never lifts above its resting position.
 *
 * Attach `panHandlers` to the grabber/handle area (NOT a scrollable body, or it
 * would hijack the scroll gesture) and apply `{ transform: [{ translateY }] }`
 * to the sheet surface.
 */

/** Min downward move (dp) before the responder claims the gesture as a drag. */
const CLAIM_DY = 4;
/** How far (dp) the sheet slides down during the dismiss animation before onClose. */
const OUT_DISTANCE = 600;

export interface UseSwipeToDismissOptions {
  /** Called once the dismiss animation completes (the controlled close). */
  onClose: () => void;
  /** OS "Reduce Motion" — when true the dismiss slide is instant (duration 0). */
  reducedMotion?: boolean;
}

export interface SwipeToDismiss {
  /** Drive the sheet surface: `{ transform: [{ translateY }] }`. */
  translateY: Animated.Value;
  /** Spread onto the handle/drag-area View. */
  panHandlers: PanResponderInstance['panHandlers'];
}

export function useSwipeToDismiss({
  onClose,
  reducedMotion = false,
}: UseSwipeToDismissOptions): SwipeToDismiss {
  const translateY = useRef(new Animated.Value(0)).current;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Claim only a deliberate DOWNWARD, mostly-vertical drag — taps and
        // horizontal/upward moves fall through to children.
        onMoveShouldSetPanResponder: (_evt, gesture) =>
          gesture.dy > CLAIM_DY && gesture.dy > Math.abs(gesture.dx),
        onPanResponderMove: (_evt, gesture) => {
          // Follow the finger down only; clamp upward drag to the rest position.
          translateY.setValue(gesture.dy > 0 ? gesture.dy : 0);
        },
        onPanResponderRelease: (_evt, gesture) => {
          if (shouldDismissSheet({ translationY: gesture.dy, velocityY: gesture.vy })) {
            Animated.timing(translateY, {
              toValue: OUT_DISTANCE,
              duration: reducedMotion ? 0 : 180,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }).start(() => {
              // Reset for the next open (the sheet is controlled — it unmounts
              // on close, but resetting keeps a reused Animated.Value clean).
              translateY.setValue(0);
              onClose();
            });
            return;
          }
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 2,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 2 }).start();
        },
      }),
    [translateY, onClose, reducedMotion],
  );

  return { translateY, panHandlers: panResponder.panHandlers };
}
