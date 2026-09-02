import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MapIcon, PencilLine, Undo2, Users } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { CreateTerritoryDialog } from './CreateTerritoryDialog';
import { MapLegend } from './MapLegend';
import { TerritoryCard } from './TerritoryCard';
import { TerritoryMap } from './TerritoryMap';
import { BASEMAP_ATTRIBUTION } from './mapStyle';
import { type Position, draftToPolygon, draftVerdict } from './polygon';
import {
  useHouses,
  useLedTeams,
  useTeamMembers,
  useTerritories,
  useTerritoryAssignments,
} from './useTerritoryData';
import { useAssignTerritory, useCreateTerritory, verdictMessageKey } from './useTerritoryMutations';

/**
 * "Gebiete" — the team lead's territory screen (TERR-01/TASGN-01 on the PC).
 *
 * Everything a rep can only do with a finger on the phone map is available
 * here with a mouse: see the team's territories and the houses inside them in
 * their traffic-light status colours, draw a new boundary corner by corner,
 * name it, and assign / reassign / unassign it to a member of the team.
 *
 * Route visibility is scoped to `team_lead` in SidebarNav, but that is UX only
 * — the RLS policies and the two SECURITY DEFINER RPCs behind the writes are
 * the actual authority (T-05-01).
 */
export function TerritoriesPage() {
  const { t } = useTranslation('territories');

  const teamsQuery = useLedTeams();
  const territoriesQuery = useTerritories();
  const housesQuery = useHouses();
  const membersQuery = useTeamMembers();
  const assignmentsQuery = useTerritoryAssignments();

  const createTerritory = useCreateTerritory();
  const assignTerritory = useAssignTerritory();

  const [selectedTerritoryId, setSelectedTerritoryId] = React.useState<string | null>(null);
  const [drawing, setDrawing] = React.useState(false);
  const [draftPoints, setDraftPoints] = React.useState<Position[]>([]);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [busyTerritoryId, setBusyTerritoryId] = React.useState<string | null>(null);
  const [assignError, setAssignError] = React.useState<string | null>(null);

  const teams = teamsQuery.data ?? [];
  const territories = territoriesQuery.data ?? [];
  const houses = housesQuery.data ?? [];
  const members = membersQuery.data ?? [];
  const assignments = assignmentsQuery.data ?? [];

  /** Only territories of a team the caller actually leads are manageable here. */
  const ledTeamIds = React.useMemo(() => new Set(teams.map((team) => team.id)), [teams]);
  const managedTerritories = React.useMemo(
    () => territories.filter((territory) => ledTeamIds.has(territory.teamId)),
    [territories, ledTeamIds],
  );

  const housesByTerritory = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const house of houses) {
      if (house.territoryId !== null) {
        counts.set(house.territoryId, (counts.get(house.territoryId) ?? 0) + 1);
      }
    }
    return counts;
  }, [houses]);

  const assigneeByTerritory = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const assignment of assignments) {
      map.set(assignment.territoryId, assignment.assignedRepId);
    }
    return map;
  }, [assignments]);

  const verdict = draftVerdict(draftPoints);
  const isLoading =
    teamsQuery.isLoading || territoriesQuery.isLoading || housesQuery.isLoading;
  const isError = teamsQuery.isError || territoriesQuery.isError || housesQuery.isError;

  function startDrawing() {
    setSelectedTerritoryId(null);
    setDraftPoints([]);
    setDrawing(true);
  }

  function cancelDrawing() {
    setDrawing(false);
    setDraftPoints([]);
    setDialogOpen(false);
    createTerritory.reset();
  }

  function handleCreate(input: { name: string; teamId: string }) {
    const boundary = draftToPolygon(draftPoints);
    const team = teams.find((candidate) => candidate.id === input.teamId);
    if (boundary === null || team === undefined) {
      return;
    }
    createTerritory.mutate(
      {
        name: input.name,
        teamId: team.id,
        companyId: team.companyId,
        salesOrgId: team.salesOrgId,
        boundary,
      },
      {
        onSuccess: (territoryId) => {
          setDialogOpen(false);
          setDrawing(false);
          setDraftPoints([]);
          setSelectedTerritoryId(territoryId);
        },
      },
    );
  }

  function handleAssign(territoryId: string, repId: string | null) {
    setAssignError(null);
    setBusyTerritoryId(territoryId);
    assignTerritory.mutate(
      { territoryId, repId },
      {
        onError: (error) => setAssignError(t(verdictMessageKey(error))),
        onSettled: () => setBusyTerritoryId(null),
      },
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-lg">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[520px] w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={MapIcon}
        tone="muted"
        title={t('empty.errorTitle')}
        description={t('empty.errorBody')}
      />
    );
  }

  if (teams.length === 0) {
    return (
      <EmptyState icon={Users} title={t('empty.noTeamTitle')} description={t('empty.noTeamBody')} />
    );
  }

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div className="flex flex-col gap-xs">
          <h1 className="font-display text-display text-ink">{t('title')}</h1>
          <p className="max-w-[560px] text-body text-[#5C6B85]">{t('subtitle')}</p>
        </div>
        {drawing ? (
          <div className="flex items-center gap-sm">
            <Button
              variant="outline"
              onClick={() => setDraftPoints((points) => points.slice(0, -1))}
              disabled={draftPoints.length === 0}
            >
              <Undo2 aria-hidden className="size-4" />
              {t('cta.undo')}
            </Button>
            <Button variant="ghost" onClick={cancelDrawing}>
              {t('cta.cancel')}
            </Button>
            <Button onClick={() => setDialogOpen(true)} disabled={verdict !== 'ok'}>
              {t('cta.finish')}
            </Button>
          </div>
        ) : (
          <Button onClick={startDrawing}>
            <PencilLine aria-hidden className="size-4" />
            {t('cta.draw')}
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-lg xl:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-sm">
          <div className="h-[560px] overflow-hidden rounded-[12px] border border-ink/10 bg-card">
            <TerritoryMap
              territories={managedTerritories}
              houses={houses}
              selectedTerritoryId={selectedTerritoryId}
              onSelectTerritory={setSelectedTerritoryId}
              drawing={drawing}
              draftPoints={draftPoints}
              onDraftPointsChange={setDraftPoints}
              label={t('map.label')}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-md">
            <MapLegend />
            <p
              className="text-label text-[#5C6B85] [&_a]:underline"
              // ODbL requires the OpenStreetMap credit to stay visible. MapLibre's
              // own AttributionControl already renders it on the canvas; this is the
              // same constant repeated below the map so it survives a narrow viewport.
              dangerouslySetInnerHTML={{ __html: BASEMAP_ATTRIBUTION }}
            />
          </div>

          <p className="text-label text-[#5C6B85]">
            {drawing ? t('map.drawHint') : t('map.hint')}
          </p>
          {drawing ? (
            <p className={verdict === 'ok' ? 'text-label text-[#5C6B85]' : 'text-label text-brick'}>
              {verdict === 'ok'
                ? t('map.pointCount', { count: draftPoints.length })
                : t(`draft.${verdict}`)}
            </p>
          ) : null}
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-md xl:w-[340px]">
          <h2 className="font-display text-heading text-ink">{t('list.title')}</h2>
          {managedTerritories.length === 0 ? (
            <EmptyState
              icon={MapIcon}
              title={t('empty.noTerritoriesTitle')}
              description={t('empty.noTerritoriesBody')}
            />
          ) : (
            <>
              {assignError === null ? null : (
                <p role="alert" className="text-body text-brick">
                  {assignError}
                </p>
              )}
              {managedTerritories.map((territory) => (
                <TerritoryCard
                  key={territory.id}
                  territory={territory}
                  houseCount={housesByTerritory.get(territory.id) ?? 0}
                  members={members.filter((member) => member.teamId === territory.teamId)}
                  assignedRepId={assigneeByTerritory.get(territory.id) ?? null}
                  selected={territory.id === selectedTerritoryId}
                  busy={busyTerritoryId === territory.id}
                  onSelect={() => setSelectedTerritoryId(territory.id)}
                  onAssign={(repId) => handleAssign(territory.id, repId)}
                />
              ))}
              <p className="text-label text-[#5C6B85]">{t('list.lockExplainer')}</p>
            </>
          )}
        </aside>
      </div>

      <CreateTerritoryDialog
        open={dialogOpen}
        teams={teams}
        saving={createTerritory.isPending}
        errorMessage={
          createTerritory.error === null ? null : t(verdictMessageKey(createTerritory.error))
        }
        onClose={() => setDialogOpen(false)}
        onSubmit={handleCreate}
      />
    </div>
  );
}
