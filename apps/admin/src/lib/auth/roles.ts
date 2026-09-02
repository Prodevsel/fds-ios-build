/**
 * Admin role model (D-01).
 *
 * Roles are derived server-side from the tenant hierarchy (migration 0001):
 *   - an `org_admins` row  -> `operator` (org-wide oversight)
 *   - a `teams.lead_id` match -> `team_lead`
 *
 * Kept in its own module (no Supabase import) so pure UI (SidebarNav) can depend
 * on the type without pulling the client into component unit tests.
 */
export type AdminRole = 'operator' | 'team_lead';
