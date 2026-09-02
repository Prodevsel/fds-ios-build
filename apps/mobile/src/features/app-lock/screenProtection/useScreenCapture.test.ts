import { beforeEach, describe, expect, it, vi } from 'vitest';

// `useScreenCapture.ts` imports `Platform` from `react-native` (Flow-syntax
// source, unparseable under vitest/node) and `expo-screen-capture` (a native
// module) at module scope, ONLY inside `defaultScreenCaptureDeps` — mock both
// at the module boundary so this file can import the module's structural,
// DI'd exports without loading either native bootstrapper. Mirrors
// `useAppStateLock.test.ts`'s `react-native` mock precedent.
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));
vi.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: vi.fn(async () => {}),
  enableAppSwitcherProtectionAsync: vi.fn(async () => {}),
  addScreenshotListener: vi.fn(() => ({ remove: vi.fn() })),
}));

import type { ScreenCaptureDeps } from './useScreenCapture';

/**
 * D-13/D-14a (SEC-05, plan 15-08): one-shot, app-wide capture protection.
 * `ScreenCaptureDeps` is structural — no native module involved here, every
 * test injects plain fakes (mirrors `biometrics.test.ts`'s DI convention).
 *
 * `initScreenProtection` is idempotent via a MODULE-LEVEL flag (D-13: a
 * re-render/remount must never re-toggle the flag). `vi.resetModules()` +
 * a fresh dynamic import per test is the only way to observe "first call"
 * behavior repeatedly without adding a test-only reset export to the
 * published interface (which is frozen by `15-08-PLAN.md`'s `<interfaces>`
 * block).
 */
function makeDeps(overrides: Partial<ScreenCaptureDeps> = {}): ScreenCaptureDeps {
  return {
    platform: 'android',
    preventScreenCaptureAsync: vi.fn(async () => {}),
    enableAppSwitcherProtectionAsync: vi.fn(async () => {}),
    addScreenshotListener: vi.fn(() => ({ remove: vi.fn() })),
    ...overrides,
  };
}

async function freshModule() {
  vi.resetModules();
  return import('./useScreenCapture');
}

beforeEach(() => {
  vi.resetModules();
});

describe('APP_SWITCHER_BLUR_INTENSITY', () => {
  it('is pinned at 0.9', async () => {
    const { APP_SWITCHER_BLUR_INTENSITY } = await freshModule();
    expect(APP_SWITCHER_BLUR_INTENSITY).toBe(0.9);
  });
});

describe('initScreenProtection — android', () => {
  it('calls preventScreenCaptureAsync exactly once and never enableAppSwitcherProtectionAsync', async () => {
    const { initScreenProtection } = await freshModule();
    const deps = makeDeps({ platform: 'android' });

    await initScreenProtection(deps);

    expect(deps.preventScreenCaptureAsync).toHaveBeenCalledTimes(1);
    expect(deps.enableAppSwitcherProtectionAsync).not.toHaveBeenCalled();
  });
});

describe('initScreenProtection — ios', () => {
  it('calls BOTH preventScreenCaptureAsync and enableAppSwitcherProtectionAsync(0.9) exactly once each', async () => {
    const { initScreenProtection, APP_SWITCHER_BLUR_INTENSITY } = await freshModule();
    const deps = makeDeps({ platform: 'ios' });

    await initScreenProtection(deps);

    expect(deps.preventScreenCaptureAsync).toHaveBeenCalledTimes(1);
    expect(deps.enableAppSwitcherProtectionAsync).toHaveBeenCalledTimes(1);
    expect(deps.enableAppSwitcherProtectionAsync).toHaveBeenCalledWith(APP_SWITCHER_BLUR_INTENSITY);
  });

  it('a rejection from enableAppSwitcherProtectionAsync does not prevent preventScreenCaptureAsync from having been called, and does not throw', async () => {
    const { initScreenProtection } = await freshModule();
    const deps = makeDeps({
      platform: 'ios',
      enableAppSwitcherProtectionAsync: vi.fn(async () => {
        throw new Error('native rejection');
      }),
    });

    await expect(initScreenProtection(deps)).resolves.toBeUndefined();
    expect(deps.preventScreenCaptureAsync).toHaveBeenCalledTimes(1);
  });
});

describe('initScreenProtection — idempotency (D-13: no re-toggle on re-render/remount)', () => {
  it('calling initScreenProtection twice results in exactly one call to each underlying API', async () => {
    const { initScreenProtection } = await freshModule();
    const deps = makeDeps({ platform: 'ios' });

    await initScreenProtection(deps);
    await initScreenProtection(deps);

    expect(deps.preventScreenCaptureAsync).toHaveBeenCalledTimes(1);
    expect(deps.enableAppSwitcherProtectionAsync).toHaveBeenCalledTimes(1);
  });

  it('is idempotent across separate deps instances too (module-level flag, not deps-instance-scoped)', async () => {
    const { initScreenProtection } = await freshModule();
    const depsA = makeDeps({ platform: 'android' });
    const depsB = makeDeps({ platform: 'android' });

    await initScreenProtection(depsA);
    await initScreenProtection(depsB);

    expect(depsA.preventScreenCaptureAsync).toHaveBeenCalledTimes(1);
    expect(depsB.preventScreenCaptureAsync).not.toHaveBeenCalled();
  });
});

describe('attachScreenshotListener', () => {
  it('returns a function that calls the subscription remove()', async () => {
    const { attachScreenshotListener } = await freshModule();
    const remove = vi.fn();
    const deps = { addScreenshotListener: vi.fn(() => ({ remove })) };
    const onScreenshot = vi.fn();

    const detach = attachScreenshotListener(deps, onScreenshot);
    expect(deps.addScreenshotListener).toHaveBeenCalledExactlyOnceWith(onScreenshot);

    detach();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe('no per-screen off switch (D-13, source-level guarantee)', () => {
  it('this module exports no disable/re-enable-for-a-screen function', async () => {
    const mod = await freshModule();
    const exportNames = Object.keys(mod);
    const forbidden = exportNames.filter((name) => /disable|allow/i.test(name));
    expect(forbidden).toEqual([]);
  });
});
