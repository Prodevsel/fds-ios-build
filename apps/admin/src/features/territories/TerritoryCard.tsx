import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { ChevronDown, Lock, LockOpen, Squircle } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import type { TeamMember, Territory } from './useTerritoryData';

/**
 * One territory in the side panel: its name, how many of the caller's visible
 * houses fall inside it, whether it has a boundary at all, who it is assigned
 * to, and — separately and explicitly labelled — whether a device currently
 * holds the transient `locked_by` claim on it.
 *
 * Those last two are shown as two facts because they ARE two facts in the
 * schema (migration 0061 keeps the assignment out of `territories` on purpose).
 * Collapsing them into one "assigned to" line would be the dashboard asserting
 * something the database does not say.
 */
export interface TerritoryCardProps {
  territory: Territory;
  houseCount: number;
  /** Members of this territory's own team — the only valid assignees. */
  members: readonly TeamMember[];
  assignedRepId: string | null;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onAssign: (repId: string | null) => void;
}

const UNASSIGNED = '';

function memberLabel(member: TeamMember, fallback: string): string {
  return member.name ?? fallback;
}

export function TerritoryCard({
  territory,
  houseCount,
  members,
  assignedRepId,
  selected,
  busy,
  onSelect,
  onAssign,
}: TerritoryCardProps) {
  const { t } = useTranslation('territories');
  const selectId = React.useId();

  const lockHolder = members.find((member) => member.userId === territory.lockedBy) ?? null;
  const lockLabel =
    territory.lockedBy === null
      ? t('list.lockFree')
      : t('list.lockHeld', {
          name: lockHolder === null ? t('list.lockUnknownUser') : memberLabel(lockHolder, t('list.lockUnknownUser')),
        });

  return (
    <div
      className={cn(
        'rounded-[12px] border bg-card p-md transition-colors',
        selected ? 'border-porch shadow-sm' : 'border-ink/10',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-start gap-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-porch/40"
      >
        <Squircle
          aria-hidden
          className={cn('mt-0.5 size-4 shrink-0', selected ? 'text-porch' : 'text-ink/40')}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-body text-ink">
            {territory.name || t('list.nameless')}
          </span>
          <span className="block text-label text-[#5C6B85]">
            {territory.boundary === null
              ? t('list.notDrawn')
              : t('list.houses', { count: houseCount })}
          </span>
        </span>
      </button>

      <div className="mt-md flex flex-col gap-xs">
        <Label htmlFor={selectId} className="text-label text-[#5C6B85]">
          {t('list.assignLabel')}
        </Label>
        <div className="relative">
          <select
            id={selectId}
            disabled={busy}
            value={assignedRepId ?? UNASSIGNED}
            onChange={(event) =>
              onAssign(event.target.value === UNASSIGNED ? null : event.target.value)
            }
            className="flex h-10 w-full appearance-none rounded-[9px] border border-ink/[.16] bg-card px-[13px] pr-10 text-body text-foreground shadow-sm transition-colors focus-visible:border-porch focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-porch/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value={UNASSIGNED}>{t('list.unassigned')}</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {memberLabel(member, member.userId)}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden
            className="pointer-events-none absolute right-[13px] top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
        </div>
        {busy ? <span className="text-label text-[#5C6B85]">{t('list.assigning')}</span> : null}
      </div>

      <div className="mt-sm flex items-center gap-xs text-label text-[#5C6B85]">
        {territory.lockedBy === null ? (
          <LockOpen aria-hidden className="size-3.5" />
        ) : (
          <Lock aria-hidden className="size-3.5" />
        )}
        <span>{lockLabel}</span>
      </div>
    </div>
  );
}
