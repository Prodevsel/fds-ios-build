import type { ScanTelemetryRepoLike } from '../../flow-runner/scan/scanTelemetry';
import { recordScanTelemetry } from '../../flow-runner/scan/scanTelemetry';
import { buildScreenshotTelemetryEvent, currentSensitiveScreen } from './sensitiveScreen';

/**
 * D-14c (SEC-05, plan 15-08): the boot-level screenshot handler wired into
 * `RootNavigator.tsx` via `useScreenCapture`'s `onScreenshot` callback.
 *
 * SILENT — no toast, no banner, no badge, no haptic, no console logging call
 * of any kind anywhere in this module (grepped by `15-08-PLAN.md`'s own
 * verify step). A
 * screenshot on a screen where `currentSensitiveScreen()` is `null` (the map,
 * settings, anywhere that is not an ID/IBAN surface) is NOT a D-14c event and
 * produces zero side effects — this handler does nothing at all in that
 * case, not even a resolved-but-discarded lookup.
 *
 * Kept OUT of `RootNavigator.tsx` itself (which only wires this function to
 * `useScreenCapture`) so it is unit-testable without mocking the entire
 * navigation/SafeAreaProvider/expo-status-bar module graph — the same
 * "pure core, thin wiring shell" split `useAppStateLock.ts`/`biometrics.ts`
 * already use.
 */

export interface ScreenshotTelemetryContext {
  createdBy: string;
  teamId: string;
  appVersion: string;
  repo: ScanTelemetryRepoLike;
}

export interface ScreenshotHandlerDeps {
  currentSensitiveScreen: () => 'id' | 'iban' | null;
  resolveContext: () => Promise<ScreenshotTelemetryContext | null>;
}

/**
 * Reads whether an ID/IBAN surface is currently mounted; if so, resolves the
 * telemetry context and writes exactly one row via `recordScanTelemetry`
 * (already best-effort — never throws). Every step is guarded so a
 * resolution failure degrades to a silent no-op, matching D-14's "telemetry
 * must never block or surface to the flow" rule everywhere else in this
 * codebase (`recordIdScanOutcome`/`recordIbanScanTelemetry`).
 */
export async function handleScreenshotDetected(deps: ScreenshotHandlerDeps): Promise<void> {
  const kind = deps.currentSensitiveScreen();
  if (!kind) {
    return;
  }
  let context: ScreenshotTelemetryContext | null;
  try {
    context = await deps.resolveContext();
  } catch {
    return;
  }
  if (!context) {
    return;
  }
  const event = buildScreenshotTelemetryEvent({
    kind,
    createdBy: context.createdBy,
    teamId: context.teamId,
    appVersion: context.appVersion,
  });
  await recordScanTelemetry(context.repo, event);
}

/**
 * Production wiring for `resolveContext`: the real session/territory lookup,
 * same shape as `IbanScanBlock.tsx`'s `resolveTelemetryContext` (resolved via
 * dynamic import so this native/network-module-touching path is never hit at
 * test time). Every failure degrades to `null` — never throws, never blocks
 * app boot.
 */
export async function defaultResolveScreenshotContext(): Promise<ScreenshotTelemetryContext | null> {
  try {
    const [{ openDatabase }, { getSupabase }, { createScanTelemetryRepo }, Application] =
      await Promise.all([
        import('../../../lib/db/powersync'),
        import('../../../lib/auth/supabase'),
        import('../../flow-runner/db/scanTelemetryRepo'),
        import('expo-application'),
      ]);

    const db = await openDatabase();
    const { data } = await getSupabase().auth.getSession();
    const createdBy = data.session?.user.id;
    if (!createdBy) {
      return null;
    }

    const territoryRow = await db
      .getOptional<{ team_id: string }>(
        'SELECT team_id FROM territories WHERE locked_by = ? LIMIT 1',
        [createdBy],
      )
      .catch(() => null);
    const teamId = territoryRow?.team_id;
    if (!teamId) {
      return null;
    }

    return {
      createdBy,
      teamId,
      appVersion: Application.nativeApplicationVersion ?? 'unknown',
      repo: createScanTelemetryRepo({ db }),
    };
  } catch {
    return null;
  }
}

/** Default production deps — the ONLY place this module wires real lookups. */
export const defaultScreenshotHandlerDeps: ScreenshotHandlerDeps = {
  currentSensitiveScreen,
  resolveContext: defaultResolveScreenshotContext,
};
