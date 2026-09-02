import { describe, expect, it } from 'vitest';
import { buildDemoUrl } from './demoBackendUrl';

// The whole point of the override is that an operator retypes a host under time
// pressure: a stray space or a pasted value must still produce a usable URL, and
// the port must not be the thing they have to remember.
describe('buildDemoUrl', () => {
  it('builds the local-stack URL from a bare host', () => {
    expect(buildDemoUrl('100.83.111.128', 54321)).toBe('http://100.83.111.128:54321');
  });

  it('trims whitespace around a pasted host', () => {
    expect(buildDemoUrl('  10.0.0.5 ', 8080)).toBe('http://10.0.0.5:8080');
  });

  it('appends the edge-functions path', () => {
    expect(buildDemoUrl('10.0.0.5', 54321, '/functions/v1')).toBe(
      'http://10.0.0.5:54321/functions/v1',
    );
  });
});
