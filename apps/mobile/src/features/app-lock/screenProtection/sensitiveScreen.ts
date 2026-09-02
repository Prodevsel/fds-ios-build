import { useEffect } from 'react';

import { SCAN_OUTCOMES, SCAN_TYPES, type ScanTelemetryEvent } from '../../flow-runner/scan/scanTelemetry';

/**
 * D-14c (SEC-05, 15-CONTEXT.md, plan 15-08): the ID/IBAN mount registry the
 * boot-level screenshot listener (`useScreenCapture.ts`, wired in
 * `RootNavigator.tsx`) reads to decide whether a screenshot is a D-14c event
 * at all — a screenshot taken on the map or the settings screen is NOT one.
 *
 * SILENT LOGGING RULE (binding, 15-UI-SPEC.md §4 / D-14c): the event this
 * module builds is recorded to `scan_telemetry` with NO toast, NO banner, NO
 * badge, NO haptic. Confirming the event to the rep would either (a) imply
 * the screenshot was somehow undone, which is false — iOS cannot block
 * screenshots (see `useScreenCapture.ts`'s header) — or (b) alarm the rep
 * over something they cannot act on mid-flow. The record exists purely as
 * DPIA input (D-14), never as rep-facing feedback. A caller of
 * `buildScreenshotTelemetryEvent` must feed the result straight into
 * `scanTelemetryRepo`'s best-effort `recordScanTelemetry` path with no
 * intervening UI state change.
 *
 * The registry is a small module-level stack (most recent wins, unregister
 * pops its own entry) so a scan preview nested inside another sensitive
 * surface resolves correctly — kept as pure exported functions with a thin
 * `useEffect` shell, following this repo's pure-core convention
 * (`useAppStateLock.ts`, `biometrics.ts`).
 */

export type SensitiveScreenKind = 'id' | 'iban';

// Module-level stack: last pushed = current. Each `unregister` closure below
// splices out ITS OWN entry by array-index reference (captured at push time),
// not merely "pop the top" — correct even if callers somehow unregister out
// of strict LIFO order (defensive; normal React unmount order is LIFO).
const stack: SensitiveScreenKind[] = [];

/**
 * Pushes `kind` onto the registry and returns an unregister function that
 * removes exactly this entry. Pure — no React dependency, directly
 * unit-testable.
 */
export function registerSensitiveScreen(kind: SensitiveScreenKind): () => void {
  const entry: SensitiveScreenKind = kind;
  stack.push(entry);
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    const index = stack.lastIndexOf(entry);
    if (index !== -1) {
      stack.splice(index, 1);
    }
  };
}

/** The most-recently-mounted sensitive screen kind, or `null` if none is mounted. */
export function currentSensitiveScreen(): SensitiveScreenKind | null {
  return stack.length > 0 ? (stack[stack.length - 1] ?? null) : null;
}

/**
 * Registers `kind` on mount, unregisters on unmount — the thin `useEffect`
 * shell over `registerSensitiveScreen`. Mounted inside `IdScanBlockContent`/
 * `IbanScanBlockContent` (the `*Content` split from plan 12-12), never in
 * the outer `ForceLightTheme`-wrapping component.
 */
export function useSensitiveScreen(kind: SensitiveScreenKind): void {
  useEffect(() => {
    return registerSensitiveScreen(kind);
  }, [kind]);
}

export interface BuildScreenshotTelemetryEventArgs {
  kind: SensitiveScreenKind;
  createdBy: string;
  teamId: string;
  appVersion: string;
}

/**
 * Pure builder for the D-14c screenshot telemetry row. Derives `scanType`/
 * `outcome` from the `SCAN_TYPES`/`SCAN_OUTCOMES` constants (single-sourced
 * with 0082's widened CHECK constraints via `scanTelemetry.ts`) rather than
 * re-typing the string literals. `durationMs`/`deviceModel` are always
 * `null` — a screenshot has no scan duration, and this row must not smuggle
 * device fingerprinting in. The result contains NOTHING derived from what
 * was actually on screen: no image data, no field values, no customer
 * identifier — only the four caller-supplied inputs plus the two constants.
 */
export function buildScreenshotTelemetryEvent(
  args: BuildScreenshotTelemetryEventArgs,
): ScanTelemetryEvent {
  // Derived FROM the shared constants (not re-typed as a bare literal): if a
  // future widening of scanTelemetry.ts ever drops the 'screenshot'/
  // 'screenshot_taken' values, this throws loudly instead of silently
  // writing a value the DB's 0082 CHECK constraints would reject anyway.
  const scanType = SCAN_TYPES.find((value) => value === 'screenshot');
  const outcome = SCAN_OUTCOMES.find((value) => value === 'screenshot_taken');
  if (!scanType || !outcome) {
    throw new Error(
      "buildScreenshotTelemetryEvent: 'screenshot'/'screenshot_taken' missing from SCAN_TYPES/SCAN_OUTCOMES",
    );
  }
  return {
    scanType,
    outcome,
    durationMs: null,
    deviceModel: null,
    appVersion: args.appVersion,
    createdBy: args.createdBy,
    teamId: args.teamId,
  };
}
