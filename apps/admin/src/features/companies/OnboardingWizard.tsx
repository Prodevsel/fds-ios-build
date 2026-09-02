import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Save } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { BrandingForm } from './BrandingForm';
import type { BrandingFields } from './useBranding';
import {
  type CommissionEntry,
  type Company,
  useCompanyProducts,
  useSaveCommission,
  useSaveOnboarding,
  useSaveWebhook,
} from './useCompanies';

/**
 * Concierge onboarding wizard (ADMN-02) — ported 1:1 from the Claude Design
 * contract (Unternehmen.dc.html): a full-content view (NOT a modal) that takes
 * over the page. The Porch-Light amber step indicator with connecting lines is
 * the focal point; steps are master data → branding → API key → webhook target →
 * commission list. Each "Weiter" persists a draft (onboarding_status='onboarding'
 * + wizard_step), so leaving mid-way and re-clicking an Entwurf company resumes
 * at the saved step; the final step marks the company 'active' and clears
 * wizard_step. All copy from the companies namespace; token-only styling.
 */

const STEP_KEYS = ['master', 'branding', 'apiKey', 'webhook', 'commission'] as const;
type StepKey = (typeof STEP_KEYS)[number];
const TOTAL = STEP_KEYS.length;

interface OnboardingWizardProps {
  company: Company;
  brandingDefaults: BrandingFields;
  onClose: () => void;
  onActivated: (company: Company) => void;
}

export function OnboardingWizard({
  company,
  brandingDefaults,
  onClose,
  onActivated,
}: OnboardingWizardProps) {
  const { t } = useTranslation('companies');
  const saveOnboarding = useSaveOnboarding();
  const saveWebhook = useSaveWebhook();
  const saveCommission = useSaveCommission();

  const [step, setStep] = React.useState(() => Math.min(company.wizard_step ?? 0, TOTAL - 1));
  const [name, setName] = React.useState(company.name ?? '');
  const [nameError, setNameError] = React.useState(false);
  // Master data (0052) — seeded from the company row, persisted via useSaveOnboarding.
  const [legalForm, setLegalForm] = React.useState(company.legal_form ?? '');
  const [hrb, setHrb] = React.useState(company.commercial_register_no ?? '');
  const [contact, setContact] = React.useState(company.contact_name ?? '');
  const [email, setEmail] = React.useState(company.contact_email ?? '');
  const [emailError, setEmailError] = React.useState(false);
  const [targetUrl, setTargetUrl] = React.useState('');
  const [targetUrlError, setTargetUrlError] = React.useState(false);
  const [entries, setEntries] = React.useState<CommissionEntry[]>([]);

  const { data: products } = useCompanyProducts(company.id);

  // Resume at the company's saved wizard_step whenever the target company changes.
  React.useEffect(() => {
    setStep(Math.min(company.wizard_step ?? 0, TOTAL - 1));
    setName(company.name ?? '');
    setLegalForm(company.legal_form ?? '');
    setHrb(company.commercial_register_no ?? '');
    setContact(company.contact_name ?? '');
    setEmail(company.contact_email ?? '');
    setNameError(false);
    setEmailError(false);
    setTargetUrlError(false);
  }, [
    company.wizard_step,
    company.name,
    company.legal_form,
    company.commercial_register_no,
    company.contact_name,
    company.contact_email,
  ]);

  // Same basic shape the 0052 contact_email CHECK enforces — validate before write.
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  const busy = saveOnboarding.isPending || saveWebhook.isPending || saveCommission.isPending;

  async function persistStep(nextStep: number, status: 'onboarding' | 'active') {
    await saveOnboarding.mutateAsync({
      id: company.id,
      name: name.trim() || undefined,
      onboarding_status: status,
      wizard_step: status === 'active' ? null : nextStep,
      legal_form: legalForm.trim() || null,
      commercial_register_no: hrb.trim() || null,
      contact_name: contact.trim() || null,
      contact_email: email.trim() || null,
    });
  }

  async function handleNext() {
    const key: StepKey = STEP_KEYS[step] ?? 'master';
    // Per-step validation + side-effect persistence.
    if (key === 'master') {
      if (!name.trim()) {
        setNameError(true);
        return;
      }
      if (email.trim() && !EMAIL_RE.test(email.trim())) {
        setEmailError(true);
        return;
      }
    }
    if (key === 'webhook' && targetUrl.trim()) {
      if (!/^https:\/\//i.test(targetUrl.trim())) {
        setTargetUrlError(true);
        return;
      }
      await saveWebhook.mutateAsync({ companyId: company.id, targetUrl: targetUrl.trim() });
    }
    if (key === 'commission') {
      await saveCommission.mutateAsync({ companyId: company.id, entries });
      await persistStep(TOTAL, 'active');
      onActivated({
        ...company,
        name: name.trim(),
        onboarding_status: 'active',
        wizard_step: null,
      });
      return;
    }
    const next = step + 1;
    await persistStep(next, 'onboarding');
    setStep(next);
  }

  async function handleSaveDraft() {
    if (!name.trim()) {
      setStep(0);
      setNameError(true);
      return;
    }
    if (email.trim() && !EMAIL_RE.test(email.trim())) {
      setStep(0);
      setEmailError(true);
      return;
    }
    await persistStep(step, 'onboarding');
    onClose();
  }

  function addEntry() {
    setEntries((prev) => [...prev, { product_definition_id: '', rate: null }]);
  }

  const currentKey: StepKey = STEP_KEYS[step] ?? 'master';

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-lg">
      <button
        type="button"
        onClick={onClose}
        className="inline-flex items-center gap-xs self-start text-body text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft aria-hidden className="size-4" />
        {t('wizard.backToList')}
      </button>

      <header className="flex flex-wrap items-end justify-between gap-md">
        <div className="flex flex-col gap-xs">
          <h1 className="font-display text-display text-foreground">{t('cta.create')}</h1>
          <p className="text-body text-muted-foreground">
            {t('wizard.stepOf', { current: step + 1, total: TOTAL })} ·{' '}
            {t(`wizard.steps.${currentKey}`)}
          </p>
        </div>
        <Button variant="outline" onClick={handleSaveDraft} disabled={busy}>
          <Save aria-hidden className="size-4" />
          {t('wizard.saveDraft')}
        </Button>
      </header>

      <Stepper step={step} />

      <div className="rounded-lg border bg-card p-lg shadow-sm">
        <div className="min-h-[10rem]">
          {currentKey === 'master' ? (
            <div className="flex flex-col gap-lg">
              <div className="flex flex-col gap-xs">
                <h2 className="font-display text-heading text-foreground">
                  {t('wizard.master.heading')}
                </h2>
                <p className="text-body text-muted-foreground">{t('wizard.master.body')}</p>
              </div>
              <div className="grid grid-cols-2 gap-[18px]">
                <div className="col-span-2 flex flex-col gap-xs">
                  <Label htmlFor="company-name">{t('wizard.master.nameLabel')}</Label>
                  <Input
                    id="company-name"
                    autoFocus
                    value={name}
                    placeholder={t('wizard.master.namePlaceholder')}
                    onChange={(e) => {
                      setName(e.target.value);
                      setNameError(false);
                    }}
                    aria-invalid={nameError}
                  />
                  {nameError ? (
                    <p role="alert" className="text-label text-destructive">
                      {t('wizard.master.nameRequired')}
                    </p>
                  ) : null}
                </div>
                {/* Rechtsform / Handelsregister-Nr. / Ansprechpartner / E-Mail persist to
                    the 0052 companies master-data columns via useSaveOnboarding. */}
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="company-legal-form">{t('wizard.master.legalFormLabel')}</Label>
                  <select
                    id="company-legal-form"
                    value={legalForm}
                    onChange={(e) => setLegalForm(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-transparent px-md py-sm text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">{t('wizard.master.legalFormPlaceholder')}</option>
                    <option value="GmbH">GmbH</option>
                    <option value="GmbH & Co. KG">GmbH &amp; Co. KG</option>
                    <option value="UG (haftungsbeschränkt)">UG (haftungsbeschränkt)</option>
                    <option value="AG">AG</option>
                    <option value="Einzelunternehmen">Einzelunternehmen</option>
                  </select>
                </div>
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="company-hrb">{t('wizard.master.hrbLabel')}</Label>
                  <Input
                    id="company-hrb"
                    value={hrb}
                    onChange={(e) => setHrb(e.target.value)}
                    className="font-mono"
                    placeholder={t('wizard.master.hrbPlaceholder')}
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="company-contact">{t('wizard.master.contactLabel')}</Label>
                  <Input
                    id="company-contact"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    placeholder={t('wizard.master.contactPlaceholder')}
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <Label htmlFor="company-email">{t('wizard.master.emailLabel')}</Label>
                  <Input
                    id="company-email"
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setEmailError(false);
                    }}
                    aria-invalid={emailError}
                    placeholder={t('wizard.master.emailPlaceholder')}
                  />
                  {emailError ? (
                    <p role="alert" className="text-label text-destructive">
                      {t('wizard.master.emailInvalid')}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {currentKey === 'branding' ? (
            <BrandingForm companyId={company.id} defaults={brandingDefaults} />
          ) : null}

          {currentKey === 'apiKey' ? (
            <div className="flex flex-col gap-sm">
              <h2 className="font-display text-heading text-foreground">
                {t('wizard.apiKey.heading')}
              </h2>
              <p className="text-body text-muted-foreground">{t('wizard.apiKey.body')}</p>
              <div className="flex items-start gap-sm rounded-md border border-porch/25 bg-porch/[0.09] p-md">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-porch" />
                <p className="text-body text-muted-foreground">{t('wizard.apiKey.deferred')}</p>
              </div>
            </div>
          ) : null}

          {currentKey === 'webhook' ? (
            <div className="flex flex-col gap-xs">
              <h2 className="font-display text-heading text-foreground">
                {t('wizard.webhook.heading')}
              </h2>
              <p className="mb-sm text-body text-muted-foreground">{t('wizard.webhook.body')}</p>
              <Label htmlFor="webhook-url">{t('wizard.webhook.targetUrlLabel')}</Label>
              <Input
                id="webhook-url"
                type="url"
                value={targetUrl}
                placeholder={t('wizard.webhook.targetUrlPlaceholder')}
                onChange={(e) => {
                  setTargetUrl(e.target.value);
                  setTargetUrlError(false);
                }}
                aria-invalid={targetUrlError}
                className="font-mono"
              />
              {targetUrlError ? (
                <p role="alert" className="text-label text-destructive">
                  {t('wizard.webhook.targetUrlInvalid')}
                </p>
              ) : null}
            </div>
          ) : null}

          {currentKey === 'commission' ? (
            <div className="flex flex-col gap-sm">
              <h2 className="font-display text-heading text-foreground">
                {t('wizard.commission.heading')}
              </h2>
              <p className="text-body text-muted-foreground">{t('wizard.commission.body')}</p>
              {(products?.length ?? 0) === 0 ? (
                <p className="text-label text-muted-foreground">
                  {t('wizard.commission.noProducts')}
                </p>
              ) : (
                <div className="flex flex-col gap-sm">
                  {entries.map((entry, idx) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: append-only rows, never reordered
                    <div key={idx} className="flex items-end gap-sm">
                      <div className="flex flex-1 flex-col gap-xs">
                        <Label htmlFor={`commission-product-${idx}`}>
                          {t('wizard.commission.productLabel')}
                        </Label>
                        <select
                          id={`commission-product-${idx}`}
                          className="flex h-10 w-full rounded-md border border-input bg-transparent px-md py-sm text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          value={entry.product_definition_id}
                          onChange={(e) =>
                            setEntries((prev) =>
                              prev.map((it, i) =>
                                i === idx ? { ...it, product_definition_id: e.target.value } : it,
                              ),
                            )
                          }
                        >
                          <option value="">—</option>
                          {products?.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.slug} v{p.version}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex w-32 flex-col gap-xs">
                        <Label htmlFor={`commission-rate-${idx}`}>
                          {t('wizard.commission.rateLabel')}
                        </Label>
                        <Input
                          id={`commission-rate-${idx}`}
                          type="number"
                          step="0.01"
                          value={entry.rate ?? ''}
                          onChange={(e) =>
                            setEntries((prev) =>
                              prev.map((it, i) =>
                                i === idx
                                  ? {
                                      ...it,
                                      rate: e.target.value === '' ? null : Number(e.target.value),
                                    }
                                  : it,
                              ),
                            )
                          }
                        />
                      </div>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" onClick={addEntry}>
                    {t('wizard.commission.addRow')}
                  </Button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between gap-sm">
        <Button
          type="button"
          variant="outline"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || busy}
        >
          <ChevronLeft aria-hidden className="size-4" />
          {t('wizard.back')}
        </Button>
        <div className="flex items-center gap-xs">
          {STEP_KEYS.map((key, idx) => (
            <span
              key={key}
              aria-hidden
              className={cn('size-[7px] rounded-full', idx === step ? 'bg-porch' : 'bg-ink/20')}
            />
          ))}
        </div>
        <Button type="button" onClick={handleNext} disabled={busy}>
          {busy ? t('wizard.saving') : step === TOTAL - 1 ? t('wizard.finish') : t('wizard.next')}
          <ChevronRight aria-hidden className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/** Accent step-indicator with connecting lines (the wizard focal point). */
function Stepper({ step }: { step: number }) {
  const { t } = useTranslation('companies');
  return (
    <ol className="flex items-center">
      {STEP_KEYS.map((key, idx) => {
        const done = idx < step;
        const active = idx === step;
        const last = idx === TOTAL - 1;
        return (
          <li key={key} className={cn('flex min-w-0 items-center', last ? 'flex-none' : 'flex-1')}>
            <div className="flex min-w-0 items-center gap-sm">
              <span
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full border-[1.5px] font-mono text-label',
                  active && 'border-porch bg-porch text-paper',
                  done && 'border-ink bg-ink text-paper',
                  !done && !active && 'border-ink/20 bg-card text-muted-foreground',
                )}
              >
                {done ? <Check aria-hidden className="size-4" /> : idx + 1}
              </span>
              <span
                className={cn(
                  'truncate text-label font-medium',
                  active || done ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {t(`wizard.steps.${key}`)}
              </span>
            </div>
            {!last ? (
              <div
                className={cn('mx-sm h-0.5 flex-1 rounded-full', done ? 'bg-ink' : 'bg-ink/15')}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
