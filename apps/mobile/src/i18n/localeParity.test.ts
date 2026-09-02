import { describe, expect, it } from 'vitest';
import de from './de.json';
import en from './en.json';

/**
 * Bidirectional key-parity assertion between de.json and en.json (T-12-06-02):
 * a gap in either direction is a build failure, not something caught by
 * inspection. Also guards against an English bundle containing a copy-paste
 * empty string, which would render as a blank UI element in one locale.
 */
describe('locale key parity (de.json <-> en.json)', () => {
  const deKeys = Object.keys(de);
  const enKeys = Object.keys(en);

  it('every de.json key has an en.json counterpart', () => {
    const missingInEn = deKeys.filter((key) => !(key in en));
    expect(missingInEn).toEqual([]);
  });

  it('every en.json key has a de.json counterpart', () => {
    const missingInDe = enKeys.filter((key) => !(key in de));
    expect(missingInDe).toEqual([]);
  });

  it('de.json and en.json have the same key count', () => {
    expect(enKeys.length).toBe(deKeys.length);
  });

  it('has at least 385 keys (the pre-existing de.json baseline)', () => {
    expect(deKeys.length).toBeGreaterThanOrEqual(385);
  });

  it('no English value is an empty string', () => {
    const empty = enKeys.filter((key) => (en as Record<string, string>)[key] === '');
    expect(empty).toEqual([]);
  });
});
