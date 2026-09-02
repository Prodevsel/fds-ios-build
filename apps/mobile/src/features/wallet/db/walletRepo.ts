import type { AbstractPowerSyncDatabase } from '@powersync/common';
import { parseCustomerName } from '../../flow-runner/db/contractsRepo';
import { computeCommissionEur } from '../computeCommissionEur';

/**
 * Wallet read model (WALT-01/WALT-02, D-05). A reactive projection over the
 * already-synced `contracts` + `contract_status_events` tables — copies the
 * contractsRepo.watchContracts pattern (options-object DI, module-const SQL,
 * pure mapper, AbortController unsubscribe). Read-only: the wallet never
 * mutates the append-only SSOT.
 *
 * PowerSync serializes Postgres numeric/boolean/timestamptz as SQLite TEXT, so
 * the mapper MUST parse the rate/base text before any commission math and MUST
 * NEVER do arithmetic on the raw text (T-06-08). computeCommissionEur (Plan 02)
 * is the single source of truth for the flat_eur/percent resolution and its
 * null/NaN guard — reused here, never re-implemented.
 *
 * Tester exclusion (D-06/T-06-03) lives in the SQL WHERE on the server-set
 * is_test flag: the pure aggregator (Plan 02) intentionally has no is_test
 * field, so THIS query is the enforcement point. is_test is a boolean→text
 * column whose synced form is mixed across the codebase ('0'/'1' vs
 * 'false'/'true' — see flowDraftsRepo's `=== '1' || === 'true'`), so the WHERE
 * rejects BOTH truthy forms.
 */

/** Wallet deal row — NO state field; the 3-state D-01 classification is derived
 * in the screen with the server-time anchor (deriveWalletState, Plan 02). */
export interface WalletDeal {
  id: string;
  dealReference: string;
  customerName: string;
  signedAtIso: string;
  /** D-07 frozen commission in EUR, or null (renders "—") for an unparseable
   * or missing rate — never NaN (computeCommissionEur guard). */
  commissionEur: number | null;
  /** Earliest 'cancelled' event time (D-01 reversal), or null while open. */
  cancelledAtIso: string | null;
}

export interface CreateWalletRepoOptions {
  db: AbstractPowerSyncDatabase;
}

export interface WalletRepo {
  /** One-shot rep-scoped read of the wallet deals (newest signing first). */
  getWallet(repId: string): Promise<WalletDeal[]>;
  /** Reactive rep-scoped read; re-emits on every sync landing. Returns an
   * unsubscribe (AbortController.abort). */
  watchWallet(
    repId: string,
    onChange: (deals: WalletDeal[]) => void,
    onError?: (error: unknown) => void,
  ): () => void;
}

interface RawWalletRecord {
  id: string;
  deal_reference: string;
  answers: string;
  signed_at: string;
  rate: string | null;
  rate_type: string | null;
  base: string | null;
  /** Non-null marks a direct_pdf contract, whose commission base is a sentinel. */
  direct_sign_template_id: string | null;
  cancelled_at: string | null;
}

/**
 * Rep-scoped, tester-excluded wallet query. Earliest cancelled event per deal
 * via LEFT JOIN + MIN(occurred_at) grouped by contract. `WHERE c.rep_id = ?`
 * is a UI narrowing over already-RLS-/sync-scoped local rows — NOT the security
 * boundary (mirrors contractsRepo's T-04-05 note; RLS + the sync stream already
 * scope which contracts/events exist on-device). The tester filter rejects both
 * synced boolean text forms ('1' and 'true') so a tester deal can never inflate
 * a real payout regardless of the serializer (T-06-03/D-06).
 */
const WALLET_QUERY = `
  SELECT c.id AS id, c.deal_reference AS deal_reference, c.answers AS answers,
         c.signed_at AS signed_at,
         c.commission_rate_snapshot AS rate,
         c.commission_rate_type      AS rate_type,
         c.commission_base_snapshot  AS base,
         -- The direct-sign discriminator. 0049:100 freezes
         -- commission_base_snapshot from snapshot_door_price, which this path
         -- wrote as the sentinel 0 until today — so a percent-rate rep saw a
         -- confident "0,00 EUR" commission instead of "unknown". contracts is
         -- append-only (0004), so the read side has to interpret it.
         c.direct_sign_template_id   AS direct_sign_template_id,
         MIN(ev.occurred_at)         AS cancelled_at
  FROM contracts c
  LEFT JOIN contract_status_events ev
    ON ev.contract_id = c.id AND ev.event_type = 'cancelled'
  WHERE c.rep_id = ?
    AND (c.is_test IS NULL OR c.is_test NOT IN ('1', 'true'))
  GROUP BY c.id
  ORDER BY c.signed_at DESC
`;

/** Parse a synced numeric TEXT to a number, or null for null/unparseable input
 * (the NaN guard so no NaN ever reaches computeCommissionEur — T-06-08). */
function parseNumericText(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Pure mapper: parses the synced TEXT record into a WalletDeal. Never throws,
 * never does arithmetic on raw text, never returns NaN. */
export function toWalletDeal(record: RawWalletRecord): WalletDeal {
  let parsedAnswers: unknown = null;
  try {
    parsedAnswers = JSON.parse(record.answers);
  } catch {
    parsedAnswers = null;
  }

  const rateType =
    record.rate_type === 'flat_eur' || record.rate_type === 'percent' ? record.rate_type : null;

  return {
    id: record.id,
    dealReference: record.deal_reference,
    customerName: parseCustomerName(parsedAnswers),
    signedAtIso: record.signed_at,
    commissionEur: computeCommissionEur(
      rateType,
      parseNumericText(record.rate),
      // A direct_pdf contract has no captured value, so a percent commission on
      // it is UNKNOWABLE, not zero. computeCommissionEur returns null for a
      // null base and the wallet renders its "—" placeholder — which already
      // existed and was simply never reached. A flat_eur rate is unaffected:
      // it ignores the base by definition (computeCommissionEur.ts:19-21).
      record.direct_sign_template_id != null ? null : parseNumericText(record.base),
    ),
    cancelledAtIso: record.cancelled_at ?? null,
  };
}

/** Injectable read model (options-object DI, matches createContractsRepo). */
export function createWalletRepo(options: CreateWalletRepoOptions): WalletRepo {
  const { db } = options;

  return {
    async getWallet(repId) {
      const rows = await db.getAll<RawWalletRecord>(WALLET_QUERY, [repId]);
      return rows.map(toWalletDeal);
    },

    watchWallet(repId, onChange, onError) {
      const controller = new AbortController();
      db.watch(
        WALLET_QUERY,
        [repId],
        {
          onResult: (result) => {
            const rows = (result.rows?._array ?? []) as RawWalletRecord[];
            onChange(rows.map(toWalletDeal));
          },
          onError: (error) => onError?.(error),
        },
        { signal: controller.signal },
      );
      return () => controller.abort();
    },
  };
}
