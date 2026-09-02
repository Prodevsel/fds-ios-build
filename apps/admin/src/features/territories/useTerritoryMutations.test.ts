import { describe, expect, it } from 'vitest';
import { TerritoryVerdictError, verdictMessageKey } from './useTerritoryMutations';

/**
 * The verdict→copy mapping is the only place a failed territory write becomes
 * something the team lead reads, so it has to be total: every RPC verdict gets
 * its own message, and anything unrecognised still produces a message rather
 * than silently rendering nothing.
 */
describe('verdictMessageKey', () => {
  it('maps each discriminated RPC verdict to its own key', () => {
    expect(verdictMessageKey(new TerritoryVerdictError('not_entitled'))).toBe('verdict.not_entitled');
    expect(verdictMessageKey(new TerritoryVerdictError('not_team_member'))).toBe('verdict.not_team_member');
    expect(verdictMessageKey(new TerritoryVerdictError('not_activated'))).toBe('verdict.not_activated');
    expect(verdictMessageKey(new TerritoryVerdictError('invalid_geometry'))).toBe('verdict.invalid_geometry');
  });

  it('falls back to the generic key for an unrecognised verdict or a transport error', () => {
    expect(verdictMessageKey(new TerritoryVerdictError('unknown'))).toBe('verdict.unknown');
    expect(verdictMessageKey(new Error('Failed to fetch'))).toBe('verdict.unknown');
    expect(verdictMessageKey(null)).toBe('verdict.unknown');
  });
});
