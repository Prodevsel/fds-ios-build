import { CodeChip } from '@/components/CodeChip';
import { EmptyState } from '@/components/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCompanies } from '@/features/companies/useCompanies';
import { AlertTriangle, CheckCircle2, ChevronDown, Inbox, Webhook, XCircle } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { EventLogTable, StatusBadge } from './EventLogTable';
import {
  type OperatorWebhookEvent,
  useOperatorWebhookEndpoints,
  useOperatorWebhookEvents,
  useRedeliver,
  useSaveWebhookConfig,
  useTestPing,
  useWebhookConfig,
} from './useWebhooks';

/**
 * Webhooks screen (API-02). Pick a company, then two tabs:
 *  - Konfiguration: HTTPS target URL + the per-company HMAC secret shown ONCE on
 *    creation (Mono CodeChip) + a test-ping with inline success/fail.
 *  - Event-Log: the observable outbox (EventLogTable) with the payload drawer,
 *    dead-letter retry ladder, and dead_letter-scoped redelivery.
 * All copy from the webhooks namespace, tokens-only; errors leak no internals (V7).
 */
/** Sentinel selector value for the operator cross-company mode. */
const ALL = '__all__';

export function WebhooksPage() {
  const { t } = useTranslation('webhooks');
  const { data: companies } = useCompanies();
  const [companyId, setCompanyId] = React.useState<string>('');
  const [tab, setTab] = React.useState<'config' | 'eventLog'>('config');
  const [operatorTab, setOperatorTab] = React.useState<'endpoints' | 'eventLog'>('endpoints');
  const isOperator = companyId === ALL;
  const companyName = companies?.find((c) => c.id === companyId)?.name || companyId;

  return (
    <div className="flex flex-col gap-xl">
      <header className="flex flex-col gap-xs">
        <h1 className="font-display text-display text-foreground">{t('title')}</h1>
        <p className="text-body text-muted-foreground">{t('subtitle')}</p>
      </header>

      <div className="flex max-w-md flex-col gap-xs">
        <Label htmlFor="webhook-company-select">{t('company.label')}</Label>
        <div className="relative">
          <select
            id="webhook-company-select"
            className="flex h-[42px] w-full appearance-none rounded-lg border border-ink/10 bg-card pl-md pr-[38px] text-body text-foreground focus-visible:border-porch focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-porch/20"
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
            className="pointer-events-none absolute right-md top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
        </div>
      </div>

      {!companyId ? (
        <EmptyState
          icon={Webhook}
          title={t('selectPrompt.heading')}
          description={t('selectPrompt.body')}
        />
      ) : isOperator ? (
        <Tabs
          value={operatorTab}
          onValueChange={(v) => setOperatorTab(v as 'endpoints' | 'eventLog')}
        >
          <TabsList label={t('tabs.ariaLabel')}>
            <TabsTrigger value="endpoints">{t('tabs.endpoints')}</TabsTrigger>
            <TabsTrigger value="eventLog">{t('tabs.eventLog')}</TabsTrigger>
          </TabsList>
          <TabsContent value="endpoints">
            <OperatorEndpointsTable />
          </TabsContent>
          <TabsContent value="eventLog">
            <OperatorEventLog />
          </TabsContent>
        </Tabs>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'config' | 'eventLog')}>
          <TabsList label={t('tabs.ariaLabel')}>
            <TabsTrigger value="config">{t('tabs.config')}</TabsTrigger>
            <TabsTrigger value="eventLog">{t('tabs.eventLog')}</TabsTrigger>
          </TabsList>
          <TabsContent value="config">
            <ConfigTab companyId={companyId} />
          </TabsContent>
          <TabsContent value="eventLog">
            <EventLogTable companyId={companyId} companyName={companyName} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

const HTTPS_RE = /^https:\/\/.+/i;

function ConfigTab({ companyId }: { companyId: string }) {
  const { t } = useTranslation('webhooks');
  const { data: config } = useWebhookConfig(companyId);
  const save = useSaveWebhookConfig();
  const testPing = useTestPing();

  const [url, setUrl] = React.useState('');
  const [urlError, setUrlError] = React.useState(false);
  const [revealedSecret, setRevealedSecret] = React.useState<string | null>(null);
  const [pingResult, setPingResult] = React.useState<'success' | 'fail' | null>(null);

  React.useEffect(() => {
    setUrl(config?.target_url ?? '');
  }, [config?.target_url]);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setUrlError(false);
    setRevealedSecret(null);
    if (!HTTPS_RE.test(url.trim())) {
      setUrlError(true);
      return;
    }
    save.mutate(
      { companyId, targetUrl: url.trim() },
      { onSuccess: ({ secret }) => setRevealedSecret(secret) },
    );
  }

  function handleTestPing() {
    setPingResult(null);
    testPing.mutate(url.trim(), {
      onSuccess: () => setPingResult('success'),
      onError: () => setPingResult('fail'),
    });
  }

  const notConfigured = !config?.target_url;

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{t('config.cardTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        {notConfigured ? (
          <div className="mb-lg flex items-start gap-sm rounded-md border border-porch/30 bg-porch/10 p-md">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-porch" />
            <div className="flex flex-col gap-xs">
              <p className="text-body font-medium text-foreground">{t('config.empty.heading')}</p>
              <p className="text-label text-muted-foreground">{t('config.empty.body')}</p>
            </div>
          </div>
        ) : null}
        <form className="flex flex-col gap-lg" onSubmit={handleSave}>
          <div className="flex flex-col gap-xs">
            <Label htmlFor="target-url">{t('config.targetLabel')}</Label>
            <Input
              id="target-url"
              type="url"
              inputMode="url"
              placeholder={t('config.targetPlaceholder')}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-invalid={urlError}
            />
            <p className="text-label text-muted-foreground">{t('config.targetHint')}</p>
            {urlError ? (
              <p role="alert" className="text-body text-destructive">
                {t('config.invalidUrl')}
              </p>
            ) : null}
          </div>

          {revealedSecret ? (
            <div className="flex flex-col gap-sm rounded-md border border-porch/30 bg-porch/10 p-md">
              <div className="flex items-start gap-sm">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-porch" />
                <p className="text-body text-foreground">{t('config.secretWarning')}</p>
              </div>
              <div className="flex flex-col gap-xs">
                <span className="text-label font-medium uppercase tracking-wide text-muted-foreground">
                  {t('config.secretLabel')}
                </span>
                <CodeChip className="w-fit break-all">{revealedSecret}</CodeChip>
              </div>
            </div>
          ) : null}

          {pingResult === 'success' ? (
            <output className="flex items-center gap-xs text-body text-pine">
              <CheckCircle2 aria-hidden className="size-4" />
              {t('config.testSuccess')}
            </output>
          ) : pingResult === 'fail' ? (
            <output className="flex items-center gap-xs text-body text-destructive">
              <XCircle aria-hidden className="size-4" />
              {t('config.testFail')}
            </output>
          ) : null}

          <div className="flex gap-sm">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? t('config.saving') : t('config.save')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleTestPing}
              disabled={testPing.isPending || !url.trim()}
            >
              {testPing.isPending ? t('config.testing') : t('config.testPing')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** Operator cross-company Endpoints table + delivery rollup (3.2, 0056). */
function OperatorEndpointsTable() {
  const { t } = useTranslation('webhooks');
  const { data, isLoading, isError } = useOperatorWebhookEndpoints(true);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-sm">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  if (isError) {
    return <StateCard heading={t('error.heading')} body={t('error.body')} />;
  }
  const rows = data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Webhook}
        title={t('operator.endpoints.empty.heading')}
        description={t('operator.endpoints.empty.body')}
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-[12px] border border-ink/10 bg-card">
      <Table>
        <TableHeader>
          <TableRow className="border-0 bg-ink hover:bg-ink">
            <TableHead className="text-[12px] uppercase tracking-[.02em] text-paper/85">
              {t('operator.endpoints.company')}
            </TableHead>
            <TableHead className="text-[12px] uppercase tracking-[.02em] text-paper/85">
              {t('operator.endpoints.targetUrl')}
            </TableHead>
            <TableHead className="text-[12px] uppercase tracking-[.02em] text-paper/85">
              {t('operator.endpoints.status')}
            </TableHead>
            <TableHead className="text-right text-[12px] uppercase tracking-[.02em] text-paper/85">
              {t('stats.delivered')}
            </TableHead>
            <TableHead className="text-right text-[12px] uppercase tracking-[.02em] text-paper/85">
              {t('stats.pending')}
            </TableHead>
            <TableHead className="text-right text-[12px] uppercase tracking-[.02em] text-paper/85">
              {t('stats.deadLetter')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.company_id}>
              <TableCell className="font-medium text-foreground">
                {row.company_name ?? row.company_id}
              </TableCell>
              <TableCell className="max-w-[280px]">
                <CodeChip className="truncate">{row.target_url}</CodeChip>
              </TableCell>
              <TableCell>
                <Badge
                  variant={row.active ? 'active' : 'removed'}
                  className="gap-[6px] rounded-full border px-[9px] py-[3px] text-[11px]"
                >
                  {row.active ? (
                    <CheckCircle2 aria-hidden className="size-3" />
                  ) : (
                    <XCircle aria-hidden className="size-3" />
                  )}
                  {row.active ? t('operator.endpoints.active') : t('operator.endpoints.inactive')}
                </Badge>
              </TableCell>
              <TableCell className="text-right font-mono text-label tabular-nums text-pine">
                {row.delivered_count}
              </TableCell>
              <TableCell className="text-right font-mono text-label tabular-nums text-porch">
                {row.pending_count}
              </TableCell>
              <TableCell className="text-right font-mono text-label tabular-nums text-brick">
                {row.dead_letter_count}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Operator cross-company Event-Log (3.2, 0056). dead_letter-first; an Unternehmen
 * column identifies each event's company. Redelivery stays dead_letter-scoped +
 * per-event (uses the row's company_id). No payload/signature is exposed by the view.
 */
function OperatorEventLog() {
  const { t } = useTranslation('webhooks');
  const { data, isLoading, isError } = useOperatorWebhookEvents(true);
  const redeliver = useRedeliver();

  function handleRedeliver(event: OperatorWebhookEvent) {
    redeliver.mutate({ companyId: event.company_id, eventId: event.id });
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-sm">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  if (isError) {
    return <StateCard heading={t('error.heading')} body={t('error.body')} />;
  }
  const rows = data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title={t('operator.eventLog.empty.heading')}
        description={t('operator.eventLog.empty.body')}
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-[12px] border border-ink/10 bg-card">
      <Table>
        <TableHeader>
          <TableRow className="border-0 bg-ink hover:bg-ink">
            <TableHead className="text-[12px] uppercase tracking-[.02em] text-paper/85">
              {t('operator.eventLog.company')}
            </TableHead>
            <TableHead className="text-[12px] uppercase tracking-[.02em] text-paper/85">
              {t('eventLog.table.type')}
            </TableHead>
            <TableHead className="text-[12px] uppercase tracking-[.02em] text-paper/85">
              {t('eventLog.table.created')}
            </TableHead>
            <TableHead className="text-[12px] uppercase tracking-[.02em] text-paper/85">
              {t('eventLog.table.status')}
            </TableHead>
            <TableHead className="text-right text-[12px] uppercase tracking-[.02em] text-paper/85">
              {t('eventLog.table.attempts')}
            </TableHead>
            <TableHead className="text-paper/85" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((event) => (
            <TableRow key={event.id}>
              <TableCell className="font-medium text-foreground">
                {event.company_name ?? event.company_id}
              </TableCell>
              <TableCell>
                <CodeChip>{event.event_type}</CodeChip>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {new Date(event.created_at).toLocaleString('de-DE')}
              </TableCell>
              <TableCell>
                <StatusBadge status={event.status} />
              </TableCell>
              <TableCell className="text-right font-mono text-label text-foreground">
                {event.attempts}
              </TableCell>
              <TableCell className="text-right">
                {event.status === 'dead_letter' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={redeliver.isPending}
                    onClick={() => handleRedeliver(event)}
                  >
                    {redeliver.isPending ? t('eventLog.redelivering') : t('eventLog.redeliver')}
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
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
