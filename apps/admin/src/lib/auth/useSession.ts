import { getSupabase } from '@/lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { AdminRole } from './roles';

export interface SessionState {
  session: Session | null;
  role: AdminRole | null;
  loading: boolean;
}

/**
 * Resolve the signed-in user's admin role from the tenant hierarchy (0001).
 * An `org_admins` row -> `operator`; otherwise a `teams.lead_id` match ->
 * `team_lead`. Every one of these reads still passes Supabase RLS — this is a
 * convenience derivation for UX scoping only, NOT an access-control authority
 * (T-05-01).
 */
async function resolveRole(userId: string): Promise<AdminRole | null> {
  const supabase = getSupabase();

  // THROW on error, never swallow it. Returning null for a failed read makes a
  // transient network blip indistinguishable from "this user has no role" —
  // React Query sees a successful null, never retries, and RoleGuard now
  // replaces the ENTIRE app with "Kein Zugang" until a full page reload. An
  // empty sidebar was survivable; a locked-out operator is not.
  const { data: orgAdmin, error: orgAdminError } = await supabase
    .from('org_admins')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  if (orgAdminError) {
    throw orgAdminError;
  }
  if (orgAdmin) {
    return 'operator';
  }

  const { data: team, error: teamError } = await supabase
    .from('teams')
    .select('id')
    .eq('lead_id', userId)
    .limit(1)
    .maybeSingle();
  if (teamError) {
    throw teamError;
  }
  if (team) {
    return 'team_lead';
  }

  return null;
}

/**
 * Subscribes to the Supabase Auth session and resolves the derived admin role.
 * `loading` stays true until BOTH the session and (if signed in) the role query
 * have settled, so guards/shell never flash the wrong nav.
 */
export function useSession(): SessionState {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  useEffect(() => {
    const supabase = getSupabase();
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) {
        return;
      }
      setSession(data.session);
      setSessionLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const userId = session?.user.id;
  const { data: role, isLoading: roleLoading } = useQuery({
    queryKey: ['admin-role', userId],
    queryFn: () => (userId ? resolveRole(userId) : Promise.resolve(null)),
    enabled: Boolean(userId),
  });

  return {
    session,
    role: role ?? null,
    loading: sessionLoading || (Boolean(userId) && roleLoading),
  };
}
