import { describe, expect, it } from 'vitest';
import {
  AUTO_LOCK_TIMEOUT_MINUTES_OPTIONS,
  isAutoLockTimeoutMinutes,
} from './autoLockOptions';

describe('AUTO_LOCK_TIMEOUT_MINUTES_OPTIONS', () => {
  it('deep-equals the D-18 value list exactly', () => {
    expect(AUTO_LOCK_TIMEOUT_MINUTES_OPTIONS).toEqual([1, 5, 15, 30, 60]);
  });

  it('has exactly five entries', () => {
    expect(AUTO_LOCK_TIMEOUT_MINUTES_OPTIONS).toHaveLength(5);
  });
});

describe('isAutoLockTimeoutMinutes', () => {
  it('accepts every allowed value', () => {
    for (const value of AUTO_LOCK_TIMEOUT_MINUTES_OPTIONS) {
      expect(isAutoLockTimeoutMinutes(value)).toBe(true);
    }
  });

  it('rejects a value outside the closed set', () => {
    expect(isAutoLockTimeoutMinutes(45)).toBe(false);
    expect(isAutoLockTimeoutMinutes(0)).toBe(false);
  });

  it('rejects non-number values', () => {
    expect(isAutoLockTimeoutMinutes('15')).toBe(false);
    expect(isAutoLockTimeoutMinutes(null)).toBe(false);
    expect(isAutoLockTimeoutMinutes(undefined)).toBe(false);
  });
});
