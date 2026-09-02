import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SCAN_OUTCOMES, SCAN_TYPES, type ScanTelemetryEvent } from '../../flow-runner/scan/scanTelemetry';

/**
 * D-14c (SEC-05, plan 15-08): the ID/IBAN mount registry + the pure
 * screenshot-telemetry event builder.
 *
 * `useSensitiveScreen` is a thin `useEffect` shell over the exported pure
 * `registerSensitiveScreen` function (this repo has no react-native-testing-
 * library — mirrors `useAppStateLock.test.ts`'s "test the pure core, not the
 * hook shell" precedent). `registerSensitiveScreen` is exercised directly.
 * The registry is module-level state (a stack) — `vi.resetModules()` + a
 * fresh dynamic import per test isolates each test's stack, mirroring
 * `useScreenCapture.test.ts`'s same convention for its own module-level
 * `initialized` flag.
 */

async function freshModule() {
  vi.resetModules();
  return import('./sensitiveScreen');
}

beforeEach(() => {
  vi.resetModules();
});

describe('currentSensitiveScreen', () => {
  it('is null before any registration', async () => {
    const { currentSensitiveScreen } = await freshModule();
    expect(currentSensitiveScreen()).toBeNull();
  });

  it("becomes 'id' after registerSensitiveScreen('id') mounts, and null again after unregister", async () => {
    const { currentSensitiveScreen, registerSensitiveScreen } = await freshModule();
    const unregister = registerSensitiveScreen('id');
    expect(currentSensitiveScreen()).toBe('id');

    unregister();
    expect(currentSensitiveScreen()).toBeNull();
  });
});

describe('nested/overlapping registrations (most-recently-mounted wins)', () => {
  it('unregistering the most recent registration restores the previous kind, not null', async () => {
    const { currentSensitiveScreen, registerSensitiveScreen } = await freshModule();
    const unregisterId = registerSensitiveScreen('id');
    expect(currentSensitiveScreen()).toBe('id');

    const unregisterIban = registerSensitiveScreen('iban');
    expect(currentSensitiveScreen()).toBe('iban');

    unregisterIban();
    expect(currentSensitiveScreen()).toBe('id');

    unregisterId();
    expect(currentSensitiveScreen()).toBeNull();
  });
});

describe('useSensitiveScreen (hook shape)', () => {
  it('is a function accepting a SensitiveScreenKind and returning void', async () => {
    const { useSensitiveScreen } = await freshModule();
    expect(typeof useSensitiveScreen).toBe('function');
  });
});

describe('buildScreenshotTelemetryEvent (D-14c)', () => {
  const baseArgs = {
    kind: 'id' as const,
    createdBy: 'user-1',
    teamId: 'team-1',
    appVersion: '1.4.0',
  };

  it("produces scanType 'screenshot' (a member of SCAN_TYPES) and outcome 'screenshot_taken' (a member of SCAN_OUTCOMES) — membership, not a bare literal comparison", async () => {
    const { buildScreenshotTelemetryEvent } = await freshModule();
    const event = buildScreenshotTelemetryEvent(baseArgs);

    expect(SCAN_TYPES).toContain(event.scanType);
    expect(event.scanType).toBe('screenshot');
    expect(SCAN_OUTCOMES).toContain(event.outcome);
    expect(event.outcome).toBe('screenshot_taken');
  });

  it('carries durationMs: null and deviceModel: null — no scan duration, no device fingerprint', async () => {
    const { buildScreenshotTelemetryEvent } = await freshModule();
    const event = buildScreenshotTelemetryEvent(baseArgs);

    expect(event.durationMs).toBeNull();
    expect(event.deviceModel).toBeNull();
  });

  it('contains no field derived from what was on screen: the key set equals ScanTelemetryEvent exactly, and values are only the four inputs plus the two constants', async () => {
    const { buildScreenshotTelemetryEvent } = await freshModule();
    const event = buildScreenshotTelemetryEvent(baseArgs);

    const expectedKeys: Array<keyof ScanTelemetryEvent> = [
      'scanType',
      'outcome',
      'durationMs',
      'deviceModel',
      'appVersion',
      'createdBy',
      'teamId',
    ];
    expect(Object.keys(event).sort()).toEqual([...expectedKeys].sort());

    expect(event).toEqual({
      scanType: 'screenshot',
      outcome: 'screenshot_taken',
      durationMs: null,
      deviceModel: null,
      appVersion: baseArgs.appVersion,
      createdBy: baseArgs.createdBy,
      teamId: baseArgs.teamId,
    });
  });

  it('builds an equivalent event for kind: iban', async () => {
    const { buildScreenshotTelemetryEvent } = await freshModule();
    const event = buildScreenshotTelemetryEvent({ ...baseArgs, kind: 'iban' });
    expect(event.scanType).toBe('screenshot');
    expect(event.outcome).toBe('screenshot_taken');
  });
});
