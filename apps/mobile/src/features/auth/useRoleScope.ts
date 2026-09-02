/**
 * useRoleScope — pure UX-only derivation of the current user's role/scope from
 * the synced `teams`/`memberships`/`org_admins` tables (ROLE-01). This file
 * contains NO authorization logic and NEVER calls a Supabase RPC (ROLE-02):
 * it is a client-side convenience layer for UI gating only. Every privileged
 * write (lock_territory, create_territory_boundary, the future
 * assign_territory) independently re-derives entitlement server-side from
 * auth.uid() — this hook's output must never be trusted as the security
 * boundary.
 */

import { useEffect, useState } from 'react';
import { getSupabase } from '../../lib/auth/supabase';
import { openDatabase } from '../../lib/db/powersync';

export interface RoleScopeTeam {
  id: string;
  leadId: string | null;
  companyId: string | null;
  salesOrgId: string | null;
  name: string;
}

export interface RoleScope {
  ready: boolean;
  teams: RoleScopeTeam[];
  /** True iff the synced team row's leadId equals the current user id. */
  isTeamLead: (teamId: string) => boolean;
  /** True iff a synced org_admins row exists for (selfId, salesOrgId). */
  isOrgAdminOf: (salesOrgId: string) => boolean;
  /** 'rep' | 'team_lead' from the user's own synced membership row, or null. */
  roleForTeam: (teamId: string) => string | null;
}

/** Raw synced TEXT row shape from the local `teams` table. */
export interface RawTeamRecord {
  id: string;
  lead_id: string | null;
  company_id: string | null;
  sales_org_id: string | null;
  name: string;
}

/** Raw synced TEXT row shape from the local `memberships` table. */
export interface RawMembershipRecord {
  user_id: string;
  team_id: string;
  role_id: string | null;
}

/** Raw synced TEXT row shape from the local `org_admins` table. */
export interface RawOrgAdminRecord {
  user_id: string;
  sales_org_id: string;
}

function toRoleScopeTeam(record: RawTeamRecord): RoleScopeTeam {
  return {
    id: record.id,
    leadId: record.lead_id ?? null,
    companyId: record.company_id ?? null,
    salesOrgId: record.sales_org_id ?? null,
    name: record.name,
  };
}

/**
 * Pure function of (selfId, teamRows, membershipRows, orgAdminRows) — no DB,
 * no async, no RPC. Unit-testable without PowerSync. The synced rows are
 * already RLS-scoped (may include a team lead's/org admin's own team plus
 * fellow members/admins), so every lookup filters explicitly on `selfId`
 * rather than assuming the row set is self-only.
 */
export function deriveRoleScope(
  selfId: string | null,
  teamRows: RawTeamRecord[],
  membershipRows: RawMembershipRecord[],
  orgAdminRows: RawOrgAdminRecord[],
): RoleScope {
  const teams = teamRows.map(toRoleScopeTeam);

  return {
    ready: selfId !== null,
    teams,
    isTeamLead(teamId) {
      if (selfId === null) return false;
      const team = teams.find((t) => t.id === teamId);
      return team?.leadId === selfId;
    },
    isOrgAdminOf(salesOrgId) {
      if (selfId === null) return false;
      return orgAdminRows.some(
        (row) => row.user_id === selfId && row.sales_org_id === salesOrgId,
      );
    },
    roleForTeam(teamId) {
      if (selfId === null) return null;
      const own = membershipRows.find(
        (row) => row.user_id === selfId && row.team_id === teamId,
      );
      return own?.role_id ?? null;
    },
  };
}

// Module-const SELECT queries over the read-only synced tables (schema.ts,
// Plan 07-02) — mirrors profileRepo.ts's module-const-SQL convention. No
// params: RLS/the Sync Stream already scope which rows exist on-device, so
// there is nothing to bind here (unlike walletRepo/profileRepo's rep_id
// filter).
const TEAMS_QUERY = `
  SELECT id, lead_id, company_id, sales_org_id, name FROM teams
`;

const MEMBERSHIPS_QUERY = `
  SELECT user_id, team_id, role_id FROM memberships
`;

const ORG_ADMINS_QUERY = `
  SELECT user_id, sales_org_id FROM org_admins
`;

/**
 * Reactive shell: resolves selfId from the auth session, watches the 3
 * synced tables via db.watch (one AbortController, unsubscribe on unmount —
 * mirrors profileRepo.ts), and feeds the latest rows + selfId into the pure
 * deriveRoleScope above. Contains NO derivation logic of its own beyond
 * wiring data into deriveRoleScope, and NO RPC/write calls (ROLE-02).
 *
 * `ready` is true only once selfId has resolved AND the first watch result
 * has arrived for all 3 tables.
 */
export function useRoleScope(): RoleScope {
  const [selfId, setSelfId] = useState<string | null>(null);
  const [teamRows, setTeamRows] = useState<RawTeamRecord[]>([]);
  const [membershipRows, setMembershipRows] = useState<RawMembershipRecord[]>([]);
  const [orgAdminRows, setOrgAdminRows] = useState<RawOrgAdminRecord[]>([]);
  const [teamsLoaded, setTeamsLoaded] = useState(false);
  const [membershipsLoaded, setMembershipsLoaded] = useState(false);
  const [orgAdminsLoaded, setOrgAdminsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getSupabase()
      .auth.getSession()
      .then(({ data }) => {
        if (cancelled) return;
        setSelfId(data.session?.user.id ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    void openDatabase().then((db) => {
      if (cancelled) return;

      db.watch(
        TEAMS_QUERY,
        [],
        {
          onResult: (result) => {
            const rows = (result.rows?._array ?? []) as RawTeamRecord[];
            setTeamRows(rows);
            setTeamsLoaded(true);
          },
        },
        { signal: controller.signal },
      );

      db.watch(
        MEMBERSHIPS_QUERY,
        [],
        {
          onResult: (result) => {
            const rows = (result.rows?._array ?? []) as RawMembershipRecord[];
            setMembershipRows(rows);
            setMembershipsLoaded(true);
          },
        },
        { signal: controller.signal },
      );

      db.watch(
        ORG_ADMINS_QUERY,
        [],
        {
          onResult: (result) => {
            const rows = (result.rows?._array ?? []) as RawOrgAdminRecord[];
            setOrgAdminRows(rows);
            setOrgAdminsLoaded(true);
          },
        },
        { signal: controller.signal },
      );
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const scope = deriveRoleScope(selfId, teamRows, membershipRows, orgAdminRows);
  const watchReady = teamsLoaded && membershipsLoaded && orgAdminsLoaded;

  return { ...scope, ready: scope.ready && watchReady };
}
