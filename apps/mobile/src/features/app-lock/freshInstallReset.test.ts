import { describe, expect, it, vi } from 'vitest';
import { resetAppLockOnFreshInstall } from './freshInstallReset';

function makeDeps(preInstalled: boolean) {
  const map = new Map<string, string>();
  if (preInstalled) map.set('installed', '2026-01-01T00:00:00.000Z');
  return {
    map,
    deps: {
      storage: {
        getString: (k: string) => map.get(k),
        set: (k: string, v: string) => void map.set(k, v),
      },
      clearPin: vi.fn(async () => {}),
      clearAttempts: vi.fn(async () => {}),
    },
  };
}

describe('resetAppLockOnFreshInstall', () => {
  it('clears keychain state on the first launch after a reinstall', async () => {
    const { deps, map } = makeDeps(false);
    await expect(resetAppLockOnFreshInstall(deps)).resolves.toBe(true);
    expect(deps.clearPin).toHaveBeenCalledOnce();
    expect(deps.clearAttempts).toHaveBeenCalledOnce();
    expect(map.get('installed')).toBeDefined();
  });

  it('leaves an existing install alone', async () => {
    const { deps } = makeDeps(true);
    await expect(resetAppLockOnFreshInstall(deps)).resolves.toBe(false);
    expect(deps.clearPin).not.toHaveBeenCalled();
    expect(deps.clearAttempts).not.toHaveBeenCalled();
  });

  it('does not wipe a working install when the marker store throws', async () => {
    const deps = {
      storage: {
        getString: () => {
          throw new Error('mmkv unavailable');
        },
        set: () => {},
      },
      clearPin: vi.fn(async () => {}),
      clearAttempts: vi.fn(async () => {}),
    };
    await expect(resetAppLockOnFreshInstall(deps)).resolves.toBe(false);
    expect(deps.clearPin).not.toHaveBeenCalled();
  });
});
