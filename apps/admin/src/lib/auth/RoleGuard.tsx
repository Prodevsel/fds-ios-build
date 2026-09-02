import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getSupabase } from '@/lib/supabase';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { useSession } from './useSession';

/**
 * Route guard: redirects unauthenticated users to the Supabase-Auth login.
 *
 * SECURITY (T-05-01): this guard — and role-based nav visibility — are UX
 * scoping ONLY. Every data read still passes Supabase RLS, which is the real
 * authority. Never treat a hidden route or nav item as an access control:
 * hiding "API-Schlüssel" from a team lead is convenience, not enforcement.
 */
export function RoleGuard({ children }: { children: ReactNode }) {
  const { session, role, loading } = useSession();
  const { t } = useTranslation('common');

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-xl">
        <Skeleton className="h-32 w-full max-w-md" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  // A signed-in user who is neither an org admin nor a team lead — a sales rep,
  // in practice. They used to land on the shell with an EMPTY sidebar, because
  // every nav item declares a role and none of them matched. Nothing was ever
  // exposed (RLS gives them nothing either way), but a blank dashboard reads as
  // broken software, and the person seeing it has no way to tell the difference
  // between "not for you" and "it crashed". Say which one it is.
  if (!role) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-xl">
        <div className="flex max-w-md flex-col gap-md text-center">
          <h1 className="font-display text-heading text-foreground">{t('noAccess.heading')}</h1>
          <p className="text-body text-muted-foreground">{t('noAccess.body')}</p>
          <Button
            variant="outline"
            className="self-center"
            onClick={() => void getSupabase().auth.signOut()}
          >
            {t('noAccess.signOut')}
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
