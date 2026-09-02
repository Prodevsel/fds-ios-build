import type { ContractListRow } from '../flow-runner/db/contractsRepo';
import type { Appointment } from '../termine/db/appointmentsRepo';
import type { StornoEvent, TerritoryEvent } from './db/aktuellesRepo';
import { localDayDelta } from '../../lib/datetime/format';

/**
 * Pure Aktuelles activity-feed builder (design SSOT screen 16). Merges four
 * REAL synced sources into one reverse-chronological feed — no fabricated
 * notifications table, no invented rows. Deterministic in `nowMs`, no
 * `react-native`/i18n import: it returns structured items (kind + payload +
 * real event `iso` + `isNew`), and the screen composes the German title/body
 * and relative timestamp. Unit-testable without a DB or an RN mock.
 *
 * "Neu" is an item whose real event time is within the last 24h (the honest
 * default before a persisted last-seen marker exists); the screen additionally
 * lets the rep mark everything read.
 */

export type FeedItemKind = 'followup' | 'storno' | 'contract' | 'territory';

export interface FeedItem {
  id: string;
  kind: FeedItemKind;
  /** Real event time — sort key and relative-timestamp anchor. */
  iso: string;
  isNew: boolean;
  // Kind-specific payload (the screen composes copy from these):
  dealReference?: string;
  customerName?: string;
  territoryName?: string;
  address?: string | null;
  floorLabel?: string | null;
  /** For a follow-up: the appointment's scheduled time (title shows "heute HH:MM"). */
  appointmentTimeIso?: string;
}

export interface ActivityFeedSources {
  contracts: ContractListRow[];
  stornos: StornoEvent[];
  territories: TerritoryEvent[];
  /** All of the rep's appointments — only today's surface as feed items. */
  appointments: Appointment[];
}

const DAY_MS = 86_400_000;

export function buildActivityFeed(sources: ActivityFeedSources, nowMs: number): FeedItem[] {
  const isNew = (iso: string): boolean => {
    const ms = new Date(iso).getTime();
    return !Number.isNaN(ms) && nowMs - ms < DAY_MS;
  };

  const items: FeedItem[] = [];

  for (const c of sources.contracts) {
    items.push({
      id: `contract:${c.id}`,
      kind: 'contract',
      iso: c.signedAtIso,
      isNew: isNew(c.signedAtIso),
      dealReference: c.dealReference,
      customerName: c.customerName,
    });
  }

  for (const s of sources.stornos) {
    items.push({
      id: `storno:${s.contractId}`,
      kind: 'storno',
      iso: s.occurredAtIso,
      isNew: isNew(s.occurredAtIso),
      dealReference: s.dealReference,
      customerName: s.customerName,
    });
  }

  for (const terr of sources.territories) {
    items.push({
      id: `territory:${terr.id}`,
      kind: 'territory',
      iso: terr.createdAtIso,
      isNew: isNew(terr.createdAtIso),
      territoryName: terr.name,
    });
  }

  for (const a of sources.appointments) {
    // Only today's follow-ups belong in the feed ("Folgetermin heute").
    if (localDayDelta(nowMs, new Date(a.scheduledAtIso).getTime()) !== 0) continue;
    items.push({
      id: `followup:${a.id}`,
      kind: 'followup',
      iso: a.createdAtIso,
      isNew: isNew(a.createdAtIso),
      address: a.address,
      floorLabel: a.floorLabel,
      appointmentTimeIso: a.scheduledAtIso,
    });
  }

  // Newest real event first; stable tiebreak by id so the order is deterministic.
  return items.sort((x, y) => {
    const dx = new Date(y.iso).getTime() - new Date(x.iso).getTime();
    return dx !== 0 ? dx : x.id.localeCompare(y.id);
  });
}

/** Count of unread-new items given a set of ids the rep has marked read. */
export function countNew(items: FeedItem[], readIds: ReadonlySet<string>): number {
  return items.filter((i) => i.isNew && !readIds.has(i.id)).length;
}
