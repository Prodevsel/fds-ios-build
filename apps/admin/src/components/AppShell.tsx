import { getSupabase } from '@/lib/supabase';
import { useSession } from '@/lib/auth/useSession';
import { LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router-dom';
import { BrandLogo } from './BrandLogo';
import { SidebarNav } from './SidebarNav';

/** pathname → nav i18n key, for the top-bar breadcrumb (1:1 with the design). */
const PATH_LABEL: Record<string, string> = {
  '/': 'nav.overview',
  '/unternehmen': 'nav.companies',
  '/widerruf': 'nav.cancellations',
  '/reporting': 'nav.reporting',
  '/mitarbeiter': 'nav.reps',
  '/gebiete': 'nav.territories',
  '/branding': 'nav.branding',
  '/api-schluessel': 'nav.apiKeys',
  '/webhooks': 'nav.webhooks',
  '/einstellungen': 'nav.settings',
};

/**
 * Role-scoped application shell — ported 1:1 from the Claude Design contract:
 * a 240px Ink-Navy sidebar (logo + Partner-Admin, grouped nav, user footer) and
 * a Paper-Grey content area with a 64px top bar (role breadcrumb + live date).
 * All colours are token-driven (`bg-ink` / `bg-paper` / `text-porch`).
 */
export function AppShell() {
  const { t } = useTranslation('common');
  const { role, session } = useSession();
  const { pathname } = useLocation();

  const email = session?.user.email ?? '';
  const name = email
    ? email
        .split('@')[0]!
        .replace(/[._-]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : '—';
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const roleLabel = role ? t(`role.${role}`) : '';
  const pageLabel = t(PATH_LABEL[pathname] ?? 'nav.overview');
  const today = new Date().toLocaleDateString('de-DE', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="flex h-screen overflow-hidden bg-paper">
      {/* SIDEBAR */}
      <aside className="flex w-[240px] shrink-0 flex-col bg-ink text-paper">
        <div className="flex items-center gap-[11px] px-5 pb-5 pt-[22px]">
          <BrandLogo size={34} />
          <div>
            <div className="font-display text-[16px] font-medium leading-[18px]">FrontDoorSales</div>
            <div className="text-[11px] text-paper/50">Partner-Admin</div>
          </div>
        </div>

        {role ? <SidebarNav role={role} /> : <div className="flex-1" />}

        <div className="mt-auto border-t border-paper/[.08] px-3 py-4">
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-porch text-[13px] font-medium text-ink">
              {initials || '—'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{name}</div>
              <div className="text-[11px] text-paper/50">{roleLabel}</div>
            </div>
            <button
              type="button"
              onClick={() => void getSupabase().auth.signOut()}
              aria-label={t('auth.signOut')}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-paper/50 transition-colors hover:bg-paper/[.06] hover:text-paper"
            >
              <LogOut aria-hidden className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-ink/10 px-8">
          <div className="flex items-center gap-2.5 text-[13px] text-[#5C6B85]">
            <span>{roleLabel}</span>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="m9 18 6-6-6-6" />
            </svg>
            <span className="font-medium text-ink">{pageLabel}</span>
          </div>
          <div className="font-mono text-[12px] text-[#8792a6]">{today}</div>
        </header>

        <main className="fds-scroll flex-1 overflow-y-auto p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
