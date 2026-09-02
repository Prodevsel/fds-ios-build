import { CodeChip } from '@/components/CodeChip';
import { EmptyState } from '@/components/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
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
import { useCompanies } from '@/features/companies/useCompanies';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronDown,
  KeyRound,
  type LucideIcon,
  Plus,
  Trash2,
  XCircle,
} from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { RevealKeyDialog } from './RevealKeyDialog';
import {
  type ApiKey,
  type OperatorApiKey,
  useApiKeys,
  useDeactivateApiKey,
  useOperatorApiKeyStats,
  useOperatorApiKeys,
} from './useApiKeys';

/**
 * API-Schlüssel screen (API-01 + 3.1). Pick a single company to see + manage its
 * keys as masked `sk_••••1a2f` CodeChips (never a plaintext key — the plaintext
 * only ever exists once, at issuance, in RevealKeyDialog), or pick "Alle
 * Unternehmen" for the operator cross-company view: three stat cards
 * (Aktiv/Abgedeckt/Gesperrt) + a list with an Unternehmen column, all from the
 * operator_api_keys / operator_api_key_stats views (0056, key_prefix + status
 * only). Creation is reveal-once and stays PER-COMPANY (disabled in operator
 * mode). "Deaktivieren" is a destructive confirm (status → revoked, never a
 * delete). All copy from the api-keys namespace, tokens-only.
 */
const MAX_ACTIVE = 2;
/** Sentinel selector value for the operator cross-company mode. */
const ALL = '__all__';

/** A pending revoke: the key id + the company it belongs to (for the mutation). */
interface DeactivationTarget {
  keyId: string;
  companyId: string;
}

export function ApiKeysPage() {
  const { t } = useTranslation('api-keys');
  const { data: companies } = useCompanies();
  const [companyId, setCompanyId] = React.useState<string>('');
  const isOperator = companyId === ALL;
  const { data: keys, isLoading, isError } = useApiKeys(isOperator ? null : companyId || null);
  const operatorKeysQ = useOperatorApiKeys(isOperator);
  const operatorStatsQ = useOperatorApiKeyStats(isOperator);

  const [revealOpen, setRevealOpen] = React.useState(false);
  const [toDeactivate, setToDeactivate] = React.useState<DeactivationTarget | null>(null);
  const deactivate = useDeactivateApiKey();

  const activeCount = (keys ?? []).filter((k) => k.status === 'active').length;
  const atMax = activeCount >= MAX_ACTIVE;
  const canCreate = Boolean(companyId) && !isOperator;

  const createButton = (
    <Button
      onClick={() => setRevealOpen(true)}
      disabled={!canCreate || atMax}
      title={isOperator ? t('createNeedsCompany') : atMax ? t('maxTooltip') : undefined}
    >
      <Plus aria-hidden className="size-4" />
      {t('cta.create')}
    </Button>
  );

  function confirmDeactivate() {
    if (!toDeactivate) return;
    deactivate.mutate(
      { companyId: toDeactivate.companyId, keyId: toDeactivate.keyId },
      { onSuccess: () => setToDeactivate(null) },
    );
  }

  return (
    <div className="flex flex-col gap-xl">
      <header className="flex flex-wrap items-end justify-between gap-md">
        <div className="flex flex-col gap-xs">
          <h1 className="font-display text-display text-foreground">{t('title')}</h1>
          <p className="text-body text-muted-foreground">{t('subtitle')}</p>
        </div>
        {createButton}
      </header>

      <div className="flex max-w-md flex-col gap-sm">
        <Label htmlFor="company-select">{t('company.label')}</Label>
        <div className="relative">
          <select
            id="company-select"
            className="flex h-11 w-full appearance-none rounded-[9px] border border-ink/[.16] bg-card px-[13px] pr-10 text-body text-foreground shadow-sm transition-colors focus-visible:border-porch focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-porch/20"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
          >
            <option value="">{t('company.placeholder')}</option>
            <option value={ALL}>{t('company.all')}</option>
            {companies?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || c.id}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden
            className="pointer-events-none absolute right-[13px] top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
        </div>
      </div>

      {!companyId ? (
        <EmptyState
          icon={Building2}
          title={t('selectPrompt.heading')}
          description={t('selectPrompt.body')}
        />
      ) : isOperator ? (
        <OperatorKeysView
          keys={operatorKeysQ.data}
          stats={operatorStatsQ.data}
          isLoading={operatorKeysQ.isLoading}
          isError={operatorKeysQ.isError}
          onDeactivate={(k) => setToDeactivate({ keyId: k.id, companyId: k.company_id })}
        />
      ) : isLoading ? (
        <KeysSkeleton />
      ) : isError ? (
        <StateCard
          icon={AlertTriangle}
          tone="brick"
          heading={t('error.heading')}
          body={t('error.body')}
        />
      ) : (keys?.length ?? 0) === 0 ? (
        <EmptyState
          icon={KeyRound}
          title={t('empty.heading')}
          description={t('empty.body')}
          action={createButton}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-transparent hover:bg-transparent">
              <TableHead className="text-paper">{t('table.key')}</TableHead>
              <TableHead className="text-paper">{t('table.label')}</TableHead>
              <TableHead className="text-paper">{t('table.created')}</TableHead>
              <TableHead className="text-paper">{t('table.status')}</TableHead>
              <TableHead className="text-paper text-right">{t('table.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys?.map((key) => (
              <TableRow
                key={key.id}
                className={key.status === 'revoked' ? 'opacity-60' : undefined}
              >
                <TableCell>
                  <CodeChip>{t('masked', { prefix: key.key_prefix })}</CodeChip>
                </TableCell>
                <TableCell className="text-foreground">
                  {key.label || <span className="text-muted-foreground">{t('noLabel')}</span>}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(key.created_at)}
                </TableCell>
                <TableCell>
                  <StatusBadge status={key.status} />
                </TableCell>
                <TableCell className="text-right">
                  {key.status === 'active' ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto size-8 text-brick hover:bg-brick/10 hover:text-brick"
                      aria-label={t('deactivate.action')}
                      title={t('deactivate.action')}
                      onClick={() => setToDeactivate({ keyId: key.id, companyId })}
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </Button>
                  ) : (
                    <span className="text-label text-muted-foreground">{t('status.revoked')}</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {canCreate ? (
        <RevealKeyDialog
          open={revealOpen}
          companyId={companyId}
          onClose={() => setRevealOpen(false)}
        />
      ) : null}

      <Dialog
        open={toDeactivate !== null}
        onClose={() => setToDeactivate(null)}
        title={t('deactivate.confirmTitle')}
        description={t('deactivate.confirmBody')}
        closeLabel={t('deactivate.close')}
      >
        <div className="flex justify-end gap-sm">
          <Button
            type="button"
            variant="outline"
            onClick={() => setToDeactivate(null)}
            disabled={deactivate.isPending}
          >
            {t('deactivate.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={confirmDeactivate}
            disabled={deactivate.isPending}
          >
            {t('deactivate.confirm')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

/** Operator cross-company view: stat cards + a keys list with an Unternehmen column. */
function OperatorKeysView({
  keys,
  stats,
  isLoading,
  isError,
  onDeactivate,
}: {
  keys: OperatorApiKey[] | undefined;
  stats: { activeCount: number; companiesCovered: number; revokedCount: number } | undefined;
  isLoading: boolean;
  isError: boolean;
  onDeactivate: (key: OperatorApiKey) => void;
}) {
  const { t } = useTranslation('api-keys');

  if (isLoading) {
    return <KeysSkeleton />;
  }
  if (isError) {
    return (
      <StateCard
        icon={AlertTriangle}
        tone="brick"
        heading={t('error.heading')}
        body={t('error.body')}
      />
    );
  }

  const rows = keys ?? [];
  const cards = [
    { label: t('operator.stats.active'), value: stats?.activeCount ?? 0 },
    { label: t('operator.stats.covered'), value: stats?.companiesCovered ?? 0 },
    { label: t('operator.stats.revoked'), value: stats?.revokedCount ?? 0 },
  ];

  return (
    <div className="flex flex-col gap-xl">
      <div className="grid grid-cols-3 gap-md">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-[12px] border border-ink/10 bg-card px-[18px] py-md"
          >
            <div className="mb-sm text-[11px] font-medium uppercase tracking-[.02em] text-muted-foreground">
              {c.label}
            </div>
            <div className="font-display text-[26px] leading-[28px] tabular-nums text-ink">
              {c.value.toLocaleString('de-DE')}
            </div>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title={t('operator.empty.heading')}
          description={t('operator.empty.body')}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-transparent hover:bg-transparent">
              <TableHead className="text-paper">{t('operator.company')}</TableHead>
              <TableHead className="text-paper">{t('table.key')}</TableHead>
              <TableHead className="text-paper">{t('table.label')}</TableHead>
              <TableHead className="text-paper">{t('table.created')}</TableHead>
              <TableHead className="text-paper">{t('table.status')}</TableHead>
              <TableHead className="text-paper text-right">{t('table.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((key) => (
              <TableRow key={key.id} className={key.status === 'revoked' ? 'opacity-60' : undefined}>
                <TableCell className="font-medium text-foreground">
                  {key.company_name ?? key.company_id}
                </TableCell>
                <TableCell>
                  <CodeChip>{t('masked', { prefix: key.key_prefix })}</CodeChip>
                </TableCell>
                <TableCell className="text-foreground">
                  {key.label || <span className="text-muted-foreground">{t('noLabel')}</span>}
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDate(key.created_at)}</TableCell>
                <TableCell>
                  <StatusBadge status={key.status} />
                </TableCell>
                <TableCell className="text-right">
                  {key.status === 'active' ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto size-8 text-brick hover:bg-brick/10 hover:text-brick"
                      aria-label={t('deactivate.action')}
                      title={t('deactivate.action')}
                      onClick={() => onDeactivate(key)}
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </Button>
                  ) : (
                    <span className="text-label text-muted-foreground">{t('status.revoked')}</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ApiKey['status'] }) {
  const { t } = useTranslation('api-keys');
  const active = status === 'active';
  return (
    <Badge variant={active ? 'active' : 'removed'}>
      {active ? (
        <CheckCircle2 aria-hidden className="size-3.5" />
      ) : (
        <XCircle aria-hidden className="size-3.5" />
      )}
      {t(`status.${status}`)}
    </Badge>
  );
}

function StateCard({
  icon: Icon,
  heading,
  body,
  action,
  tone = 'porch',
}: {
  icon: LucideIcon;
  heading: string;
  body: string;
  action?: React.ReactNode;
  tone?: 'porch' | 'brick';
}) {
  return (
    <div className="rounded-[12px] border border-ink/10 bg-card px-[24px] py-[48px]">
      <div className="mx-auto flex max-w-[380px] flex-col items-center gap-md text-center">
        <span
          className={
            tone === 'brick'
              ? 'flex size-12 items-center justify-center rounded-full bg-brick/10 text-brick'
              : 'flex size-12 items-center justify-center rounded-full bg-porch/10 text-porch'
          }
        >
          <Icon aria-hidden className="size-6" />
        </span>
        <p className="font-display text-heading text-ink">{heading}</p>
        <p className="text-body text-[#5C6B85]">{body}</p>
        {action}
      </div>
    </div>
  );
}

/** Company-locale short date for the "Erstellt" column. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('de-DE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function KeysSkeleton() {
  return (
    <div className="flex flex-col gap-sm">
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}
