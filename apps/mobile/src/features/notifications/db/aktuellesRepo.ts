import type { AbstractPowerSyncDatabase } from '@powersync/common';
import { parseCustomerName } from '../../flow-runner/db/contractsRepo';

/**
 * Read model for the Aktuelles activity feed (design SSOT screen 16). The feed
 * is DERIVED from real synced tables — never a fabricated notifications table:
 * this repo supplies the two sources that need a join/own query (Storno events
 * with the customer name, and own-locked territory assignments), while the
 * screen reuses contractsRepo (Vertrag abgeschlossen) and appointmentsRepo
 * (Folgetermin heute) directly. Pure merge/sort lives in `activityFeed.ts`.
 *
 * Copies the walletRepo pattern (options-object DI, module-const SQL, pure
 * mapper, AbortController unsubscribe). Read-only.
 */

/** A Widerruf/Storno event surfaced in the feed. */
export interface StornoEvent {
  contractId: string;
  occurredAtIso: string;
  dealReference: string;
  customerName: string;
}

/** A territory newly assigned to (locked by) this rep. */
export interface TerritoryEvent {
  id: string;
  name: string;
  createdAtIso: string;
}

interface RawStornoRecord {
  contract_id: string;
  occurred_at: string;
  deal_reference: string;
  answers: string;
}

interface RawTerritoryRecord {
  id: string;
  name: string;
  created_at: string;
}

const STORNO_QUERY = `
  SELECT ev.contract_id AS contract_id, ev.occurred_at AS occurred_at,
         c.deal_reference AS deal_reference, c.answers AS answers
  FROM contract_status_events ev
  JOIN contracts c ON c.id = ev.contract_id
  WHERE ev.event_type = 'cancelled' AND c.rep_id = ?
`;

const TERRITORY_QUERY = `
  SELECT id, name, created_at FROM territories WHERE locked_by = ?
`;

function toStornoEvent(record: RawStornoRecord): StornoEvent {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(record.answers);
  } catch {
    parsed = null;
  }
  return {
    contractId: record.contract_id,
    occurredAtIso: record.occurred_at,
    dealReference: record.deal_reference,
    customerName: parseCustomerName(parsed),
  };
}

function toTerritoryEvent(record: RawTerritoryRecord): TerritoryEvent {
  return { id: record.id, name: record.name, createdAtIso: record.created_at };
}

export interface CreateAktuellesRepoOptions {
  db: AbstractPowerSyncDatabase;
}

export interface AktuellesRepo {
  watchStornoEvents(
    repId: string,
    onChange: (events: StornoEvent[]) => void,
    onError?: (error: unknown) => void,
  ): () => void;
  watchTerritoryEvents(
    repId: string,
    onChange: (events: TerritoryEvent[]) => void,
    onError?: (error: unknown) => void,
  ): () => void;
}

export function createAktuellesRepo(options: CreateAktuellesRepoOptions): AktuellesRepo {
  const { db } = options;

  const watch = <TRaw, TOut>(
    query: string,
    repId: string,
    map: (raw: TRaw) => TOut,
    onChange: (rows: TOut[]) => void,
    onError?: (error: unknown) => void,
  ): (() => void) => {
    const controller = new AbortController();
    db.watch(
      query,
      [repId],
      {
        onResult: (result) => {
          const rows = (result.rows?._array ?? []) as TRaw[];
          onChange(rows.map(map));
        },
        onError: (error) => onError?.(error),
      },
      { signal: controller.signal },
    );
    return () => controller.abort();
  };

  return {
    watchStornoEvents(repId, onChange, onError) {
      return watch(STORNO_QUERY, repId, toStornoEvent, onChange, onError);
    },
    watchTerritoryEvents(repId, onChange, onError) {
      return watch(TERRITORY_QUERY, repId, toTerritoryEvent, onChange, onError);
    },
  };
}
