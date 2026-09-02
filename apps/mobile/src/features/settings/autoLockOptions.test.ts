import { describe, expect, it } from 'vitest';

import { AUTO_LOCK_TIMEOUT_MINUTES_OPTIONS, isAutoLockTimeoutMinutes } from './autoLockOptions';

describe('AUTO_LOCK_TIMEOUT_MINUTES_OPTIONS (D-18 closed value set)', () => {
  it('is exactly [1, 5, 15, 30, 60] — the drift-tested literal shared with 0074/0075/apps/admin', () => {
    expect(AUTO_LOCK_TIMEOUT_MINUTES_OPTIONS).toEqual([1, 5, 15, 30, 60]);
  });
});

describe('isAutoLockTimeoutMinutes (narrowing guard)', () => {
  it('accepts every value in the closed set', () => {
    for (const value of AUTO_LOCK_TIMEOUT_MINUTES_OPTIONS) {
      expect(isAutoLockTimeoutMinutes(value)).toBe(true);
    }
  });

  it('rejects a numeric value outside the closed set', () => {
    expect(isAutoLockTimeoutMinutes(10)).toBe(false);
    expect(isAutoLockTimeoutMinutes(0)).toBe(false);
  });

  it('rejects null', () => {
    expect(isAutoLockTimeoutMinutes(null)).toBe(false);
  });

  it('rejects a string look-alike', () => {
    expect(isAutoLockTimeoutMinutes('15')).toBe(false);
  });
});
