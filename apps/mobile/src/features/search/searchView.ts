import type { ContractListRow } from '../flow-runner/db/contractsRepo';
import type { Appointment, AppointmentKind } from '../termine/db/appointmentsRepo';

/**
 * Pure local-search view-model builder for the Suche screen (design SSOT screen
 * 17). Searches ONLY real synced local data — the offline-honest story ("es wird
 * nur lokal gesucht"): appointment addresses (the "Häuser" group — houses
 * themselves carry no address column, 0014, so the follow-up address is the real
 * searchable house label) and contracts by customer name or deal reference (the
 * "Abschlüsse" group). Deterministic, no RN/i18n import — unit-testable.
 */

export interface HouseHit {
  id: string;
  address: string;
  floorLabel: string | null;
  scheduledAtIso: string;
  kind: AppointmentKind;
}

export interface ContractHit {
  id: string;
  customerName: string;
  dealReference: string;
}

export interface SearchResults {
  haeuser: HouseHit[];
  abschluesse: ContractHit[];
  /** Total hits across both groups. */
  total: number;
}

export interface SearchSources {
  appointments: Appointment[];
  contracts: ContractListRow[];
}

const norm = (value: string): string => value.trim().toLowerCase();

function matches(haystack: string | null | undefined, needle: string): boolean {
  return typeof haystack === 'string' && norm(haystack).includes(needle);
}

/**
 * Builds the grouped result set for `query`. A blank query returns empty groups
 * (the screen then shows the "search locally" prompt, not a no-results state).
 */
export function buildSearchResults(query: string, sources: SearchSources): SearchResults {
  const needle = norm(query);
  if (!needle) return { haeuser: [], abschluesse: [], total: 0 };

  const haeuser: HouseHit[] = sources.appointments
    .filter((a) => matches(a.address, needle) || matches(a.floorLabel, needle) || matches(a.note, needle))
    .map((a) => ({
      id: a.id,
      address: a.address ?? '',
      floorLabel: a.floorLabel,
      scheduledAtIso: a.scheduledAtIso,
      kind: a.kind,
    }));

  const abschluesse: ContractHit[] = sources.contracts
    .filter((c) => matches(c.customerName, needle) || matches(c.dealReference, needle))
    .map((c) => ({ id: c.id, customerName: c.customerName, dealReference: c.dealReference }));

  return { haeuser, abschluesse, total: haeuser.length + abschluesse.length };
}
