import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/auth/supabase', () => ({ getSupabase: vi.fn() }));

import { deriveInitials } from './useSessionIdentity';

describe('deriveInitials', () => {
  it('takes the first two name words', () => {
    expect(deriveInitials('Jonas Weber', 'x@y.de')).toBe('JW');
    expect(deriveInitials('Jonas Peter Weber', null)).toBe('JP');
  });
  it('falls back to the email local part when there is no name', () => {
    expect(deriveInitials(null, 'jonas.weber@aussendienst.de')).toBe('JO');
    expect(deriveInitials('', 'ab@x.de')).toBe('AB');
  });
  it('returns empty string when nothing is available', () => {
    expect(deriveInitials(null, null)).toBe('');
  });
});
