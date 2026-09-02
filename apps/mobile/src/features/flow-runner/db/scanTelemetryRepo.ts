import type { AbstractPowerSyncDatabase } from '@powersync/common';
import * as Crypto from 'expo-crypto';

import type { ScanTelemetryEvent } from '../scan/scanTelemetry';

/**
 * Local-SQLite mirror of `scan_telemetry` (0031_scan_telemetry.sql / schema.ts).
 * INSERT-ONLY (D-14/CHKT-04) — a single plain `INSERT`, never an
 * update/delete method (mirrors the insert-only posture of blacklistEntries'
 * connector template, applyBlacklistOperation). All writes here are
 * local-only (Iron Rule 1); connector.ts's applyScanTelemetryOperation drains
 * the upload queue whenever the PowerSync connection is up.
 */
export interface CreateScanTelemetryRepoOptions {
  db: AbstractPowerSyncDatabase;
}

export interface ScanTelemetryRepo {
  record(event: ScanTelemetryEvent): Promise<void>;
}

/** Injectable repo (options-object DI, matches createFlowDraftsRepo). */
export function createScanTelemetryRepo(options: CreateScanTelemetryRepoOptions): ScanTelemetryRepo {
  const { db } = options;

  return {
    async record(event) {
      const id = Crypto.randomUUID();
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO scan_telemetry (
          id, created_by, team_id, scan_type, outcome, duration_ms,
          device_model, app_version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          event.createdBy,
          event.teamId,
          event.scanType,
          event.outcome,
          event.durationMs,
          event.deviceModel,
          event.appVersion,
          now,
        ],
      );
    },
  };
}
