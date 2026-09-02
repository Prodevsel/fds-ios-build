import { describe, expect, it, vi } from 'vitest';

// Node test environment (vitest.config.ts): never load the native
// expo-location module — only the default-wiring export references it, and
// every test here exercises getSignatureLocation() with fully injected deps
// (mirrors flowDraftsRepo.test.ts's expo-crypto stub pattern).
vi.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: vi.fn(),
  getCurrentPositionAsync: vi.fn(),
  PermissionStatus: { GRANTED: 'granted' },
  LocationAccuracy: { Balanced: 3 },
}));

import { getSignatureLocation, type SignatureLocationDeps } from './getSignatureLocation';

/**
 * D-04: GPS must never block signing and must never be continuous/background.
 * getSignatureLocation is a one-shot foreground fix with a timeout; denial
 * and timeout both resolve to gps:null with a reason, never a throw.
 */

function makeDeps(overrides: Partial<SignatureLocationDeps> = {}): SignatureLocationDeps {
  return {
    requestPermission: async () => ({ granted: true }),
    getCurrentPosition: async () => ({ lat: 52.52, lng: 13.405, accuracyM: 5 }),
    timeoutMs: 50,
    ...overrides,
  };
}

function delay<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

describe('getSignatureLocation', () => {
  it('returns a one-shot fix on granted permission', async () => {
    const result = await getSignatureLocation(makeDeps());
    expect(result).toEqual({ gps: { lat: 52.52, lng: 13.405, accuracyM: 5 } });
  });

  it('returns gps:null with permission-denied reason when permission is denied', async () => {
    const deps = makeDeps({ requestPermission: async () => ({ granted: false }) });
    const result = await getSignatureLocation(deps);
    expect(result).toEqual({ gps: null, reason: 'permission-denied' });
  });

  it('returns gps:null with timeout reason when the fix does not resolve in time', async () => {
    const deps = makeDeps({
      getCurrentPosition: () => delay({ lat: 1, lng: 1, accuracyM: 1 }, 500),
      timeoutMs: 20,
    });
    const result = await getSignatureLocation(deps);
    expect(result).toEqual({ gps: null, reason: 'timeout' });
  });

  it('never throws even when requestPermission rejects', async () => {
    const deps = makeDeps({
      requestPermission: async () => {
        throw new Error('permission API exploded');
      },
    });
    await expect(getSignatureLocation(deps)).resolves.toEqual({ gps: null, reason: 'error' });
  });

  it('never throws even when getCurrentPosition rejects', async () => {
    const deps = makeDeps({
      getCurrentPosition: async () => {
        throw new Error('position API exploded');
      },
    });
    await expect(getSignatureLocation(deps)).resolves.toEqual({ gps: null, reason: 'error' });
  });
});
