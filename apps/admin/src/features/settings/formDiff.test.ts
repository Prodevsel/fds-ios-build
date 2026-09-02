import { describe, expect, it } from 'vitest';
import { isFormDirty } from './formDiff';

/**
 * SET-09 / 13-UI-SPEC.md "Admin Save/Dirty Contract" — proves `isFormDirty`
 * is a structural diff, not a one-way flag: a change-then-revert must
 * correctly return to `false`, which is the whole point of this helper
 * existing instead of reusing `BrandingPage.tsx`'s `setDirty(true)` idiom.
 */
describe('isFormDirty', () => {
  it('is false when every field matches', () => {
    expect(isFormDirty({ name: 'a' }, { name: 'a' })).toBe(false);
  });

  it('is true when a field differs', () => {
    expect(isFormDirty({ name: 'b' }, { name: 'a' })).toBe(true);
  });

  it('change-then-revert returns to false (the diff rule, not a one-way flag)', () => {
    const lastLoaded = { name: 'a', language: 'de' };
    let current = { ...lastLoaded, name: 'b' };
    expect(isFormDirty(current, lastLoaded)).toBe(true);

    current = { ...current, name: 'a' };
    expect(isFormDirty(current, lastLoaded)).toBe(false);
  });

  it('a whitespace-only difference in a trimmed field is not dirty', () => {
    expect(isFormDirty({ name: '  a  ' }, { name: 'a' })).toBe(false);
  });

  it('normalizes null vs empty string as equal, not dirty', () => {
    expect(isFormDirty({ language: '' }, { language: null })).toBe(false);
    expect(isFormDirty({ language: null }, { language: '' })).toBe(false);
  });

  it('detects a change across multiple fields, only one of which actually differs', () => {
    const lastLoaded = { name: 'a', language: 'de' };
    expect(isFormDirty({ name: 'a', language: 'en' }, lastLoaded)).toBe(true);
  });

  it('is false for two empty objects', () => {
    expect(isFormDirty({}, {})).toBe(false);
  });
});
