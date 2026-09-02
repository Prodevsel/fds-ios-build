import { describe, expect, it } from 'vitest';

// Node test environment: this hook transitively imports getSupabase (lib/auth/supabase)
// and openDatabase (lib/db/powersync), both of which reach into native modules — mock
// them so the pure deriveRoleScope tests never load the native react-native chain.
import { vi } from 'vitest';
vi.mock('../../lib/auth/supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('../../lib/db/powersync', () => ({ openDatabase: vi.fn() }));

import { deriveRoleScope } from './useRoleScope';

const team = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'team-a',
  lead_id: 'lead-1',
  company_id: 'company-1',
  sales_org_id: 'org-1',
  name: 'Team A',
  ...overrides,
});

const membership = (overrides: Partial<Record<string, unknown>> = {}) => ({
  user_id: 'self-1',
  team_id: 'team-a',
  role_id: 'rep',
  ...overrides,
});

const orgAdmin = (overrides: Partial<Record<string, unknown>> = {}) => ({
  user_id: 'self-1',
  sales_org_id: 'org-1',
  ...overrides,
});

describe('deriveRoleScope.isTeamLead', () => {
  it('is true when the synced team row leadId equals selfId', () => {
    const scope = deriveRoleScope('lead-1', [team({ lead_id: 'lead-1' })], [], []);
    expect(scope.isTeamLead('team-a')).toBe(true);
  });

  it('is false for a plain member (leadId differs from selfId)', () => {
    const scope = deriveRoleScope('rep-1', [team({ lead_id: 'lead-1' })], [], []);
    expect(scope.isTeamLead('team-a')).toBe(false);
  });

  it('is false for a non-member (team not in the synced rows at all)', () => {
    const scope = deriveRoleScope('lead-1', [], [], []);
    expect(scope.isTeamLead('team-a')).toBe(false);
  });

  it('is false for an unknown teamId', () => {
    const scope = deriveRoleScope('lead-1', [team({ lead_id: 'lead-1' })], [], []);
    expect(scope.isTeamLead('unknown-team')).toBe(false);
  });

  it('is false when selfId is null (not-ready)', () => {
    const scope = deriveRoleScope(null, [team({ lead_id: 'lead-1' })], [], []);
    expect(scope.isTeamLead('team-a')).toBe(false);
  });
});

describe('deriveRoleScope.roleForTeam', () => {
  it("returns the user's own membership role_id for that team", () => {
    const scope = deriveRoleScope(
      'self-1',
      [],
      [membership({ user_id: 'self-1', team_id: 'team-a', role_id: 'team_lead' })],
      [],
    );
    expect(scope.roleForTeam('team-a')).toBe('team_lead');
  });

  it('returns null when no membership row exists for that team', () => {
    const scope = deriveRoleScope('self-1', [], [membership({ team_id: 'team-b' })], []);
    expect(scope.roleForTeam('team-a')).toBeNull();
  });

  it("does not return another user's membership row for the same team", () => {
    const scope = deriveRoleScope(
      'self-1',
      [],
      [membership({ user_id: 'other-user', team_id: 'team-a', role_id: 'team_lead' })],
      [],
    );
    expect(scope.roleForTeam('team-a')).toBeNull();
  });

  it('returns null when selfId is null (not-ready)', () => {
    const scope = deriveRoleScope(null, [], [membership({ team_id: 'team-a' })], []);
    expect(scope.roleForTeam('team-a')).toBeNull();
  });
});

describe('deriveRoleScope.isOrgAdminOf', () => {
  it('is true when a synced org_admins row exists for (selfId, salesOrgId)', () => {
    const scope = deriveRoleScope('self-1', [], [], [orgAdmin({ user_id: 'self-1', sales_org_id: 'org-1' })]);
    expect(scope.isOrgAdminOf('org-1')).toBe(true);
  });

  it('is false when no matching org_admins row exists for this user', () => {
    const scope = deriveRoleScope('self-1', [], [], [orgAdmin({ user_id: 'other-user', sales_org_id: 'org-1' })]);
    expect(scope.isOrgAdminOf('org-1')).toBe(false);
  });

  it('is false for a different salesOrgId', () => {
    const scope = deriveRoleScope('self-1', [], [], [orgAdmin({ user_id: 'self-1', sales_org_id: 'org-2' })]);
    expect(scope.isOrgAdminOf('org-1')).toBe(false);
  });

  it('is false when selfId is null (not-ready)', () => {
    const scope = deriveRoleScope(null, [], [], [orgAdmin({ sales_org_id: 'org-1' })]);
    expect(scope.isOrgAdminOf('org-1')).toBe(false);
  });
});

describe('deriveRoleScope.ready and teams', () => {
  it('ready is false when selfId is null', () => {
    const scope = deriveRoleScope(null, [], [], []);
    expect(scope.ready).toBe(false);
  });

  it('ready is true once selfId is resolved', () => {
    const scope = deriveRoleScope('self-1', [], [], []);
    expect(scope.ready).toBe(true);
  });

  it('exposes the mapped teams array', () => {
    const scope = deriveRoleScope(
      'self-1',
      [team({ id: 'team-a', lead_id: 'lead-1', company_id: 'company-1', sales_org_id: 'org-1', name: 'Team A' })],
      [],
      [],
    );
    expect(scope.teams).toEqual([
      { id: 'team-a', leadId: 'lead-1', companyId: 'company-1', salesOrgId: 'org-1', name: 'Team A' },
    ]);
  });
});
