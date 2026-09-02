import type { ContractStat } from './db/profileRepo';
import type { Appointment } from '../termine/db/appointmentsRepo';
import type { HouseRow } from '../map/db/housesRepo';
import type { AssignableTerritoryRow } from '../map/db/territoriesRepo';
import { isSameLocalMonth, localDayDelta } from '../../lib/datetime/format';

/**
 * Pure Profil view-model builders (design SSOT screen 13). Deterministic in
 * `nowMs`, no `react-native` import — unit-testable without a DB or an RN mock.
 * Every figure is derived from real synced rows; the ones with no backing data
 * (Ziel/target, Quote/Abschlussquote — BACKEND-GAP-CLOSURE 4.4) are left OUT of
 * this model and rendered as an honest placeholder by the screen, never faked.
 */

export interface ProfileKpis {
  /** Non-tester deals signed in the current local month. */
  dealsThisMonth: number;
  /** Recurring monthly volume in EUR (sum of this month's frozen door prices). */
  monthlyVolumeEur: number;
  /** Doors this rep has worked (houses they dropped a pin on). */
  doorsWorked: number;
  /** Open follow-up appointments (total). */
  followupsTotal: number;
  /** ...of which fall on the current local day. */
  followupsToday: number;
}

export function buildProfileKpis(
  contractStats: ContractStat[],
  appointments: Appointment[],
  houses: HouseRow[],
  repId: string,
  nowMs: number,
): ProfileKpis {
  const thisMonthDeals = contractStats.filter(
    (c) => !c.isTest && isSameLocalMonth(nowMs, c.signedAtIso),
  );
  const monthlyVolumeEur = thisMonthDeals.reduce((sum, c) => sum + (c.doorPriceEur ?? 0), 0);

  return {
    dealsThisMonth: thisMonthDeals.length,
    monthlyVolumeEur,
    doorsWorked: houses.filter((h) => h.created_by === repId).length,
    followupsTotal: appointments.length,
    followupsToday: appointments.filter(
      (a) => localDayDelta(nowMs, new Date(a.scheduledAtIso).getTime()) === 0,
    ).length,
  };
}

/** One territory row on the Profil screen. */
export interface TerritoryRowView {
  id: string;
  name: string;
  /** True when this rep holds the lock (design: green "aktiv"). */
  isActive: boolean;
  /** Households (houses) attributed to this territory, or null when unknown. */
  householdCount: number;
  /** ...of which are still status 'new' (design: "N offen"). */
  openCount: number;
}

export function buildTerritoryRows(
  territories: AssignableTerritoryRow[],
  houses: HouseRow[],
  repId: string,
): TerritoryRowView[] {
  const rows = territories.map((terr) => {
    const inTerritory = houses.filter((h) => h.territory_id === terr.id);
    return {
      id: terr.id,
      name: terr.name,
      isActive: terr.locked_by === repId,
      householdCount: inTerritory.length,
      openCount: inTerritory.filter((h) => h.status === 'new').length,
    };
  });
  // Active (own-locked) territory first, then the rest by name for stability.
  return rows.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
