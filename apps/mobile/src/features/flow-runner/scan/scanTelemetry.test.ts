import { describe, expect, it, vi } from 'vitest';

import {
  buildScanTelemetryEvent,
  recordScanTelemetry,
  SCAN_OUTCOMES,
  SCAN_TYPES,
  type ScanTelemetryEvent,
} from './scanTelemetry';

/**
 * CHKT-04 (D-13/D-15): anonymous per-scan-session telemetry. Best-effort
 * recording never blocks the scan/close flow — a queue/db hiccup must be
 * swallowed, never rethrown to the caller.
 */
describe('SCAN_TYPES / SCAN_OUTCOMES (D-14c closed value sets, mirrors 0082)', () => {
  it('SCAN_TYPES is exactly [\'id\', \'iban\', \'screenshot\'] — the drift-tested literal shared with 0082', () => {
    expect(SCAN_TYPES).toEqual(['id', 'iban', 'screenshot']);
  });

  it('SCAN_OUTCOMES is exactly [\'scan_success\', \'manual_fallback\', \'aborted\', \'screenshot_taken\'] — the drift-tested literal shared with 0082', () => {
    expect(SCAN_OUTCOMES).toEqual(['scan_success', 'manual_fallback', 'aborted', 'screenshot_taken']);
  });
});

describe('buildScanTelemetryEvent', () => {
  it('computes a non-negative duration_ms from startedAt/endedAt', () => {
    const event = buildScanTelemetryEvent({
      scanType: 'id',
      outcome: 'scan_success',
      startedAt: 1_000,
      endedAt: 3_500,
      deviceModel: 'Pixel 9',
      appVersion: '1.4.0',
      createdBy: 'user-1',
      teamId: 'team-1',
    });

    expect(event.durationMs).toBe(2_500);
    expect(event.scanType).toBe('id');
    expect(event.outcome).toBe('scan_success');
  });

  it('clamps duration_ms to zero if endedAt somehow precedes startedAt (never negative)', () => {
    const event = buildScanTelemetryEvent({
      scanType: 'iban',
      outcome: 'aborted',
      startedAt: 5_000,
      endedAt: 4_000,
      deviceModel: 'Pixel 9',
      appVersion: '1.4.0',
      createdBy: 'user-1',
      teamId: 'team-1',
    });

    expect(event.durationMs).toBe(0);
  });

  it('only emits allowed scan_type values (id | iban)', () => {
    const idEvent = buildScanTelemetryEvent({
      scanType: 'id',
      outcome: 'scan_success',
      startedAt: 0,
      endedAt: 1,
      deviceModel: 'x',
      appVersion: '1',
      createdBy: 'u',
      teamId: 't',
    });
    const ibanEvent = buildScanTelemetryEvent({
      scanType: 'iban',
      outcome: 'scan_success',
      startedAt: 0,
      endedAt: 1,
      deviceModel: 'x',
      appVersion: '1',
      createdBy: 'u',
      teamId: 't',
    });

    expect(['id', 'iban']).toContain(idEvent.scanType);
    expect(['id', 'iban']).toContain(ibanEvent.scanType);
  });

  it('only emits allowed outcome values (scan_success | manual_fallback | aborted)', () => {
    for (const outcome of ['scan_success', 'manual_fallback', 'aborted'] as const) {
      const event = buildScanTelemetryEvent({
        scanType: 'id',
        outcome,
        startedAt: 0,
        endedAt: 1,
        deviceModel: 'x',
        appVersion: '1',
        createdBy: 'u',
        teamId: 't',
      });
      expect(['scan_success', 'manual_fallback', 'aborted']).toContain(event.outcome);
    }
  });
});

describe('recordScanTelemetry (best-effort, never blocks the scan/close flow)', () => {
  const fixedEvent: ScanTelemetryEvent = {
    scanType: 'id',
    outcome: 'scan_success',
    durationMs: 1_200,
    deviceModel: 'Pixel 9',
    appVersion: '1.4.0',
    createdBy: 'user-1',
    teamId: 'team-1',
  };

  it('calls repo.record with the event', async () => {
    const record = vi.fn(async () => {});
    await recordScanTelemetry({ record }, fixedEvent);

    expect(record).toHaveBeenCalledExactlyOnceWith(fixedEvent);
  });

  it('swallows a repo.record rejection — never rethrows to the caller', async () => {
    const record = vi.fn(async () => {
      throw new Error('db hiccup');
    });

    await expect(recordScanTelemetry({ record }, fixedEvent)).resolves.toBeUndefined();
  });
});
