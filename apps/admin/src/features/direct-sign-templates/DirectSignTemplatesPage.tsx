import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { type Company, useCompanies } from '@/features/companies/useCompanies';
import { PLATFORM_DEFAULT_BELEHRUNG_TEXT } from '@frontdoorsales/flow-schema';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileText, Upload } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { PlacementStep } from './PlacementStep';
import { UploadTemplateDialog } from './UploadTemplateDialog';
import { publishDirectSignProduct } from './publishDirectSignProduct';
import {
  DIRECT_SIGN_TEMPLATES_QUERY_KEY,
  type DirectSignTemplate,
  type DirectSignTemplateStatus,
  useDirectSignTemplates,
  useQuestionSourceProducts,
} from './useDirectSignTemplates';

/**
 * Direct-sign templates screen (DSGN-01/02). The concierge admin flow:
 * (1) upload a finished contract PDF into the per-tenant bucket + create a
 * draft template row (this page + UploadTemplateDialog), (2) set the
 * signature anchor visually (PlacementStep, Task 3), (3) set the
 * Widerrufsbelehrung text and publish as a `direct_pdf` product
 * (publishDirectSignProduct, Task 4). Reuses the RepsPage list shell + the
 * BrandingPage company-selector pattern (Phase-5 shadcn admin design system).
 */
const STATUS_META: Record<DirectSignTemplateStatus, { variant: 'active' | 'invited'; icon: LucideIcon }> = {
  draft: { variant: 'invited', icon: FileText },
  published: { variant: 'active', icon: CheckCircle2 },
};

/** Notice-text max length (T-05-33), mirrors BrandingForm's belehrung_text bound. */
const NOTICE_MAX_LEN = 20000;
/** Product slug max length — generous, well under the text column's practical bound. */
const SLUG_MAX_LEN = 200;

/**
 * Strip C0/C1 control chars (keep \n, \t) and clamp to max length — the same
 * write-boundary sanitization BrandingForm.tsx applies to belehrung_text
 * (T-05-33 -> T-05-23), reused here so a malformed notice/slug can never
 * reach the flow-schema SSOT validator or Postgres.
 */
function sanitizeText(value: string, max: number): string {
  let cleaned = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    const isControl = code < 32 && code !== 9 && code !== 10 && code !== 13;
    if (!isControl && code !== 127) {
      cleaned += ch;
    }
  }
  return cleaned.slice(0, max);
}

export function DirectSignTemplatesPage() {
  const { t } = useTranslation('direct-sign-templates');
  const { data: companies } = useCompanies();

  const [companyId, setCompanyId] = React.useState<string>('');
  const { data: templates, isLoading, isError } = useDirectSignTemplates(companyId || null);

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string | null>(null);

  function handleUploaded(template: DirectSignTemplate) {
    setToast(t('toast.uploaded'));
    setSelectedTemplateId(template.id);
  }

  const selectedTemplate = templates?.find((tpl) => tpl.id === selectedTemplateId) ?? null;

  return (
    <div className="flex flex-col gap-xl">
      <header className="flex flex-wrap items-start justify-between gap-md">
        <div className="flex flex-col gap-xs">
          <h1 className="font-display text-display text-foreground">{t('title')}</h1>
          <p className="text-body text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button onClick={() => setDialogOpen(true)} disabled={!companyId}>
          <Upload aria-hidden className="size-4" />
          {t('upload.cta')}
        </Button>
      </header>

      <div className="flex items-center gap-sm">
        <label
          htmlFor="direct-sign-company"
          className="text-label font-medium uppercase tracking-[0.02em] text-muted-foreground"
        >
          {t('company.label')}
        </label>
        <select
          id="direct-sign-company"
          className="h-10 rounded-md border border-input bg-transparent px-md text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
        >
          <option value="">{t('company.placeholder')}</option>
          {companies?.map((c: Company) => (
            <option key={c.id} value={c.id}>
              {c.name || c.id}
            </option>
          ))}
        </select>
      </div>

      {!companyId ? (
        <StateCard heading={t('noCompany.heading')} body={t('noCompany.body')} />
      ) : isLoading ? (
        <TemplatesSkeleton />
      ) : isError ? (
        <StateCard heading={t('error.heading')} body={t('error.body')} />
      ) : (templates?.length ?? 0) === 0 ? (
        <StateCard heading={t('empty.heading')} body={t('empty.body')} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-transparent hover:bg-transparent">
              <TableHead className="text-paper">{t('table.file')}</TableHead>
              <TableHead className="text-paper">{t('table.status')}</TableHead>
              <TableHead className="text-paper">{t('table.uploaded')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates?.map((template) => (
              <TableRow
                key={template.id}
                onClick={() => setSelectedTemplateId(template.id)}
                aria-selected={template.id === selectedTemplateId}
                className="cursor-pointer"
              >
                <TableCell className="font-mono text-body text-foreground">
                  {template.storagePath.split('/').pop()}
                </TableCell>
                <TableCell>
                  <StatusBadge status={template.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(template.createdAt).toLocaleDateString('de-DE')}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {selectedTemplate && companyId ? (
        <TemplateDetailPanel
          template={selectedTemplate}
          companyId={companyId}
          onPlacementSaved={() => setToast(t('toast.placementSaved'))}
          onPublished={() => {
            setToast(t('toast.published'));
            setSelectedTemplateId(null);
          }}
        />
      ) : null}

      <UploadTemplateDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        companyId={companyId || null}
        onUploaded={handleUploaded}
      />

      {toast ? <Toast message={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

/**
 * Detail panel for a selected draft template: placement (Task 3) then, once
 * a signature anchor exists, the notice-text + publish step (Task 4). A
 * published template only shows a read-only summary — 0066's immutability
 * trigger rejects any further UPDATE once status='published'.
 */
function TemplateDetailPanel({
  template,
  companyId,
  onPlacementSaved,
  onPublished,
}: {
  template: DirectSignTemplate;
  companyId: string;
  onPlacementSaved: () => void;
  onPublished: () => void;
}) {
  const { t } = useTranslation('direct-sign-templates');
  const queryClient = useQueryClient();

  const [slug, setSlug] = React.useState('');
  const [version, setVersion] = React.useState(1);
  const [noticeText, setNoticeText] = React.useState(PLATFORM_DEFAULT_BELEHRUNG_TEXT);
  // 0085: which published product's questions this PDF flow adopts. Chosen
  // BEFORE placement, because the placement step lists exactly these blocks.
  const { data: questionSources } = useQuestionSourceProducts(companyId);
  const [sourceProductId, setSourceProductId] = React.useState('');
  const questionBlocks =
    questionSources?.find((p) => p.id === sourceProductId)?.blocks ?? [];
  const [publishing, setPublishing] = React.useState(false);
  const [publishError, setPublishError] = React.useState<string | null>(null);

  const hasPlacement = template.signaturePage !== null && template.signatureXFrac !== null && template.signatureYFrac !== null;

  function invalidateTemplates() {
    void queryClient.invalidateQueries({ queryKey: [...DIRECT_SIGN_TEMPLATES_QUERY_KEY, companyId] });
  }

  async function handlePublish(e: React.FormEvent) {
    e.preventDefault();
    setPublishError(null);
    if (!hasPlacement) {
      setPublishError(t('publish.missingPlacement'));
      return;
    }
    setPublishing(true);
    try {
      await publishDirectSignProduct({
        companyId,
        templateId: template.id,
        slug: slug.trim(),
        version,
        noticeText: noticeText.trim(),
        questionBlocks,
      });
      invalidateTemplates();
      onPublished();
    } catch {
      setPublishError(t('publish.errors.generic'));
    } finally {
      setPublishing(false);
    }
  }

  if (template.status === 'published') {
    return (
      <Card>
        <CardContent className="flex flex-col gap-sm p-lg">
          <p className="font-display text-heading text-foreground">{t('status.published')}</p>
          <p className="text-body text-muted-foreground">{template.storagePath}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-lg">
      {questionSources && questionSources.length > 0 ? (
        <div className="flex flex-col gap-xs rounded-lg border border-input p-md">
          <Label htmlFor="publish-questions">{t('publish.questionsLabel')}</Label>
          <p className="text-label text-muted-foreground">{t('publish.questionsHint')}</p>
          <select
            id="publish-questions"
            className="h-10 rounded-md border border-input bg-transparent px-md text-body"
            value={sourceProductId}
            onChange={(e) => setSourceProductId(e.target.value)}
          >
            <option value="">{t('publish.questionsNone')}</option>
            {questionSources.map((p) => (
              <option key={p.id} value={p.id}>
                {p.slug} (v{p.version}) — {p.blocks.length}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <PlacementStep
        templateId={template.id}
        companyId={companyId}
        storagePath={template.storagePath}
        questionBlocks={questionBlocks}
        fieldPlacements={template.fieldPlacements}
        onSaved={() => {
          invalidateTemplates();
          onPlacementSaved();
        }}
      />

      <form className="flex flex-col gap-md rounded-lg border border-input p-md" onSubmit={handlePublish}>
        <div className="flex flex-col gap-xs">
          <h3 className="font-display text-heading text-foreground">{t('publish.heading')}</h3>
          <p className="text-body text-muted-foreground">{t('publish.body')}</p>
        </div>

        <div className="grid grid-cols-2 gap-md">
          <div className="flex flex-col gap-xs">
            <Label htmlFor="publish-slug">{t('publish.slugLabel')}</Label>
            <input
              id="publish-slug"
              value={slug}
              placeholder={t('publish.slugPlaceholder')}
              onChange={(e) => setSlug(sanitizeText(e.target.value, SLUG_MAX_LEN))}
              className="h-10 rounded-md border border-input bg-transparent px-md text-body"
            />
          </div>
          <div className="flex flex-col gap-xs">
            <Label htmlFor="publish-version">{t('publish.versionLabel')}</Label>
            <input
              id="publish-version"
              type="number"
              min={1}
              value={version}
              onChange={(e) => setVersion(Math.max(1, Number(e.target.value) || 1))}
              className="h-10 rounded-md border border-input bg-transparent px-md text-body"
            />
          </div>
        </div>

        <div className="flex flex-col gap-xs">
          <Label htmlFor="publish-notice">{t('publish.noticeLabel')}</Label>
          <p className="text-label text-muted-foreground">{t('publish.noticeHint')}</p>
          <textarea
            id="publish-notice"
            value={noticeText}
            onChange={(e) => setNoticeText(sanitizeText(e.target.value, NOTICE_MAX_LEN))}
            rows={6}
            maxLength={NOTICE_MAX_LEN}
            className="flex w-full rounded-md border border-input bg-transparent px-md py-sm text-body"
          />
        </div>

        {publishError ? (
          <p role="alert" className="text-body text-destructive">
            {publishError}
          </p>
        ) : null}

        <div className="flex justify-end">
          <Button type="submit" disabled={publishing || !slug.trim() || !hasPlacement}>
            {publishing ? t('publish.submitting') : t('publish.submit')}
          </Button>
        </div>
      </form>
    </div>
  );
}

function StatusBadge({ status }: { status: DirectSignTemplateStatus }) {
  const { t } = useTranslation('direct-sign-templates');
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

function TemplatesSkeleton() {
  return (
    <div className="flex flex-col gap-sm">
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  React.useEffect(() => {
    const id = setTimeout(onDismiss, 4000);
    return () => clearTimeout(id);
  }, [onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-lg right-lg z-50 flex items-start gap-sm rounded-lg border border-pine/30 bg-card p-md shadow-lg"
    >
      <CheckCircle2 aria-hidden className="mt-0.5 size-4 text-pine" />
      <p className="text-body font-medium text-foreground">{message}</p>
    </div>
  );
}
