import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChevronDown } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import type { LedTeam } from './useTerritoryData';

/**
 * Name-and-team step, shown once a polygon has been drawn. The team select is
 * rendered only when the caller actually leads more than one team — with a
 * single team there is nothing to choose and a one-option dropdown would just
 * be noise.
 */
export interface CreateTerritoryDialogProps {
  open: boolean;
  teams: readonly LedTeam[];
  saving: boolean;
  /** Already-translated failure copy from the last attempt, if any. */
  errorMessage: string | null;
  onClose: () => void;
  onSubmit: (input: { name: string; teamId: string }) => void;
}

export function CreateTerritoryDialog({
  open,
  teams,
  saving,
  errorMessage,
  onClose,
  onSubmit,
}: CreateTerritoryDialogProps) {
  const { t } = useTranslation('territories');
  const [name, setName] = React.useState('');
  const [teamId, setTeamId] = React.useState('');
  const nameId = React.useId();
  const teamSelectId = React.useId();

  const firstTeamId = teams[0]?.id ?? '';
  React.useEffect(() => {
    if (open) {
      setName('');
      setTeamId(firstTeamId);
    }
  }, [open, firstTeamId]);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && teamId !== '' && !saving;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('create.title')}
      description={t('create.description')}
      closeLabel={t('cta.close')}
    >
      <form
        className="flex flex-col gap-md"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) {
            onSubmit({ name: trimmed, teamId });
          }
        }}
      >
        <div className="flex flex-col gap-xs">
          <Label htmlFor={nameId}>{t('create.nameLabel')}</Label>
          <Input
            id={nameId}
            value={name}
            autoFocus
            maxLength={120}
            placeholder={t('create.namePlaceholder')}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        {teams.length > 1 ? (
          <div className="flex flex-col gap-xs">
            <Label htmlFor={teamSelectId}>{t('create.teamLabel')}</Label>
            <div className="relative">
              <select
                id={teamSelectId}
                value={teamId}
                onChange={(event) => setTeamId(event.target.value)}
                className="flex h-10 w-full appearance-none rounded-[9px] border border-ink/[.16] bg-card px-[13px] pr-10 text-body text-foreground shadow-sm focus-visible:border-porch focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-porch/20"
              >
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                aria-hidden
                className="pointer-events-none absolute right-[13px] top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
            </div>
          </div>
        ) : null}

        {errorMessage === null ? null : (
          <p role="alert" className="text-body text-brick">
            {errorMessage}
          </p>
        )}

        <div className="flex justify-end gap-sm">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            {t('cta.cancel')}
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {saving ? t('create.saving') : t('cta.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
