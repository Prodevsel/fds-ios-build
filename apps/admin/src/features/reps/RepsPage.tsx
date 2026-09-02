import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, RefreshCw, UserMinus, UserPlus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { InviteRepDialog } from './InviteRepDialog';
import { CreateTeamCard } from './CreateTeamCard';
import { TeamLeadCard } from './TeamLeadCard';
import { Label } from '@/components/ui/label';
import {
  REPS_QUERY_KEY,
  type Rep,
  type RepStatus,
  useAdministrableTeams,
  useLeadTeamId,
  useReps,
} from './useReps';

/**
 * Status → badge variant + icon (ONBD-02, 3-state: invited/activated/synced;
 * `removed` unused this phase). Reuses the existing Badge design system (no
 * new visual language, Claude's Discretion): `invited` and `activated` share
 * the amber "in progress" hue (Clock vs. RefreshCw distinguishes the step),
 * `synced` is the only fully-done state (pine/CheckCircle2). Every status
 * still pairs a hue with an icon + label (colorblind-safe).
 */
const STATUS_META: Record<RepStatus, { variant: 'active' | 'invited' | 'removed'; icon: LucideIcon }> = {
  invited: { variant: 'invited', icon: Clock },
  activated: { variant: 'invited', icon: RefreshCw },
  synced: { variant: 'active', icon: CheckCircle2 },
  removed: { variant: 'removed', icon: UserMinus },
};

/**
 * Mitarbeiter screen (ADMN-01). Team roster table with invited/active/removed
 * status badges (icon + label, never color alone) and the email-only invite
 * dialog wired to the `rep-invite` Edge Function. Renders loading (skeleton),
 * empty ("Noch keine Mitarbeiter"), error, and populated states. All copy comes
 * from the reps feature namespace; no literal colors (token classes only).
 */
export function RepsPage() {
  const { t } = useTranslation('reps');
  const queryClient = useQueryClient();
  const { data: reps, isLoading, isError } = useReps();
  const { data: leadTeamId } = useLeadTeamId();
  const { data: administrableTeams } = useAdministrableTeams();

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);
  // Which team an invite lands in. Seeded from the team the user leads when
  // there is one, else the first sales-org team they administer. Both sources
  // are already filtered to sales-org teams, so a COMPANY team can never end
  // up here (T-gti-08).
  const [selectedTeamId, setSelectedTeamId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (selectedTeamId) {
      return;
    }
    if (leadTeamId) {
      setSelectedTeamId(leadTeamId);
    } else if (administrableTeams && administrableTeams.length > 0 && administrableTeams[0]) {
      setSelectedTeamId(administrableTeams[0].id);
    }
  }, [leadTeamId, administrableTeams, selectedTeamId]);

  function handleInvited(email: string, role: string) {
    // Optimistic invited row — the freshly invited rep IS invited (unconfirmed),
    // known locally because we just invited them (the roster query cannot read
    // auth-confirmation state). Deduped by the synthetic invited:<email> id.
    const optimistic: Rep = {
      id: `invited:${email}`,
      userId: null,
      name: email,
      role,
      status: 'invited',
      email,
    };
    queryClient.setQueryData<Rep[]>(REPS_QUERY_KEY, (old) => {
      const existing = old ?? [];
      if (existing.some((r) => r.id === optimistic.id)) {
        return existing;
      }
      return [optimistic, ...existing];
    });
    setToast(t('toast.successBody', { email }));
  }

  return (
    <div className="flex flex-col gap-xl">
      <header className="flex flex-wrap items-start justify-between gap-md">
        <div className="flex flex-col gap-xs">
          <h1 className="font-display text-display text-foreground">{t('title')}</h1>
          <p className="text-body text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <UserPlus aria-hidden className="size-4" />
          {t('invite.cta')}
        </Button>
      </header>

      {/* 0087: only rendered for someone who administers a sales organisation —
          the card returns null otherwise, and the RPC behind it would reject
          them regardless. */}
      <CreateTeamCard />

      {/* 0091: the ONLY control that grants the dashboard team_lead role — an
          invite's "Teamleitung" role writes a memberships row nothing reads as
          authority. Self-hiding when there is no sales-org team to administer. */}
      <TeamLeadCard />

      {(administrableTeams?.length ?? 0) > 1 ? (
        <div className="flex max-w-sm flex-col gap-xs">
          <Label htmlFor="reps-team">{t('teamSelect.label')}</Label>
          <select
            id="reps-team"
            className="h-10 rounded-md border border-input bg-transparent px-md text-body"
            value={selectedTeamId ?? ''}
            onChange={(e) => setSelectedTeamId(e.target.value || null)}
          >
            {administrableTeams?.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {isLoading ? (
        <RepsSkeleton />
      ) : isError ? (
        <StateCard heading={t('error.heading')} body={t('error.body')} />
      ) : (reps?.length ?? 0) === 0 ? (
        <StateCard heading={t('empty.heading')} body={t('empty.body')} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-transparent hover:bg-transparent">
              <TableHead className="text-paper">{t('table.name')}</TableHead>
              <TableHead className="text-paper">{t('table.role')}</TableHead>
              <TableHead className="text-paper">{t('table.status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reps?.map((rep) => (
              <TableRow key={rep.id}>
                <TableCell className="font-medium text-foreground">
                  {rep.name ?? t('unnamed')}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {t(`invite.roles.${rep.role}`, { defaultValue: rep.role })}
                </TableCell>
                <TableCell>
                  <StatusBadge status={rep.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <InviteRepDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        teamId={selectedTeamId}
        onInvited={handleInvited}
      />

      {toast ? <Toast message={toast} title={t('toast.success')} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

function StatusBadge({ status }: { status: RepStatus }) {
  const { t } = useTranslation('reps');
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

function RepsSkeleton() {
  return (
    <div className="flex flex-col gap-sm">
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

/** Minimal auto-dismissing toast (no external toaster dependency). */
function Toast({
  message,
  title,
  onDismiss,
}: {
  message: string;
  title: string;
  onDismiss: () => void;
}) {
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
      <div className="flex flex-col gap-xs">
        <p className="text-body font-medium text-foreground">{title}</p>
        <p className="text-label text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
