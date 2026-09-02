import { EmptyState } from '@/components/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { tokens } from '@/design/tokens';
import { cn } from '@/lib/utils';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Loader,
  Plus,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { OnboardingWizard } from './OnboardingWizard';
import { PartnerTeamsPanel } from './PartnerTeamsPanel';
import { emptyBrandingFields, useBrandingDefault } from './useBranding';
import {
  type Company,
  type OnboardingStatus,
  useCompanies,
  useCreateCompany,
} from './useCompanies';

/**
 * Unternehmen screen (ADMN-02 + WLBL). Ported 1:1 from the Claude Design contract
 * (Unternehmen.dc.html): the companies roster is an Ink-Navy-headed grid table
 * (columns Unternehmen · Onboarding · Fortschritt · Verträge · chevron, exact
 * 2.4/1.3/1.6/0.7fr/40px track) where each 56px row carries an initials avatar,
 * the onboarding_status pill (draft → Entwurf, onboarding → Onboarding, active →
 * Live, with the reserved status colours) and a Porch/Pine progress bar. Clicking
 * an `Entwurf`/`Onboarding` row resumes the concierge wizard AT the saved
 * wizard_step; an active row is inert here. The amber "Unternehmen anlegen" CTA
 * (header + empty-state) creates a draft and opens the wizard, which takes over
 * the whole content area (full view, not a modal — matching the design). Loading
 * skeleton + first-class empty state. All copy from the companies namespace,
 * tokens-only styling.
 */

const TOTAL_STEPS = 5;

/** Design grid track (Unternehmen · Onboarding · Fortschritt · Verträge · chevron). */
const GRID_COLS = 'grid-cols-[2.4fr_1.3fr_1.6fr_0.7fr_40px]';

const STATUS_META: Record<
  OnboardingStatus,
  { variant: 'neutral' | 'invited' | 'active'; icon: LucideIcon }
> = {
  draft: { variant: 'neutral', icon: CircleDashed },
  onboarding: { variant: 'invited', icon: Loader },
  active: { variant: 'active', icon: CheckCircle2 },
};

/** Two-letter initials from the company name (falls back to a dash). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const chars = parts
    .slice(0, 2)
    .map((p) => p.charAt(0))
    .join('');
  return chars.toUpperCase() || '—';
}

/**
 * Deterministic avatar colour from the CVD-validated categorical token palette
 * (tokens.chart.categorical) — real companies carry no stored brand colour, so
 * the swatch is derived from the id, never hardcoded.
 */
function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const palette = tokens.chart.categorical;
  return palette[hash % palette.length] ?? palette[0];
}

/** Current step number (1-based) for the progress column; active = complete. */
function displayStep(company: Company): number {
  if (company.onboarding_status === 'active') {
    return TOTAL_STEPS;
  }
  return Math.min((company.wizard_step ?? 0) + 1, TOTAL_STEPS);
}

export function CompaniesPage() {
  const { t } = useTranslation('companies');
  const { data: companies, isLoading, isError } = useCompanies();
  const { data: brandingDefaults } = useBrandingDefault();
  const createCompany = useCreateCompany();

  const [wizardCompany, setWizardCompany] = React.useState<Company | null>(null);
  // Creation runs through an Edge Function (0057) that can fail (auth, network);
  // surface it inline so the CTA is never a silent no-op again (the original bug).
  const [createFailed, setCreateFailed] = React.useState(false);
  // 0086: the post-onboarding view for an active company — which sales teams
  // may sell it.
  const [partnerCompany, setPartnerCompany] = React.useState<Company | null>(null);

  function handleCreate() {
    setCreateFailed(false);
    createCompany.mutate('', {
      onSuccess: (company) => setWizardCompany(company),
      onError: () => setCreateFailed(true),
    });
  }

  function handleRowClick(company: Company) {
    // Draft/onboarding rows resume the wizard. An ACTIVE row used to be inert —
    // clicking a finished company did nothing at all, so there was nowhere to
    // put anything that comes AFTER onboarding. It now opens the partner-team
    // bindings (0086), which is exactly such a thing.
    if (company.onboarding_status !== 'active') {
      setWizardCompany(company);
      return;
    }
    setPartnerCompany(company);
  }

  const defaults = brandingDefaults ?? emptyBrandingFields();

  if (partnerCompany) {
    return <PartnerTeamsPanel company={partnerCompany} onClose={() => setPartnerCompany(null)} />;
  }

  // The wizard takes over the whole content area (full view, per the design).
  if (wizardCompany) {
    return (
      <OnboardingWizard
        company={wizardCompany}
        brandingDefaults={defaults}
        onClose={() => setWizardCompany(null)}
        onActivated={() => setWizardCompany(null)}
      />
    );
  }

  const isEmpty = !isLoading && !isError && (companies?.length ?? 0) === 0;

  return (
    <div className="mx-auto flex max-w-[1080px] flex-col gap-lg">
      <header className="flex flex-wrap items-end justify-between gap-lg">
        <div className="flex flex-col gap-xs">
          <h1 className="font-display text-display text-foreground">{t('title')}</h1>
          <p className="text-body text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button onClick={handleCreate} disabled={createCompany.isPending}>
          <Plus aria-hidden className="size-4" />
          {t('cta.create')}
        </Button>
      </header>

      {createFailed ? (
        <div
          role="alert"
          className="flex items-start gap-sm rounded-lg border border-destructive/30 bg-destructive/5 p-md"
        >
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="flex min-w-0 flex-col gap-xs">
            <p className="text-body font-medium text-foreground">{t('error.createTitle')}</p>
            <p className="text-label text-muted-foreground">{t('error.createBody')}</p>
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <CompaniesSkeleton />
      ) : isError ? (
        <StateCard heading={t('error.heading')} body={t('error.body')} />
      ) : isEmpty ? (
        <EmptyState
          icon={Building2}
          title={t('empty.heading')}
          description={t('empty.body')}
          action={
            <Button onClick={handleCreate} disabled={createCompany.isPending}>
              <Plus aria-hidden className="size-4" />
              {t('cta.create')}
            </Button>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow
              className={cn(
                'grid items-center bg-transparent px-md hover:bg-transparent',
                GRID_COLS,
              )}
            >
              <TableHead className="px-0 text-paper/85 tracking-[0.02em]">
                {t('table.name')}
              </TableHead>
              <TableHead className="px-0 text-paper/85 tracking-[0.02em]">
                {t('table.status')}
              </TableHead>
              <TableHead className="px-0 text-paper/85 tracking-[0.02em]">
                {t('table.progress')}
              </TableHead>
              <TableHead className="px-0 text-right text-paper/85 tracking-[0.02em]">
                {t('table.contracts')}
              </TableHead>
              <TableHead className="px-0" aria-hidden />
            </TableRow>
          </TableHeader>
          <TableBody className="divide-ink/[0.06]">
            {companies?.map((company) => {
              const resumable = company.onboarding_status !== 'active';
              const step = displayStep(company);
              return (
                <TableRow
                  key={company.id}
                  className={cn(
                    'grid h-14 items-center px-md',
                    resumable && 'cursor-pointer hover:bg-porch/5',
                    GRID_COLS,
                  )}
                  onClick={resumable ? () => handleRowClick(company) : undefined}
                >
                  <TableCell className="flex min-w-0 items-center gap-sm px-0 py-0">
                    <div
                      aria-hidden
                      className="flex size-[34px] shrink-0 items-center justify-center rounded-lg font-display text-body font-medium text-paper"
                      style={{ backgroundColor: avatarColor(company.id) }}
                    >
                      {initials(company.name || '')}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-body font-medium text-foreground">
                        {company.name || t('unnamed')}
                      </div>
                      <div className="truncate font-mono text-[11px] leading-none text-muted-foreground">
                        {company.id}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="px-0 py-0">
                    <StatusBadge status={company.onboarding_status} />
                  </TableCell>
                  <TableCell className="px-0 py-0 pr-lg">
                    <div className="flex items-center gap-sm">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/[0.08]">
                        <div
                          className={cn(
                            'h-full rounded-full',
                            company.onboarding_status === 'active' ? 'bg-pine' : 'bg-porch',
                          )}
                          style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
                        />
                      </div>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {step}/{TOTAL_STEPS}
                      </span>
                    </div>
                  </TableCell>
                  {/* Verträge: closed-set signed-contract count from companies_admin_list
                      (0054/0053) — testers + received-Widerruf excluded. */}
                  <TableCell className="px-0 py-0 text-right text-body font-medium tabular-nums text-foreground">
                    {company.signed_contract_count.toLocaleString('de-DE')}
                  </TableCell>
                  <TableCell className="flex justify-end px-0 py-0 text-muted-foreground/60">
                    {resumable ? <ChevronRight aria-hidden className="size-4" /> : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: OnboardingStatus }) {
  const { t } = useTranslation('companies');
  const { variant, icon: Icon } = STATUS_META[status];
  return (
    <Badge variant={variant}>
      <Icon aria-hidden className="size-3.5" />
      {t(`status.${status}`)}
    </Badge>
  );
}

function StateCard({ heading, body }: { heading: string; body: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-sm p-xl text-center">
        <p className="font-display text-heading text-foreground">{heading}</p>
        <p className="text-body text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}

/** Table-shaped loading skeleton: Ink-Navy header bar + shimmering rows. */
function CompaniesSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="h-11 bg-ink" />
      {[0, 1, 2, 3, 4].map((row) => (
        <div key={row} className="flex items-center gap-md border-t px-md py-sm">
          <div className="size-[34px] shrink-0 animate-pulse rounded-lg bg-muted" />
          <div className="h-3 w-48 animate-pulse rounded bg-muted" />
          <div className="ml-auto h-3 w-24 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
