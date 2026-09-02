package expo.modules.screenrecordingdetector

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * D-14b (SEC-05, 15-CONTEXT.md; plan 15-09) — Android half.
 *
 * `isSupported()` returns FALSE here deliberately, not as an unexplained
 * stub: D-13 (plan 15-08) already sets `FLAG_SECURE` app-wide via
 * `expo-screen-capture`'s `preventScreenCaptureAsync()`. `FLAG_SECURE` makes
 * the Android window itself un-capturable by ANY recording/screenshot
 * mechanism at the OS level — there is nothing left for a recording to
 * capture, so a recording-*detection* signal on top of that would be
 * redundant, not missing. iOS has no equivalent capture-blocking primitive
 * (see the Swift module's header), which is exactly why D-14b's detection
 * path exists there and not here.
 */
class ScreenRecordingDetectorModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ScreenRecordingDetector")

    Events("onCaptureChange")

    Function("isSupported") {
      false
    }

    Function("isCaptured") {
      false
    }
  }
}
