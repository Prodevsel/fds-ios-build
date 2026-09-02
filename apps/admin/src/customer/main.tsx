import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { OfferPage } from './OfferPage';

/**
 * Entry point of the CUSTOMER bundle — the second, separate Vite entry
 * (`angebot.html`), not the admin dashboard.
 *
 * There is deliberately nothing here but a root and one component:
 * no QueryClientProvider, no BrowserRouter, no i18next, no `@/lib/supabase`,
 * no design-system import. A customer opening a link from an email must not
 * download a sales dashboard, and scripts/ci/customer-bundle-isolation.mjs
 * fails the build if anything reachable from this file ever changes that.
 */
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <OfferPage />
    </StrictMode>,
  );
}
