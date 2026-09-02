import type { AbstractPowerSyncDatabase } from '@powersync/common';
import * as Crypto from 'expo-crypto';
import { t } from '../../../i18n';
import { computeCommissionEur } from '../../wallet/computeCommissionEur';

/**
 * Local-SQLite mirror of the extended `contracts` table
 * (0001_tenant_hierarchy.sql base + 0029_contracts_extend.sql snapshot/audit
 * columns). APPEND-ONLY (D-10/D-22) — write side exposes insertContract only
 * (mirrors flowDraftsRepo's DI/mapper shape, but with a single write method:
 * no update/save/discard — a legally signed contract never mutates
 * post-insert, enforced server-side by the 0004 reject_contract_mutation
 * triggers). Read side (04-09) adds listContracts/watchContracts for the
 * read-only "Meine Abschlüsse" list (D-18) — still no mutation surface.
 *
 * All writes here are local-only (Iron Rule 1) — connector.ts's
 * applyContractOperation drains the upload queue (already append-only-
 * correct, extended in 04-03 Task 1 to parse audit_package/answers
 * jsonb-as-text before forwarding).
 */

export interface ContractSnapshotInput {
  /**
   * `null` when no price was captured — a direct_pdf product carries no
   * discount block (D-04). NEVER 0 as a stand-in: 0098_offer_portal.sql:420
   * states the rule for this very column, "A MISSING price field becomes NULL,
   * never 0 — a contract claiming a door price of 0,00 EUR would be worse than
   * one that admits it does not know." The direct-sign path was writing 0 in
   * contradiction of it.
   */
  doorPrice: number | null;
  comparisonPrice: number | null;
  discountAmount: number | null;
  termsText: string;
}

export interface InsertContractInput {
  companyId: string;
  repId: string;
  teamId: string;
  productDefinitionId: string;
  productVersion: number;
  termsId: string;
  termsVersion: number;
  /** D-10 freeze-copy: the exact rep/customer answers in force at signing. */
  answers: Record<string, unknown>;
  /** D-10 freeze-copy: the concretely displayed commercial terms, forwarded verbatim. */
  snapshot: ContractSnapshotInput;
  /** D-01/SIGN-03: the assembled offline audit package (device id, timestamps, GPS-or-null, confirmed gates, signature stroke data). */
  auditPackage: Record<string, unknown>;
  /** D-02: SHA-256 over the canonicalized audit package, computed by the caller (canonicalize.ts). */
  packageHashSha256: string;
  /** D-09: UUID of the signature PNG in the Phase-1 attachment queue. */
  signatureAttachmentId: string;
  /** D-20: device wall-clock signing timestamp. */
  signedAtIso: string;
  /** D-12: caller may supply a pre-generated reference; otherwise one is generated here. */
  dealReference?: string;
  /**
   * CR-02: caller may supply a pre-derived, DETERMINISTIC id (e.g. derived
   * from the flow draft id) so that a retried `completeSigning` call after a
   * transient failure re-targets the SAME row instead of inserting a second,
   * distinct contract for the same draft. `insertContract` is `INSERT OR
   * IGNORE` keyed on this id — the caller must derive it deterministically
   * per draft for the idempotency guarantee to hold. Falls back to a random
   * uuid if omitted (existing callers/tests unaffected).
   */
  id?: string;
  /**
   * DSGN-03 (Phase 10, 0069_contracts_direct_sign_template_id.sql): set only
   * for a direct-sign completion -- the direct_pdf product's template row id.
   * A flow-form insert (completeSigning, Phase 4) omits this and the column
   * stays null, unchanged behavior.
   */
  directSignTemplateId?: string;
  /**
   * 0084 (§5.2): the lead whose offer code the rep redeemed to open this
   * consultation. Set once, at insert — redemption is recorded contract-side
   * only, because `leads` is insert-only. Absent for a walk-up closing.
   */
  redeemedLeadId?: string | null;
  /** 0101: the house — or the PARTY — the flow ran on. Null outside the house flow. */
  houseId?: string | null;
  /**
   * QUICK-GTI (0055:38): the customer's name, frozen into the contract row at
   * INSERT. Optional — when omitted, `insertContract` derives it from
   * `answers` via `deriveContractCustomerName`, so the direct-sign path
   * (completeDirectSign.ts) is covered without being touched. An explicit
   * value wins. `contracts` is append-only, so a name missed here is lost for
   * that deal forever.
   */
  customerName?: string | null;
}

export interface InsertContractResult {
  id: string;
  dealReference: string;
}

/** D-18 contract-list row — read-only projection, never a mutation target. */
export interface ContractListRow {
  id: string;
  dealReference: string;
  customerName: string;
  /** Best-effort — the product's slug (no display-name field exists yet), null if unresolvable. */
  productName: string | null;
  signedAtIso: string;
  /** Frozen monthly door price (snapshot_door_price), or null if unparseable. */
  doorPriceEur: number | null;
  /** Earliest 'cancelled' (Widerruf) event time, or null while the deal stands. */
  cancelledAtIso: string | null;
}

/**
 * Read-only projection for the Abschluss-Detail screen (design SSOT 10b). All
 * fields come from the already-synced, append-only local `contracts` row, its
 * `contract_status_events`, and (for the advisor name) the already-synced
 * `app_users` row for the contract own `rep_id` — the wallet/list read
 * pattern, no new sync surface.
 *
 * A field with no reachable source is `null` here and its row is OMITTED by
 * the screen (`AbschlussDetailScreen.buildDetailRows`), never rendered as a
 * dash: a legally binding contract detail view must not state things the data
 * does not carry (CLAUDE.md, no faked data).
 */
export interface ContractDetailRow {
  id: string;
  dealReference: string;
  customerName: string;
  productName: string | null;
  signedAtIso: string;
  createdAtIso: string;
  doorPriceEur: number | null;
  comparisonPriceEur: number | null;
  discountAmountEur: number | null;
  commissionEur: number | null;
  /** Masked IBAN (e.g. "DE44 … 31") parsed from the flow's iban-scan answer, or null. */
  ibanMasked: string | null;
  /**
   * Postal address — STRUCTURALLY unreachable from a contract, always null.
   * See `toContractDetailRow` for why this is not a data gap that a better
   * query could fill.
   */
  addressLine: string | null;
  /** The rep display name from the synced `app_users.full_name`, or null when none synced. */
  advisorName: string | null;
  /**
   * True when this contract was closed on the direct-sign path
   * (`contracts.direct_sign_template_id` set). That path writes no price and
   * no IBAN block, so the screen omits those rows rather than showing a
   * sentinel — see `toContractDetailRow`.
   */
  isDirectSign: boolean;
  /** rep_id uuid — the join key for `advisorName` above. */
  repId: string;
  /** True when the frozen audit package captured a GPS fix at signing. */
  gpsPresent: boolean;
  /** Earliest 'cancelled' (Widerruf) event time, or null while the deal stands. */
  cancelledAtIso: string | null;
}

export interface ContractsRepo {
  insertContract(input: InsertContractInput): Promise<InsertContractResult>;
  /** One-shot newest-first read of the closed-deals list (D-18). */
  listContracts(): Promise<ContractListRow[]>;
  /** Reactive newest-first read of the closed-deals list; returns an unsubscribe function. */
  watchContracts(
    onChange: (rows: ContractListRow[]) => void,
    onError?: (error: unknown) => void,
  ): () => void;
  /** One-shot read of a single contract's detail projection, or null if absent. */
  getContractDetail(contractId: string): Promise<ContractDetailRow | null>;
}

export interface CreateContractsRepoOptions {
  db: AbstractPowerSyncDatabase;
}

/**
 * D-12: offline-generated, collision-free deal reference — pure, no I/O.
 * Format: `FDS-<YYYYMMDD>-<first 8 chars of the given uuid, uppercase>`.
 */
export function generateDealReference(date: Date, uuid: string): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const slice = uuid.slice(0, 8).toUpperCase();
  return `FDS-${year}${month}${day}-${slice}`;
}

interface RawContractListRecord {
  id: string;
  deal_reference: string;
  answers: string;
  product_slug: string | null;
  signed_at: string;
  door_price: string | null;
  /** Non-null marks a direct_pdf contract, whose door_price is a sentinel. */
  direct_sign_template_id: string | null;
  cancelled_at: string | null;
}

/**
 * D-18 read query: newest-first, LEFT JOIN'd with product_definitions for a
 * best-effort product slug (no display-name column exists on either table
 * yet — see 04-09-PLAN.md interfaces note) and with the earliest 'cancelled'
 * (Widerruf) contract_status_event per deal (same pattern as the wallet, so
 * a withdrawn deal renders its reversal in the list). Read-only, no WHERE
 * clause beyond the implicit RLS-scoped sync stream (T-04-05: only
 * locally-synced rows ever exist here, no client-side tenant filter is trusted).
 */
const CONTRACTS_LIST_QUERY = `
  SELECT c.id AS id, c.deal_reference AS deal_reference, c.answers AS answers,
         c.signed_at AS signed_at, pd.slug AS product_slug,
         c.snapshot_door_price AS door_price,
         -- The direct-sign discriminator, so the LIST can interpret the price
         -- sentinel the same way the DETAIL screen already does. Its absence is
         -- why "Meine Abschluesse" printed a bold 0,00 EUR on every PDF deal
         -- while the detail screen for the same deal correctly showed nothing.
         c.direct_sign_template_id AS direct_sign_template_id,
         MIN(ev.occurred_at) AS cancelled_at
  FROM contracts c
  LEFT JOIN product_definitions pd ON pd.id = c.product_definition_id
  LEFT JOIN contract_status_events ev
    ON ev.contract_id = c.id AND ev.event_type = 'cancelled'
  GROUP BY c.id
  ORDER BY c.created_at DESC
`;

/**
 * D-24 identity shape check — shared by both `parseCustomerName` (scans the
 * whole answers map) and `parseIdentityAnswerName` (parses a single id-scan
 * block's raw JSON-serialized answer, see FlowRunnerScreen.deriveSignatureSummary).
 * Single source of truth for "does this value carry a {surname, givenNames}
 * identity" — CR-01: this used to be duplicated/diverged between the two
 * call sites, which let deriveSignatureSummary regress to rendering raw JSON.
 */
function formatStructuredName(value: unknown): string | null {
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>).surname === 'string' &&
    typeof (value as Record<string, unknown>).givenNames === 'string'
  ) {
    const { surname, givenNames } = value as { surname: string; givenNames: string };
    return `${givenNames} ${surname}`.trim();
  }
  return null;
}

/**
 * D-24 identity shape: `{ surname, givenNames }` — parsed out of whichever
 * top-level answer key holds it (the id-scan block's answer key name is not
 * fixed here); falls back to a designated `customerName` string answer, then
 * to the placeholder. Never throws — malformed/absent answers degrade
 * gracefully (frozen legal records must always render something).
 */
export function parseCustomerName(answers: unknown): string {
  if (!answers || typeof answers !== 'object') return t('contracts.unknownCustomer');

  for (const value of Object.values(answers as Record<string, unknown>)) {
    const name = formatStructuredName(value);
    if (name) return name;
  }

  const flat = answers as Record<string, unknown>;
  // A COMPANY outranks a contact person. Where both are captured the customer
  // IS the company — the person is who answered the door, not who is bound by
  // the contract. Checked before customerName for that reason alone.
  if (typeof flat.customerCompany === 'string' && flat.customerCompany.trim()) {
    return flat.customerCompany.trim();
  }
  if (typeof flat.customerName === 'string' && flat.customerName.trim()) {
    return flat.customerName;
  }

  return t('contracts.unknownCustomer');
}

/**
 * QUICK-GTI (Befund 2): derive the customer's name from a flow's answers AT
 * INSERT TIME, for `contracts.customer_name` (0055:38).
 *
 * Why this is not `parseCustomerName`. There is a load-bearing asymmetry in
 * how an id-scan answer is shaped: at INSERT time it is a JSON STRING
 * (`serializeIdFields`), while after a read/sync it is a parsed OBJECT.
 * `parseCustomerName` handles only the object form — reusing it here would
 * silently produce the placeholder for every live signing.
 *
 * Two deliberate differences from the read-side helpers:
 *  - It returns `null`, NEVER `t('contracts.unknownCustomer')`. `contracts` is
 *    append-only (0004 triggers), so a placeholder written here can never be
 *    corrected; /abschluesse already renders a dash for a null, which is the
 *    honest outcome.
 *  - Unlike `parseIdentityAnswerName`, it does NOT fall back to the raw string
 *    on a JSON parse failure. A verbatim fallback is right for a display label
 *    and wrong for a frozen legal column, where it would freeze serialized
 *    JSON (or an unrelated free-text answer) in as the customer's name.
 *
 * Shares `formatStructuredName` with both read-side helpers — CR-01 records
 * that duplicating this shape check has already regressed once.
 */
export function deriveContractCustomerName(answers: unknown): string | null {
  if (!answers || typeof answers !== 'object') return null;

  for (const value of Object.values(answers as Record<string, unknown>)) {
    if (typeof value === 'string') {
      try {
        const name = formatStructuredName(JSON.parse(value));
        if (name) return name;
      } catch {
        // Not JSON — a plain free-text answer. Deliberately NOT used as a
        // name (see the header): only a structured identity counts here.
      }
      continue;
    }
    const name = formatStructuredName(value);
    if (name) return name;
  }

  const flat = answers as Record<string, unknown>;
  // A COMPANY outranks a contact person. Where both are captured the customer
  // IS the company — the person is who answered the door, not who is bound by
  // the contract. Checked before customerName for that reason alone.
  if (typeof flat.customerCompany === 'string' && flat.customerCompany.trim()) {
    return flat.customerCompany.trim();
  }
  if (typeof flat.customerName === 'string' && flat.customerName.trim()) {
    return flat.customerName.trim();
  }

  return null;
}

/**
 * D-24: parses a SINGLE id-scan block's raw answer value (as stored by
 * `serializeIdFields` — a JSON-serialized `{surname, givenNames, ...}`
 * string) into a display name. Used by FlowRunnerScreen.deriveSignatureSummary
 * for the signature/success-screen customer label — shares
 * `formatStructuredName` with `parseCustomerName` above so the two can never
 * diverge again (CR-01/IN-02: this used to be a second, independently
 * maintained implementation that regressed to rendering raw JSON). Never
 * throws — legacy plain-string answers (pre-D-24) are returned verbatim.
 */
export function parseIdentityAnswerName(rawAnswer: unknown): string {
  if (typeof rawAnswer !== 'string') return '';
  try {
    const parsed: unknown = JSON.parse(rawAnswer);
    const name = formatStructuredName(parsed);
    if (name) return name;
  } catch {
    // fall through — legacy plain-string answers, if any
  }
  return rawAnswer;
}

/** Parse a synced numeric TEXT (PowerSync serializes numeric→text) to a number,
 * or null for null/unparseable input — never NaN (mirrors walletRepo). */
export function parseNumericText(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function toContractListRow(record: RawContractListRecord): ContractListRow {
  let parsedAnswers: unknown = null;
  try {
    parsedAnswers = JSON.parse(record.answers);
  } catch {
    parsedAnswers = null;
  }

  return {
    id: record.id,
    dealReference: record.deal_reference,
    customerName: parseCustomerName(parsedAnswers),
    productName: record.product_slug ?? null,
    signedAtIso: record.signed_at,
    // Same sentinel translation as toContractDetailRow: a direct_pdf contract
    // has no captured price, and 0 there means "not captured", never "free".
    doorPriceEur:
      record.direct_sign_template_id != null ? null : parseNumericText(record.door_price),
    cancelledAtIso: record.cancelled_at ?? null,
  };
}

/**
 * Extracts an IBAN-shaped string from a flow's answers map (the iban-scan
 * block stores the validated IBAN as its plain string answer, keyed by the
 * block id — which is not fixed here). Pure/exported for direct unit testing.
 * Returns the first value matching the IBAN structure (2 letters + 2 check
 * digits + 10–30 alphanumerics, tolerant of spaces), uppercased/spaces
 * stripped; null when no answer looks like an IBAN.
 */
export function extractIbanFromAnswers(answers: unknown): string | null {
  if (!answers || typeof answers !== 'object') return null;
  for (const value of Object.values(answers as Record<string, unknown>)) {
    if (typeof value !== 'string') continue;
    const compact = value.replace(/\s+/g, '').toUpperCase();
    if (/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(compact)) return compact;
  }
  return null;
}

/**
 * Masks an IBAN for display (design SSOT "DE44 … 31"): keeps the country +
 * check digits and the final two chars, eliding the middle. Pure/exported.
 * Never throws — a too-short/empty value returns null.
 */
export function maskIban(iban: string | null): string | null {
  if (!iban) return null;
  const compact = iban.replace(/\s+/g, '').toUpperCase();
  if (compact.length < 6) return null;
  return `${compact.slice(0, 4)} … ${compact.slice(-2)}`;
}

/** True when the frozen audit package JSON carries a non-null GPS fix. */
export function auditPackageHasGps(auditPackageJson: string | null): boolean {
  if (!auditPackageJson) return false;
  try {
    const parsed: unknown = JSON.parse(auditPackageJson);
    return Boolean(
      parsed &&
        typeof parsed === 'object' &&
        (parsed as Record<string, unknown>).gps !== null &&
        (parsed as Record<string, unknown>).gps !== undefined,
    );
  } catch {
    return false;
  }
}

interface RawContractDetailRecord {
  id: string;
  deal_reference: string;
  answers: string;
  product_slug: string | null;
  signed_at: string;
  created_at: string;
  door_price: string | null;
  comparison_price: string | null;
  discount_amount: string | null;
  rate: string | null;
  rate_type: string | null;
  base: string | null;
  audit_package: string | null;
  rep_id: string;
  advisor_name: string | null;
  direct_sign_template_id: string | null;
  cancelled_at: string | null;
}

/**
 * Single-contract detail projection (design SSOT 10b). Same read-only, RLS-/
 * sync-scoped posture as the list query — every column is already on-device on
 * the append-only `contracts` row; the earliest 'cancelled' event is LEFT
 * JOIN'd (Widerruf reversal). No new sync surface, no server round-trip.
 *
 * `app_users` is LEFT JOIN'd on the contract own `rep_id` for the advisor
 * display name. That column has been on the sync stream since Phase 12
 * (`0072_app_users_profile_columns.sql`), and `map/db/assignableRepsRepo.ts`
 * already joins `memberships -> app_users` for exactly this purpose — so this
 * exposes no new data class and adds no sync surface (T-f98-05).
 *
 * `GROUP BY c.id` is unaffected by the two added columns: both are bare
 * single-row columns of `c`/`au`, not aggregates, so `MIN(ev.occurred_at)`
 * still collapses only the status-event join.
 */
const CONTRACT_DETAIL_QUERY = `
  SELECT c.id AS id, c.deal_reference AS deal_reference, c.answers AS answers,
         c.signed_at AS signed_at, c.created_at AS created_at,
         pd.slug AS product_slug,
         c.snapshot_door_price       AS door_price,
         c.snapshot_comparison_price AS comparison_price,
         c.snapshot_discount_amount  AS discount_amount,
         c.commission_rate_snapshot  AS rate,
         c.commission_rate_type       AS rate_type,
         c.commission_base_snapshot  AS base,
         c.audit_package             AS audit_package,
         c.rep_id                    AS rep_id,
         au.full_name                AS advisor_name,
         c.direct_sign_template_id   AS direct_sign_template_id,
         MIN(ev.occurred_at)         AS cancelled_at
  FROM contracts c
  LEFT JOIN product_definitions pd ON pd.id = c.product_definition_id
  LEFT JOIN app_users au ON au.id = c.rep_id
  LEFT JOIN contract_status_events ev
    ON ev.contract_id = c.id AND ev.event_type = 'cancelled'
  WHERE c.id = ?
  GROUP BY c.id
`;

/** Pure mapper for the detail projection. Never throws; a missing or
 * unparseable source degrades to null, and the screen then omits that row
 * entirely (`AbschlussDetailScreen.buildDetailRows`) — never fabricated,
 * never blanked with a dash. */
export function toContractDetailRow(record: RawContractDetailRecord): ContractDetailRow {
  let parsedAnswers: unknown = null;
  try {
    parsedAnswers = JSON.parse(record.answers);
  } catch {
    parsedAnswers = null;
  }

  const rateType =
    record.rate_type === 'flat_eur' || record.rate_type === 'percent' ? record.rate_type : null;

  // `contracts.direct_sign_template_id` is set ONLY on the direct-sign path,
  // which makes it the reliable discriminator for the sentinel below.
  const isDirectSign =
    typeof record.direct_sign_template_id === 'string' && record.direct_sign_template_id.length > 0;

  const advisorNameRaw = typeof record.advisor_name === 'string' ? record.advisor_name.trim() : '';

  // ROOT CAUSE of the reported "0,00 € mtl.": `direct-sign/completeDirectSign.ts`
  // inserts `snapshot: { doorPrice: 0, comparisonPrice: null, ... }` — a
  // SENTINEL meaning "this path has no price block", not a price of zero.
  // `contracts` is append-only (0004 triggers), so already-signed rows cannot
  // be rewritten, and fixing the write path would not correct a single
  // existing contract; this read projection is the only honest place to
  // interpret the sentinel back into "no price". Rewriting
  // `completeDirectSign.ts` is deliberately NOT done here — it would need its
  // own audit-package reasoning.
  const doorPriceEur = isDirectSign ? null : parseNumericText(record.door_price);

  return {
    id: record.id,
    dealReference: record.deal_reference,
    customerName: parseCustomerName(parsedAnswers),
    productName: record.product_slug ?? null,
    signedAtIso: record.signed_at,
    createdAtIso: record.created_at,
    doorPriceEur,
    comparisonPriceEur: parseNumericText(record.comparison_price),
    discountAmountEur: parseNumericText(record.discount_amount),
    commissionEur: computeCommissionEur(
      rateType,
      parseNumericText(record.rate),
      parseNumericText(record.base),
    ),
    ibanMasked: maskIban(extractIbanFromAnswers(parsedAnswers)),
    // STRUCTURALLY unreachable, not merely unqueried: `houses.address` DOES
    // exist (0083), but a contract has no way to reach a house. `contracts`
    // carries no `house_id` and no draft reference; only `flow_drafts.house_id`
    // links a draft to a house, and the contract keeps no pointer back to its
    // draft. There is no join to write. The field and its null stay so the
    // screen keeps omitting the row deliberately rather than by accident.
    addressLine: null,
    // `app_users.full_name`, LEFT JOIN'd above. The previous claim here — that
    // no display-name column syncs down — was stale: `app_users` has carried
    // `full_name` on the sync stream since Phase 12
    // (`0072_app_users_profile_columns.sql`), and both
    // `map/db/assignableRepsRepo.ts` and `ProfileEditScreen.tsx` already read
    // it. Empty or whitespace-only becomes null; the repo layer never invents
    // a placeholder.
    advisorName: advisorNameRaw.length > 0 ? advisorNameRaw : null,
    isDirectSign,
    repId: record.rep_id,
    gpsPresent: auditPackageHasGps(record.audit_package),
    cancelledAtIso: record.cancelled_at ?? null,
  };
}

/**
 * D-22: pure sync-state derivation from the local PowerSync CRUD upload
 * queue — never a DB status column (the set-once `status` column is a legal
 * state, not a sync indicator). `pendingIds` is the set of contract ids
 * still present in the local queue (see connector's getCrudBatch, read-only,
 * never .complete()'d by this read path).
 */
export function deriveContractSyncState(
  contractId: string,
  pendingIds: ReadonlySet<string> | readonly string[],
): 'pending' | 'synced' {
  const set = pendingIds instanceof Set ? pendingIds : new Set(pendingIds);
  return set.has(contractId) ? 'pending' : 'synced';
}

/**
 * The other half of the D-22 derivation: which `contracts` rows a raw CRUD
 * batch (as returned by `db.getCrudBatch`) still has queued.
 *
 * Lives HERE, next to `deriveContractSyncState`, because the two are one
 * derivation split across two calls and every caller needs both. It used to
 * sit in `ContractListScreen.tsx`, which meant reusing it dragged a screenful
 * of react-native/ui imports along — enough friction that the success screen
 * hardcoded `syncPending: true` instead. `ContractListScreen` re-exports it so
 * its existing importers and tests are untouched.
 */
export function extractPendingContractIds(
  crudEntries: ReadonlyArray<{ table: string; id: string }>,
): Set<string> {
  return new Set(
    crudEntries.filter((entry) => entry.table === 'contracts').map((entry) => entry.id),
  );
}

/**
 * "Is THIS contract still sitting in the local upload queue?" — the honest
 * answer to the only question the success screen's transfer card asks.
 *
 * The screen used to be told `syncPending: true` unconditionally, justified as
 * "always true right after an offline insert". True offline; wrong online,
 * which is the case a rep sees most of the time — so after every single deal
 * the app claimed the contract was waiting for a network it already had. A
 * status line that is right by construction is a status line nobody reads,
 * and this one sits directly above "PDF an Kunde".
 */
export function deriveContractSyncPending(
  contractId: string,
  crudEntries: ReadonlyArray<{ table: string; id: string }>,
): boolean {
  return deriveContractSyncState(contractId, extractPendingContractIds(crudEntries)) === 'pending';
}

// CR-02: `OR IGNORE` on the primary key makes this idempotent for a caller
// that derives `id` deterministically per draft — a retry that races (or
// follows) an earlier already-persisted insert becomes a silent no-op
// instead of a second contract row. Still append-only (no ON CONFLICT
// UPDATE clause is ever used — see module doc / 0004 triggers).
const CONTRACT_INSERT_SQL = `INSERT OR IGNORE INTO contracts (
  id, company_id, rep_id, team_id, status,
  product_definition_id, product_version, terms_id, terms_version, answers,
  snapshot_door_price, snapshot_comparison_price, snapshot_discount_amount, snapshot_terms_text,
  audit_package, package_hash_sha256, deal_reference, signature_attachment_id, signed_at, created_at,
  direct_sign_template_id, redeemed_lead_id, customer_name, house_id
) VALUES (?, ?, ?, ?, 'signed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const CONTRACT_BY_ID_SQL = `SELECT id, deal_reference AS deal_reference FROM contracts WHERE id = ?`;

/** Injectable repo (options-object DI, matches createFlowDraftsRepo). */
export function createContractsRepo(options: CreateContractsRepoOptions): ContractsRepo {
  const { db } = options;

  return {
    async insertContract(input) {
      const id = input.id ?? Crypto.randomUUID();
      const now = new Date().toISOString();
      const dealReference = input.dealReference ?? generateDealReference(new Date(), id);

      await db.execute(CONTRACT_INSERT_SQL, [
        id,
        input.companyId,
        input.repId,
        input.teamId,
        input.productDefinitionId,
        input.productVersion,
        // terms_id is a uuid column server-side — the EMPTY_SNAPSHOT
        // placeholder ('' when no discount block captured a snapshot) must
        // become NULL, or PostgREST rejects the row ("invalid input syntax
        // for type uuid") and the upload queue retries forever.
        input.termsId || null,
        input.termsId ? input.termsVersion : null,
        JSON.stringify(input.answers),
        input.snapshot.doorPrice,
        input.snapshot.comparisonPrice,
        input.snapshot.discountAmount,
        input.snapshot.termsText,
        JSON.stringify(input.auditPackage),
        input.packageHashSha256,
        dealReference,
        input.signatureAttachmentId || null,
        input.signedAtIso,
        now,
        input.directSignTemplateId || null,
        input.redeemedLeadId || null,
        // QUICK-GTI: derived HERE rather than at the call sites, so the
        // direct-sign path (completeDirectSign.ts) is covered without being
        // touched. `|| null` coalesces a blank explicit value to NULL — an
        // empty string in a legal column is a worse lie than a null.
        input.customerName?.trim() || deriveContractCustomerName(input.answers),
        // 0101: which door this came from. Until now the link existed only on
        // the draft and pointed forward, so nothing could ask a contract where
        // it was signed — the question Phase 23's reporting has to answer.
        input.houseId || null,
      ]);

      // CR-02: with `INSERT OR IGNORE`, a retry with the same deterministic
      // `id` silently no-ops above — re-read the row so the caller always
      // gets back the ACTUALLY persisted id/dealReference (the first
      // successful insert's values), never a value that only existed in
      // this call's local variables.
      const rows = await db.getAll<{ id: string; deal_reference: string }>(CONTRACT_BY_ID_SQL, [id]);
      const persisted = rows[0];
      return persisted
        ? { id: persisted.id, dealReference: persisted.deal_reference }
        : { id, dealReference };
    },

    async listContracts() {
      const rows = await db.getAll<RawContractListRecord>(CONTRACTS_LIST_QUERY);
      return rows.map(toContractListRow);
    },

    async getContractDetail(contractId) {
      const rows = await db.getAll<RawContractDetailRecord>(CONTRACT_DETAIL_QUERY, [contractId]);
      const record = rows[0];
      if (!record) return null;
      return toContractDetailRow(record);
    },

    watchContracts(onChange, onError) {
      const controller = new AbortController();
      db.watch(
        CONTRACTS_LIST_QUERY,
        [],
        {
          onResult: (result) => {
            const rows = (result.rows?._array ?? []) as RawContractListRecord[];
            onChange(rows.map(toContractListRow));
          },
          onError: (error) => onError?.(error),
        },
        { signal: controller.signal },
      );
      return () => controller.abort();
    },
  };
}
