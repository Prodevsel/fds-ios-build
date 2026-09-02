import ExpoModulesCore

/**
 * D-14b (SEC-05, 15-CONTEXT.md; plan 15-09): the one API this phase does not
 * get for free. `expo-screen-capture@56.0.5` ships NO screen-*recording*-
 * detection export at all (15-RESEARCH.md Pitfall 5, confirmed by reading the
 * shipped `.d.ts` directly) — training-data recall of
 * `addScreenRecordingListener` is wrong for this pin. The only mechanism iOS
 * actually offers is `UIScreen.isCaptured` + its change notification, which
 * is exactly what this module wraps. No private API is used.
 *
 * Root cause (CLAUDE.md "Root Cause, Not Symptom"): the verified absence of a
 * recording-detection export at the pinned `expo-screen-capture@56.0.5`.
 *
 * NOT a re-implementation of `expo-screen-capture`'s own `preventScreenCapture`
 * (D-13/D-14a, plan 15-08) — that module already covers screenshot prevention
 * and the app-switcher blur natively. This module answers a different
 * question: "is the screen being captured RIGHT NOW", so the JS side can
 * blank exactly two fields (ID preview, IBAN value) while true.
 */
public final class ScreenRecordingDetectorModule: Module {
  private let changeEventName = "onCaptureChange"

  public func definition() -> ModuleDefinition {
    Name("ScreenRecordingDetector")

    Events(changeEventName)

    Function("isSupported") { () -> Bool in
      true
    }

    Function("isCaptured") { () -> Bool in
      UIScreen.main.isCaptured
    }

    OnStartObserving {
      NotificationCenter.default.addObserver(
        self,
        selector: #selector(self.captureDidChange),
        name: UIScreen.capturedDidChangeNotification,
        object: nil
      )
    }

    OnStopObserving {
      NotificationCenter.default.removeObserver(
        self,
        name: UIScreen.capturedDidChangeNotification,
        object: nil
      )
    }

    OnDestroy {
      NotificationCenter.default.removeObserver(
        self,
        name: UIScreen.capturedDidChangeNotification,
        object: nil
      )
    }
  }

  @objc
  private func captureDidChange() {
    sendEvent(changeEventName, ["captured": UIScreen.main.isCaptured])
  }
}
