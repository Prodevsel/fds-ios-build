import { AppShell } from '@/components/AppShell';
import { ApiKeysPage } from '@/features/api-keys/ApiKeysPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';
import { ResetPasswordRequestPage } from '@/features/auth/ResetPasswordRequestPage';
import { CancellationPage } from '@/features/cancellations/CancellationPage';
import { BrandingPage } from '@/features/companies/BrandingPage';
import { CompaniesPage } from '@/features/companies/CompaniesPage';
import { DealsPage } from '@/features/deals/DealsPage';
import { DirectSignTemplatesPage } from '@/features/direct-sign-templates/DirectSignTemplatesPage';
import { LeaderboardConfigForm } from '@/features/leaderboard/LeaderboardConfigForm';
import { OverviewPage } from '@/features/overview/OverviewPage';
import { ReportingPage } from '@/features/reporting/ReportingPage';
import { RepsPage } from '@/features/reps/RepsPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { TerritoriesPage } from '@/features/territories/TerritoriesPage';
import { WebhooksPage } from '@/features/webhooks/WebhooksPage';
import { RoleGuard } from '@/lib/auth/RoleGuard';
import { Route, Routes } from 'react-router-dom';

/**
 * Root router for apps/admin.
 *
 * `/login` is public; everything else lives behind RoleGuard inside the
 * role-scoped AppShell layout. Later feature plans add their routes as child
 * <Route> entries under the shell — the Übersicht landing is the index.
 */
export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password-request" element={<ResetPasswordRequestPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        element={
          <RoleGuard>
            <AppShell />
          </RoleGuard>
        }
      >
        <Route index element={<OverviewPage />} />
        <Route path="widerruf" element={<CancellationPage />} />
        <Route path="abschluesse" element={<DealsPage />} />
        <Route path="unternehmen" element={<CompaniesPage />} />
        <Route path="direktunterschrift" element={<DirectSignTemplatesPage />} />
        <Route path="api-schluessel" element={<ApiKeysPage />} />
        <Route path="webhooks" element={<WebhooksPage />} />
        <Route path="branding" element={<BrandingPage />} />
        <Route path="mitarbeiter" element={<RepsPage />} />
        <Route path="reporting" element={<ReportingPage />} />
        <Route path="gebiete" element={<TerritoriesPage />} />
        <Route path="leaderboard-konfiguration" element={<LeaderboardConfigForm />} />
        <Route path="einstellungen" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
