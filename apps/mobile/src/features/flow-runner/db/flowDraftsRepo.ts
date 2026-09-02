import type { AbstractPowerSyncDatabase } from '@powersync/common';
import * as Crypto from 'expo-crypto';

/**
 * Local-SQLite mirror of `flow_drafts` (0023_flow_drafts.sql / schema.ts).
 * Device-local, single-writer (D-04 auto-save, D-09 version pinning) — full
 * read+write, exactly like housesRepo's LWW-ACCEPTABLE template: plain local
 * `INSERT`/`UPDATE`, never an upsert/ON CONFLICT call (02-08 42501 trap).
 *
 * All writes here are local-only (Iron Rule 1) — the CRUD upload queue is
 * drained by connector.ts's `applyFlowDraftOperation` whenever the PowerSync
 * connection is up.
 */
export interface FlowDraftRow {
  id: string;
  created_by: string;
  house_id: string | null;
  product_definition_id: string | null;
  product_version: number | null;
  terms_id: string | null;
  terms_version: number | null;
  territory_id: string | null;
  status: 'in_progress' | 'completed' | 'discarded';
  answers: Record<string, unknown>;
  is_test: boolean;
  snapshot_door_price: number | null;
  snapshot_comparison_price: number | null;
  snapshot_discount_amount: number | null;
  snapshot_terms_text: string | null;
  created_at: string;
  updated_at: string;
}

interface RawFlowDraftRecord {
  id: string;
  created_by: string;
  house_id: string | null;
  product_definition_id: string | null;
  product_version: string | null;
  terms_id: string | null;
  terms_version: string | null;
  territory_id: string | null;
  status: string;
  answers: string;
  is_test: string;
  snapshot_door_price: string | null;
  snapshot_comparison_price: string | null;
  snapshot_discount_amount: string | null;
  snapshot_terms_text: string | null;
  created_at: string;
  updated_at: string;
}

const FLOW_DRAFT_COLUMNS = `
  id, created_by, house_id, product_definition_id, product_version, terms_id,
  terms_version, territory_id, status, answers, is_test, snapshot_door_price,
  snapshot_comparison_price, snapshot_discount_amount, snapshot_terms_text,
  created_at, updated_at
`;

function toFlowDraftRow(record: RawFlowDraftRecord): FlowDraftRow {
  return {
    id: record.id,
    created_by: record.created_by,
    house_id: record.house_id,
    product_definition_id: record.product_definition_id,
    product_version: record.product_version !== null ? Number(record.product_version) : null,
    terms_id: record.terms_id,
    terms_version: record.terms_version !== null ? Number(record.terms_version) : null,
    territory_id: record.territory_id,
    status: record.status as FlowDraftRow['status'],
    answers: record.answers ? (JSON.parse(record.answers) as Record<string, unknown>) : {},
    is_test: record.is_test === '1' || record.is_test === 'true',
    snapshot_door_price: record.snapshot_door_price !== null ? Number(record.snapshot_door_price) : null,
    snapshot_comparison_price:
      record.snapshot_comparison_price !== null ? Number(record.snapshot_comparison_price) : null,
    snapshot_discount_amount:
      record.snapshot_discount_amount !== null ? Number(record.snapshot_discount_amount) : null,
    snapshot_terms_text: record.snapshot_terms_text,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

export interface CreateFlowDraftsRepoOptions {
  db: AbstractPowerSyncDatabase;
}

export interface InsertDraftInput {
  houseId: string;
  productDefinitionId: string;
  productVersion: number;
  createdBy: string;
  /** Null when the flow was started off-territory (e.g. a fixture house). */
  territoryId?: string | null;
  /** D-11: a tester's completion, never delivered to a company by Phase 5's partner API/webhooks. */
  isTest?: boolean;
}

/** D-19 attribution snapshot — frozen at block render/confirm time (Pitfall 4), forwarded here unchanged. */
export interface CompletionSnapshot {
  doorPrice: number;
  comparisonPrice: number | null;
  discountAmount: number | null;
  termsText: string;
  /** Gap 2A (03-UAT.md): attribution to the exact terms row/version displayed. */
  termsId: string;
  termsVersion: number;
}

export interface FlowDraftsRepo {
  /** D-04: the single in_progress draft (if any) already attached to this house — resume, never duplicate. */
  getDraftForHouse(houseId: string): Promise<FlowDraftRow | null>;
  insertDraft(input: InsertDraftInput): Promise<string>;
  /** D-04: auto-saves a single answer immediately — never batched/debounced. */
  saveAnswer(draftId: string, fieldId: string, value: unknown): Promise<void>;
  /** Forwards the already-frozen discount snapshot (D-19/Pitfall 4) — never recomputes it. */
  markCompleted(draftId: string, snapshot: CompletionSnapshot): Promise<void>;
  /**
   * D-04 auto-save-on-capture primitive (Gap 2 defect B, 03-UAT.md): persists
   * the frozen snapshot to the draft row immediately, WITHOUT completing the
   * flow — status stays in_progress. Plain UPDATE only, never ON CONFLICT
   * (02-08 42501 trap). Consumed by Plan 03-09's screen wiring.
   */
  saveSnapshot(draftId: string, snapshot: CompletionSnapshot): Promise<void>;
  discardDraft(draftId: string): Promise<void>;
}

/**
 * Resume re-hydration mapper (Gap 2 defect B, 03-UAT.md): the frozen
 * snapshot previously lived ONLY in transient screen useState, lost on
 * remount/app-restart mid-flow. Maps an already-persisted draft row back
 * into a CompletionSnapshot, or returns null when no snapshot has been
 * captured yet (discount block not reached). Pure — no db access.
 */
export function snapshotFromDraftRow(row: FlowDraftRow): CompletionSnapshot | null {
  if (row.snapshot_door_price === null) {
    return null;
  }
  return {
    doorPrice: row.snapshot_door_price,
    comparisonPrice: row.snapshot_comparison_price,
    discountAmount: row.snapshot_discount_amount,
    termsText: row.snapshot_terms_text as string,
    termsId: row.terms_id as string,
    termsVersion: row.terms_version as number,
  };
}

/** Injectable repo (options-object DI, matches createHousesRepo) wrapping the PowerSync db handle. */
export function createFlowDraftsRepo(options: CreateFlowDraftsRepoOptions): FlowDraftsRepo {
  const { db } = options;

  return {
    async getDraftForHouse(houseId) {
      const rows = await db.getAll<RawFlowDraftRecord>(
        `SELECT ${FLOW_DRAFT_COLUMNS} FROM flow_drafts WHERE house_id = ? AND status = 'in_progress' ORDER BY created_at DESC LIMIT 1`,
        [houseId],
      );
      const row = rows[0];
      return row ? toFlowDraftRow(row) : null;
    },

    async insertDraft({
      houseId,
      productDefinitionId,
      productVersion,
      createdBy,
      territoryId = null,
      isTest = false,
    }) {
      const id = Crypto.randomUUID();
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO flow_drafts (
          id, created_by, house_id, product_definition_id, product_version,
          territory_id, status, answers, is_test, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'in_progress', '{}', ?, ?, ?)`,
        [id, createdBy, houseId, productDefinitionId, productVersion, territoryId, isTest ? 1 : 0, now, now],
      );
      return id;
    },

    async saveAnswer(draftId, fieldId, value) {
      // SQLite json1 json_set (already used by connector.ts's ps_data__
      // revert paths) — the path is built from the field id and bound as a
      // parameter, never string-interpolated into the SQL text itself.
      // WR-04: the field id is embedded INSIDE that bound path expression's
      // own `"..."` object-key syntax, so a literal `"` in fieldId would
      // still break the json_set path — escape it here.
      const path = `$."${fieldId.replace(/"/g, '\\"')}"`;
      await db.execute(
        `UPDATE flow_drafts SET answers = json_set(answers, ?, json(?)), updated_at = ? WHERE id = ?`,
        [path, JSON.stringify(value), new Date().toISOString(), draftId],
      );
    },

    async markCompleted(draftId, snapshot) {
      // Gap 2A (03-UAT.md): terms_id/terms_version (migration 0023) were
      // never written by any path — bind them here alongside the existing
      // D-19 snapshot columns.
      await db.execute(
        `UPDATE flow_drafts SET status = 'completed', snapshot_door_price = ?, snapshot_comparison_price = ?,
          snapshot_discount_amount = ?, snapshot_terms_text = ?, terms_id = ?, terms_version = ?, updated_at = ? WHERE id = ?`,
        [
          snapshot.doorPrice,
          snapshot.comparisonPrice,
          snapshot.discountAmount,
          snapshot.termsText,
          // terms_id is uuid server-side: EMPTY_SNAPSHOT's '' placeholder
          // must become NULL or the PostgREST upload 400s ("invalid input
          // syntax for type uuid") and poisons the whole CRUD queue.
          snapshot.termsId || null,
          snapshot.termsId ? snapshot.termsVersion : null,
          new Date().toISOString(),
          draftId,
        ],
      );
    },

    async saveSnapshot(draftId, snapshot) {
      // D-04 auto-save-on-capture (Gap 2 defect B primitive) — status is
      // deliberately NOT touched here; only markCompleted transitions status.
      // Plain UPDATE, never ON CONFLICT/upsert (02-08 42501 trap).
      await db.execute(
        `UPDATE flow_drafts SET snapshot_door_price = ?, snapshot_comparison_price = ?,
          snapshot_discount_amount = ?, snapshot_terms_text = ?, terms_id = ?, terms_version = ?, updated_at = ? WHERE id = ?`,
        [
          snapshot.doorPrice,
          snapshot.comparisonPrice,
          snapshot.discountAmount,
          snapshot.termsText,
          // terms_id is uuid server-side: EMPTY_SNAPSHOT's '' placeholder
          // must become NULL or the PostgREST upload 400s ("invalid input
          // syntax for type uuid") and poisons the whole CRUD queue.
          snapshot.termsId || null,
          snapshot.termsId ? snapshot.termsVersion : null,
          new Date().toISOString(),
          draftId,
        ],
      );
    },

    async discardDraft(draftId) {
      await db.execute(`UPDATE flow_drafts SET status = 'discarded', updated_at = ? WHERE id = ?`, [
        new Date().toISOString(),
        draftId,
      ]);
    },
  };
}
