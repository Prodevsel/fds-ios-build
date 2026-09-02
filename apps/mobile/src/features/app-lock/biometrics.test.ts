import { describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

// Node test environment (vitest.config.ts): never load the native
// expo-local-authentication module — only `defaultBiometricDeps` references
// it, and every behavioral test here exercises the exported functions
// against fully injected fakes (`pinHash.test.ts` precedent).
vi.mock('expo-local-authentication', () => ({
  hasHardwareAsync: vi.fn(),
  isEnrolledAsync: vi.fn(),
  supportedAuthenticationTypesAsync: vi.fn(),
  authenticateAsync: vi.fn(),
}));

import * as LocalAuthentication from 'expo-local-authentication';
import {
  attemptBiometricUnlock,
  biometricLabelFor,
  classifyBiometricError,
  defaultBiometricDeps,
  type BiometricDeps,
} from './biometrics';

function makeDeps(overrides: Partial<BiometricDeps> = {}): BiometricDeps {
  return {
    hasHardwareAsync: vi.fn().mockResolvedValue(true),
    isEnrolledAsync: vi.fn().mockResolvedValue(true),
    supportedTypesAsync: vi.fn().mockResolvedValue([2]),
    authenticateAsync: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  };
}

describe('attemptBiometricUnlock', () => {
  it('returns unavailable/no_hardware and never calls authenticateAsync when hardware is absent', async () => {
    const deps = makeDeps({ hasHardwareAsync: vi.fn().mockResolvedValue(false) });
    const outcome = await attemptBiometricUnlock(deps);
    expect(outcome).toEqual({ kind: 'unavailable', reason: 'no_hardware' });
    expect(deps.authenticateAsync).not.toHaveBeenCalled();
  });

  it('returns unavailable/not_enrolled and never calls authenticateAsync when nothing is enrolled', async () => {
    const deps = makeDeps({ isEnrolledAsync: vi.fn().mockResolvedValue(false) });
    const outcome = await attemptBiometricUnlock(deps);
    expect(outcome).toEqual({ kind: 'unavailable', reason: 'not_enrolled' });
    expect(deps.authenticateAsync).not.toHaveBeenCalled();
  });

  it('always calls authenticateAsync with disableDeviceFallback: true (D-09)', async () => {
    const deps = makeDeps();
    await attemptBiometricUnlock(deps);
    expect(deps.authenticateAsync).toHaveBeenCalledWith({ disableDeviceFallback: true });
  });

  it('returns success only when authenticateAsync reports success: true', async () => {
    const deps = makeDeps({ authenticateAsync: vi.fn().mockResolvedValue({ success: true }) });
    const outcome = await attemptBiometricUnlock(deps);
    expect(outcome).toEqual({ kind: 'success' });
  });

  it('classifies a failed authenticateAsync result via classifyBiometricError', async () => {
    const deps = makeDeps({
      authenticateAsync: vi.fn().mockResolvedValue({ success: false, error: 'lockout' }),
    });
    const outcome = await attemptBiometricUnlock(deps);
    expect(outcome).toEqual({ kind: 'failed', reason: 'lockout' });
  });
});

describe('classifyBiometricError', () => {
  it('maps lockout to failed/lockout', () => {
    expect(classifyBiometricError('lockout')).toEqual({ kind: 'failed', reason: 'lockout' });
  });

  it('maps user_cancel to failed/user_cancel', () => {
    expect(classifyBiometricError('user_cancel')).toEqual({ kind: 'failed', reason: 'user_cancel' });
  });

  it('maps system_cancel to failed/system_cancel', () => {
    expect(classifyBiometricError('system_cancel')).toEqual({ kind: 'failed', reason: 'system_cancel' });
  });

  it('maps not_enrolled to unavailable/not_enrolled', () => {
    expect(classifyBiometricError('not_enrolled')).toEqual({ kind: 'unavailable', reason: 'not_enrolled' });
  });

  it('maps not_available to unavailable/no_hardware', () => {
    expect(classifyBiometricError('not_available')).toEqual({ kind: 'unavailable', reason: 'no_hardware' });
  });

  it('maps every unrecognized error string to failed/sensor_error, never success', () => {
    expect(classifyBiometricError('app_cancel')).toEqual({ kind: 'failed', reason: 'sensor_error' });
    expect(classifyBiometricError('timeout')).toEqual({ kind: 'failed', reason: 'sensor_error' });
    expect(classifyBiometricError('authentication_failed')).toEqual({ kind: 'failed', reason: 'sensor_error' });
    expect(classifyBiometricError('some_future_unknown_code')).toEqual({ kind: 'failed', reason: 'sensor_error' });
  });

  it('maps undefined to failed/sensor_error, never success', () => {
    expect(classifyBiometricError(undefined)).toEqual({ kind: 'failed', reason: 'sensor_error' });
  });
});

describe('biometricLabelFor', () => {
  it('returns Face ID on iOS when FACIAL_RECOGNITION (2) is reported', () => {
    expect(biometricLabelFor([2], 'ios')).toBe('Face ID');
  });

  it('returns Touch ID on iOS when only FINGERPRINT (1) is reported', () => {
    expect(biometricLabelFor([1], 'ios')).toBe('Touch ID');
  });

  it('returns Fingerabdruck on android regardless of the reported type', () => {
    expect(biometricLabelFor([1], 'android')).toBe('Fingerabdruck');
    expect(biometricLabelFor([2], 'android')).toBe('Fingerabdruck');
    expect(biometricLabelFor([3], 'android')).toBe('Fingerabdruck');
  });
});

describe('defaultBiometricDeps', () => {
  it('wires authenticateAsync to expo-local-authentication and always passes disableDeviceFallback through', async () => {
    vi.mocked(LocalAuthentication.authenticateAsync).mockResolvedValue({ success: true } as never);
    const result = await defaultBiometricDeps.authenticateAsync({ disableDeviceFallback: true });
    expect(result).toEqual({ success: true });
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledWith({ disableDeviceFallback: true });
  });

  it('wires a failed authenticateAsync result through with its error', async () => {
    vi.mocked(LocalAuthentication.authenticateAsync).mockResolvedValue({
      success: false,
      error: 'lockout',
    } as never);
    const result = await defaultBiometricDeps.authenticateAsync({ disableDeviceFallback: true });
    expect(result).toEqual({ success: false, error: 'lockout' });
  });

  it('wires hasHardwareAsync/isEnrolledAsync/supportedTypesAsync to the real module functions', async () => {
    vi.mocked(LocalAuthentication.hasHardwareAsync).mockResolvedValue(true);
    vi.mocked(LocalAuthentication.isEnrolledAsync).mockResolvedValue(true);
    vi.mocked(LocalAuthentication.supportedAuthenticationTypesAsync).mockResolvedValue([2] as never);

    await expect(defaultBiometricDeps.hasHardwareAsync()).resolves.toBe(true);
    await expect(defaultBiometricDeps.isEnrolledAsync()).resolves.toBe(true);
    await expect(defaultBiometricDeps.supportedTypesAsync()).resolves.toEqual([2]);
  });
});

describe('biometrics.ts source (D-09: never delegates to the device passcode)', () => {
  it('never references DEVICE_PASSCODE anywhere in the module', () => {
    const filePath = fileURLToPath(new URL('./biometrics.ts', import.meta.url));
    const source = readFileSync(filePath, 'utf-8');
    expect(source).not.toMatch(/DEVICE_PASSCODE/);
  });

  it('imports expo-local-authentication exactly once, for defaultBiometricDeps only', () => {
    const filePath = fileURLToPath(new URL('./biometrics.ts', import.meta.url));
    const source = readFileSync(filePath, 'utf-8');
    const importLines = source
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line) && /expo-local-authentication/.test(line));
    expect(importLines).toHaveLength(1);
  });
});
