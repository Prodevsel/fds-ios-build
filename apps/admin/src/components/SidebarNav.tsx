import { useTenantName } from '@/features/settings/useTenantName';
import type { AdminRole } from '@/lib/auth/roles';
import { cn } from '@/lib/utils';
import {
  BarChart3,
  Building2,
  FileSignature,
  FileText,
  FileX2,
  KeyRound,
  LayoutDashboard,
  type LucideIcon,
  MapIcon,
  Settings,
  Share2,
  Trophy,
  Users,
  Webhook,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';

type NavSection = 'main' | 'account';

interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  roles: readonly AdminRole[];
  section: NavSection;
}

const BOTH: readonly AdminRole[] = ['operator', 'team_lead'];

/**
 * Nav model (D-01), ordered + grouped 1:1 with the Claude Design sidebar.
 * Each item declares which roles may act on it; only the current role's items
 * render (no disabled-but-visible entries). Icons match the design's lucide set.
 */
const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', labelKey: 'nav.overview', icon: LayoutDashboard, roles: BOTH, section: 'main' },
  { to: '/unternehmen', labelKey: 'nav.companies', icon: Building2, roles: ['operator'], section: 'main' },
  {
    to: '/direktunterschrift',
    labelKey: 'nav.directSignTemplates',
    icon: FileSignature,
    roles: ['operator'],
    section: 'main',
  },
  { to: '/widerruf', labelKey: 'nav.cancellations', icon: FileX2, roles: BOTH, section: 'main' },
  // roles: BOTH is the point of D-3 — the operator does NOT see /reporting,
  // so the per-deal document list cannot live there.
  { to: '/abschluesse', labelKey: 'nav.deals', icon: FileText, roles: BOTH, section: 'main' },
  { to: '/reporting', labelKey: 'nav.reporting', icon: BarChart3, roles: ['team_lead'], section: 'main' },
  // roles: BOTH is DISCOVERABILITY, not access. Routes are not role-bound
  // (App.tsx), RoleGuard calls itself "UX scoping ONLY", and SettingsPage
  // already links both roles here via `team.manageLink` — the operator was
  // always two clicks away. What was missing is the signpost: /mitarbeiter is
  // where an operator appoints a team lead (0091), and they had no reason to
  // look for it there.
  { to: '/mitarbeiter', labelKey: 'nav.reps', icon: Users, roles: BOTH, section: 'main' },
  { to: '/gebiete', labelKey: 'nav.territories', icon: MapIcon, roles: ['team_lead'], section: 'main' },
  {
    to: '/leaderboard-konfiguration',
    labelKey: 'nav.leaderboardConfig',
    icon: Trophy,
    roles: ['operator'],
    section: 'main',
  },
  { to: '/branding', labelKey: 'nav.branding', icon: Share2, roles: ['operator'], section: 'main' },
  { to: '/api-schluessel', labelKey: 'nav.apiKeys', icon: KeyRound, roles: ['operator'], section: 'main' },
  { to: '/webhooks', labelKey: 'nav.webhooks', icon: Webhook, roles: ['operator'], section: 'main' },
  { to: '/einstellungen', labelKey: 'nav.settings', icon: Settings, roles: BOTH, section: 'account' },
];

function NavItemLink({ to, labelKey, icon: Icon }: NavItem) {
  const { t } = useTranslation('common');
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        cn(
          'relative flex items-center gap-[11px] rounded-[9px] px-3 py-[9px] text-[14px] text-paper/70 transition-colors hover:bg-paper/[.06] hover:text-paper',
          isActive && 'bg-porch/[.16] font-medium text-paper',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-[3px] bg-porch" />
          )}
          <Icon aria-hidden className="size-[18px] shrink-0" strokeWidth={1.9} />
          <span>{t(labelKey)}</span>
        </>
      )}
    </NavLink>
  );
}

export function SidebarNav({ role }: { role: AdminRole }) {
  const { t } = useTranslation('common');
  const items = NAV_ITEMS.filter((item) => item.roles.includes(role));
  const main = items.filter((i) => i.section === 'main');
  const account = items.filter((i) => i.section === 'account');
  const sectionLabel = role === 'operator' ? t('nav.sectionOperator') : t('nav.sectionTeamLead');

  // SEC-10/D-15 tenant chrome: a single, always-visible text element near the
  // operator's own account area — the `nav.sectionAccount` header this
  // sidebar already renders. `tenantName` is `null` while loading or when
  // the RPC returns zero rows; the element is simply omitted in that case
  // (never a fabricated or stale name — see `useTenantName`'s own contract).
  const { tenantName } = useTenantName();

  return (
    <div className="flex flex-1 flex-col">
      <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-paper/40">
        {sectionLabel}
      </div>
      <nav aria-label={sectionLabel} className="flex flex-col gap-0.5 px-3">
        {main.map((item) => (
          <NavItemLink key={item.to} {...item} />
        ))}
      </nav>

      {account.length > 0 && (
        <>
          <div className="px-3 pb-1 pt-4 text-[11px] font-medium uppercase tracking-[0.08em] text-paper/40">
            {t('nav.sectionAccount')}
          </div>
          {tenantName ? (
            <div className="px-3 pb-2 text-[11px] text-paper/70">{tenantName}</div>
          ) : null}
          <nav aria-label={t('nav.sectionAccount')} className="flex flex-col gap-0.5 px-3">
            {account.map((item) => (
              <NavItemLink key={item.to} {...item} />
            ))}
          </nav>
        </>
      )}
    </div>
  );
}
