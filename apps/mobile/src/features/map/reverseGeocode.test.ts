import { describe, expect, it, vi } from 'vitest';
import { formatAddress, reverseGeocode } from './reverseGeocode';

describe('formatAddress', () => {
  it('reads the way a rep says it at the door', () => {
    expect(
      formatAddress({ road: 'Poststraße', house_number: '12', postcode: '71229', city: 'Leonberg' }),
    ).toBe('Poststraße 12, 71229 Leonberg');
  });

  it('drops missing parts instead of rendering undefined', () => {
    expect(formatAddress({ road: 'Poststraße', city: 'Leonberg' })).toBe('Poststraße, Leonberg');
  });

  it('returns null when nothing usable came back', () => {
    expect(formatAddress({})).toBeNull();
    expect(formatAddress(undefined)).toBeNull();
  });
});

describe('reverseGeocode', () => {
  it('returns null rather than throwing when the network fails', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(reverseGeocode(48.8, 9.01, { fetchFn, now: () => 1e12 })).resolves.toBeNull();
  });

  it('returns null on a non-OK response', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false }) as Response) as unknown as typeof fetch;
    await expect(reverseGeocode(48.8, 9.01, { fetchFn, now: () => 1e12 })).resolves.toBeNull();
  });

  it('formats a successful lookup', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ address: { road: 'Poststraße', house_number: '12', postcode: '71229', town: 'Leonberg' } }),
    }) as unknown as Response) as unknown as typeof fetch;
    await expect(reverseGeocode(48.8, 9.01, { fetchFn, now: () => 1e12 })).resolves.toBe(
      'Poststraße 12, 71229 Leonberg',
    );
  });
});
