import { describe, expect, it } from 'vitest';
import { isMailable } from './mailableEmail';

describe('isMailable', () => {
  it('rejects the address that actually broke delivery', () => {
    // `s.@live.de` reached a real lead, passed `.includes('@')`, and was
    // rejected by the mail server with 553 5.1.3 three times before anyone
    // noticed. This assertion is the whole reason this module exists.
    expect(isMailable('s.@live.de')).toBe(false);
  });

  it('rejects the rest of the same failure class — a dot where none may be', () => {
    for (const bad of ['.s@live.de', 'a..b@live.de', 'a@.live.de', 'a@live.de.', 'a@live..de']) {
      expect(isMailable(bad)).toBe(false);
    }
  });

  it('rejects what is not an address at all', () => {
    for (const bad of ['', '   ', 'live.de', 'a@', '@live.de', 'a@b', 'a@b.d', 'a b@live.de', 'a@@live.de', null, 42]) {
      expect(isMailable(bad)).toBe(false);
    }
  });

  it('accepts the addresses customers actually give', () => {
    for (const good of [
      'sam@elkhalil.dev',
      'vertrieb@demo.frontdoorsales.de',
      'a.b-c+tag@sub.example.co.uk',
      's@live.de',
    ]) {
      expect(isMailable(good)).toBe(true);
    }
  });

  it('ignores surrounding whitespace rather than failing on it', () => {
    expect(isMailable('  sam@elkhalil.dev  ')).toBe(true);
  });
});
