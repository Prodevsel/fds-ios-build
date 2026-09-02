/**
 * CHKT-04 telemetry event builder + best-effort recorder (D-13/D-14/D-15).
 *
 * Anonymous, per-scan-session events only: scan type, outcome, duration,
 * device model, app version — rep/team scoping via RLS, NO customer data, NO
 * contract/draft FK, NO GPS (T-04-06). Recording must NEVER block the scan
 * UX or a close: a queue/db hiccup is swallowed here, never rethrown.
 *
 * D-14c (Phase 15, SEC-05): `SCAN_TYPES`/`SCAN_OUTCOMES` are the literal
 * client-side mirror of `scan_telemetry`'s widened CHECK constraints
 * (supabase/migrations/0082_scan_telemetry_screenshot_event.sql). Widening
 * either side without the other silently breaks inserts — a screenshot
 * event on an ID/IBAN screen, logged silently, never surfaced to the rep.
 * `scanTelemetry.test.ts` pins both arrays value-for-value against 0082, per
 * this repo's autoLockOptions.ts drift-test convention.
 */

export const SCAN_TYPES = ['id', 'iban', 'screenshot'] as const;
export const SCAN_OUTCOMES = ['scan_success', 'manual_fallback', 'aborted', 'screenshot_taken'] as const;

export type ScanType = (typeof SCAN_TYPES)[number];
export type ScanOutcome = (typeof SCAN_OUTCOMES)[number];

export interface BuildScanTelemetryEventInput {
  scanType: ScanType;
  outcome: ScanOutcome;
  /** Epoch ms when the scan session started. */
  startedAt: number;
  /** Epoch ms when the scan session ended (confirm/fallback/abort). */
  endedAt: number;
  deviceModel: string;
  appVersion: string;
  createdBy: string;
  teamId: string;
}

/**
 * Pure, DB-agnostic row shape consumed by scanTelemetryRepo.record().
 *
 * `durationMs`/`deviceModel` are nullable (mirrors `scan_telemetry.duration_ms`
 * /`device_model`'s pre-existing nullable columns, unchanged by 0082 per its
 * own header — "stay optional exactly as they already are"): a D-14c
 * screenshot event (built by `screenProtection/sensitiveScreen.ts`'s
 * `buildScreenshotTelemetryEvent`) has no scan duration and must not smuggle
 * a device-fingerprinting signal into a row that exists only to record that
 * a screenshot happened. Every `id`/`iban` scan path keeps supplying real
 * `number`/`string` values via `buildScanTelemetryEvent` below, unaffected.
 */
export interface ScanTelemetryEvent {
  scanType: ScanType;
  outcome: ScanOutcome;
  durationMs: number | null;
  deviceModel: string | null;
  appVersion: string;
  createdBy: string;
  teamId: string;
}

/**
 * Pure builder — duration_ms is clamped to >= 0 (defensive against clock
 * skew/reordering; never emits a negative duration).
 */
export function buildScanTelemetryEvent(input: BuildScanTelemetryEventInput): ScanTelemetryEvent {
  const durationMs = Math.max(0, input.endedAt - input.startedAt);
  return {
    scanType: input.scanType,
    outcome: input.outcome,
    durationMs,
    deviceModel: input.deviceModel,
    appVersion: input.appVersion,
    createdBy: input.createdBy,
    teamId: input.teamId,
  };
}

/** Structural repo surface this recorder depends on (injectable for tests). */
export interface ScanTelemetryRepoLike {
  record(event: ScanTelemetryEvent): Promise<void>;
}

/**
 * Best-effort telemetry recording: NEVER blocks or rethrows to the caller.
 * A queue/db hiccup on this insert-only, anonymous side-channel must not
 * interrupt the scan flow or a checkout close.
 */
export async function recordScanTelemetry(
  repo: ScanTelemetryRepoLike,
  event: ScanTelemetryEvent,
): Promise<void> {
  try {
    await repo.record(event);
  } catch (error) {
    // eslint-disable-next-line no-console -- best-effort telemetry: log, never throw.
    console.warn('scan telemetry record failed (best-effort, ignored):', error);
  }
}
