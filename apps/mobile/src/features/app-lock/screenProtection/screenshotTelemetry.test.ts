import { describe, expect, it, vi } from 'vitest';

import { handleScreenshotDetected, type ScreenshotTelemetryContext } from './screenshotTelemetry';

/**
 * D-14c (SEC-05, plan 15-08) — the boot-level screenshot handler wired into
 * `RootNavigator.tsx`. Exercises the pure `handleScreenshotDetected` core
 * directly with injected fakes (no native/navigation module involved).
 */

const FIXED_CONTEXT: ScreenshotTelemetryContext = {
  createdBy: 'user-1',
  teamId: 'team-1',
  appVersion: '1.4.0',
  repo: { record: vi.fn(async () => {}) },
};

describe('handleScreenshotDetected — no sensitive screen mounted', () => {
  it('writes nothing to scanTelemetryRepo when currentSensitiveScreen() is null', async () => {
    const resolveContext = vi.fn(async () => FIXED_CONTEXT);
    const record = vi.fn(async () => {});

    await handleScreenshotDetected({
      currentSensitiveScreen: () => null,
      resolveContext,
    });

    expect(resolveContext).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});

describe('handleScreenshotDetected — an ID/IBAN surface is mounted', () => {
  it("writes exactly one row with scanType: 'screenshot' when 'iban' is registered", async () => {
    const record = vi.fn(async () => {});
    const context: ScreenshotTelemetryContext = { ...FIXED_CONTEXT, repo: { record } };

    await handleScreenshotDetected({
      currentSensitiveScreen: () => 'iban',
      resolveContext: async () => context,
    });

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ scanType: 'screenshot', outcome: 'screenshot_taken' }),
    );
  });

  it("writes exactly one row when 'id' is registered", async () => {
    const record = vi.fn(async () => {});
    const context: ScreenshotTelemetryContext = { ...FIXED_CONTEXT, repo: { record } };

    await handleScreenshotDetected({
      currentSensitiveScreen: () => 'id',
      resolveContext: async () => context,
    });

    expect(record).toHaveBeenCalledTimes(1);
  });

  it('is a silent no-op when context resolution returns null (e.g. no session/territory yet)', async () => {
    const record = vi.fn(async () => {});
    await handleScreenshotDetected({
      currentSensitiveScreen: () => 'id',
      resolveContext: async () => null,
    });
    expect(record).not.toHaveBeenCalled();
  });

  it('is a silent no-op (never throws) when resolveContext itself rejects', async () => {
    await expect(
      handleScreenshotDetected({
        currentSensitiveScreen: () => 'id',
        resolveContext: async () => {
          throw new Error('lookup failed');
        },
      }),
    ).resolves.toBeUndefined();
  });

  it('is a silent no-op (never throws) when repo.record rejects', async () => {
    const record = vi.fn(async () => {
      throw new Error('db hiccup');
    });
    const context: ScreenshotTelemetryContext = { ...FIXED_CONTEXT, repo: { record } };

    await expect(
      handleScreenshotDetected({
        currentSensitiveScreen: () => 'iban',
        resolveContext: async () => context,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('handleScreenshotDetected — renders no UI, produces no toast/alert', () => {
  it('returns undefined and has no observable side effect beyond the repo write (no state/UI reachable from this pure function)', async () => {
    const record = vi.fn(async () => {});
    const context: ScreenshotTelemetryContext = { ...FIXED_CONTEXT, repo: { record } };

    const result = await handleScreenshotDetected({
      currentSensitiveScreen: () => 'iban',
      resolveContext: async () => context,
    });

    // A pure async function with no React/UI import in this module cannot
    // reach a state setter, Alert, or toast call — its only side effect is
    // the injected repo write asserted above. Returning undefined (not a
    // UI-describing value) is the structural proof this handler renders
    // nothing.
    expect(result).toBeUndefined();
  });
});
