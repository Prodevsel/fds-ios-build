import type { AbstractPowerSyncDatabase } from '@powersync/common';
import type { Block } from '@frontdoorsales/flow-schema';

/**
 * Local-SQLite mirror of `product_definitions` (0021_product_definitions.sql
 * / schema.ts). SERVER-WRITTEN ONLY (publish CLI, 03-04) — this repo is
 * read-only (no insert/update methods), mirroring product_definitions'
 * connector posture (any client write is rejected loudly).
 *
 * `blocks` is jsonb mirrored as text (PowerSync/PostgREST serialization,
 * like territories.boundary) — JSON.parse'd into typed `Block[]` here.
 *
 * D-09 version selection: `getLatestPublished` returns the highest-version
 * `status='published'` row (a NEWLY started flow always takes this); a
 * running/drafted flow instead re-reads its EXACT pinned version via
 * `getVersion` — never re-selects latest mid-flow (keeps the notice text
 * pinned, legally required). `getVersion` has no status filter: a tester
 * (is_tester) may run a Draft version, already visibility-gated server-side
 * (03-02's visibility function + sync stream) — a non-tester's local SQLite
 * simply never has a draft row synced down, so no client-side filter is
 * needed here (D-10).
 */
export interface ProductDefinitionRow {
  id: string;
  company_id: string;
  slug: string;
  version: number;
  status: 'draft' | 'published';
  blocks: Block[];
  /**
   * 0069: 'flow_form' runs FlowRunnerScreen's block-per-screen wizard,
   * 'direct_pdf' routes to DirectSignFlowScreen instead. The column existed in
   * Postgres and in the synced client schema but was never SELECTed here, so
   * the app could not tell the two apart and every product ran as a wizard.
   */
  contract_mode: 'flow_form' | 'direct_pdf';
  /** The direct_sign_templates row backing a direct_pdf product; null otherwise. */
  direct_sign_template_id: string | null;
  created_at: string;
}

interface RawProductDefinitionRecord {
  id: string;
  company_id: string;
  slug: string;
  version: string;
  status: string;
  blocks: string;
  contract_mode: string | null;
  direct_sign_template_id: string | null;
  created_at: string;
}

const PRODUCT_DEFINITIONS_LATEST_PUBLISHED_QUERY = `
  SELECT id, company_id, slug, version, status, blocks, contract_mode, direct_sign_template_id, created_at
  FROM product_definitions
  WHERE slug = ? AND status = 'published'
  ORDER BY CAST(version AS INTEGER) DESC
  LIMIT 1
`;

/** D-09: exact pinned-version re-read (no status filter — a tester's Draft row is already the only draft row locally synced, D-10). */
/**
 * Every product the rep may actually sell, newest published version per slug.
 *
 * D-09 (no product picker) is finally answerable: what a rep can sell is the
 * set RLS and the sync stream already put on this device — never a slug
 * compiled into the build. The GROUP BY takes the highest published version of
 * each slug, the same rule getLatestPublished applies to a single slug.
 *
 * SQLite's bare-column rule with MAX() is what keeps this one statement: the
 * other columns come from the row that produced the maximum. That is a
 * documented SQLite guarantee rather than an accident, but it is SQLite-
 * specific, so the note stays next to the query.
 */
const PRODUCT_DEFINITIONS_SELLABLE_QUERY = `
  SELECT id, company_id, slug, MAX(CAST(version AS INTEGER)) AS version, status, blocks,
         contract_mode, direct_sign_template_id, created_at
  FROM product_definitions
  WHERE status = 'published'
  GROUP BY slug
  ORDER BY slug
`;

const PRODUCT_DEFINITIONS_EXACT_VERSION_QUERY = `
  SELECT id, company_id, slug, version, status, blocks, contract_mode, direct_sign_template_id, created_at
  FROM product_definitions
  WHERE slug = ? AND version = ?
  LIMIT 1
`;

function toProductDefinitionRow(record: RawProductDefinitionRecord): ProductDefinitionRow {
  return {
    id: record.id,
    company_id: record.company_id,
    slug: record.slug,
    version: Number(record.version),
    status: record.status as ProductDefinitionRow['status'],
    blocks: JSON.parse(record.blocks) as Block[],
    contract_mode: record.contract_mode === 'direct_pdf' ? 'direct_pdf' : 'flow_form',
    direct_sign_template_id: record.direct_sign_template_id ?? null,
    created_at: record.created_at,
  };
}

export interface CreateProductDefinitionsRepoOptions {
  db: AbstractPowerSyncDatabase;
}

export interface ProductDefinitionsRepo {
  /** Reactive query for the latest published version of a product by slug. */
  watchProductBySlug(
    slug: string,
    onChange: (product: ProductDefinitionRow | null) => void,
    onError?: (error: unknown) => void,
  ): () => void;
  /** One-shot fetch of the latest locally-available published version (D-09: a NEWLY started flow always uses this). */
  getProductBySlug(slug: string): Promise<ProductDefinitionRow | null>;
  /** D-09: same query as getProductBySlug, named for the version-selection call site — a NEWLY started flow's source of truth. */
  getLatestPublished(slug: string): Promise<ProductDefinitionRow | null>;
  /** D-09: exact pinned-version re-read for a running/drafted flow — never re-selects latest mid-flow. */
  getVersion(slug: string, version: number): Promise<ProductDefinitionRow | null>;
  /** Every sellable product on this device — the product picker's source (D-09). */
  listSellable(): Promise<ProductDefinitionRow[]>;
}

/**
 * Injectable repo (options-object DI, matches createHousesRepo) wrapping the
 * PowerSync db handle. Read-only: product_definitions is server-written only.
 */
export function createProductDefinitionsRepo(
  options: CreateProductDefinitionsRepoOptions,
): ProductDefinitionsRepo {
  const { db } = options;

  return {
    watchProductBySlug(slug, onChange, onError) {
      const controller = new AbortController();
      db.watch(
        PRODUCT_DEFINITIONS_LATEST_PUBLISHED_QUERY,
        [slug],
        {
          onResult: (result) => {
            const rows = (result.rows?._array ?? []) as RawProductDefinitionRecord[];
            onChange(rows[0] ? toProductDefinitionRow(rows[0]) : null);
          },
          onError: (error) => onError?.(error),
        },
        { signal: controller.signal },
      );
      return () => controller.abort();
    },

    async getProductBySlug(slug) {
      const rows = await db.getAll<RawProductDefinitionRecord>(
        PRODUCT_DEFINITIONS_LATEST_PUBLISHED_QUERY,
        [slug],
      );
      return rows[0] ? toProductDefinitionRow(rows[0]) : null;
    },

    async getLatestPublished(slug) {
      const rows = await db.getAll<RawProductDefinitionRecord>(
        PRODUCT_DEFINITIONS_LATEST_PUBLISHED_QUERY,
        [slug],
      );
      return rows[0] ? toProductDefinitionRow(rows[0]) : null;
    },

    async listSellable() {
      const rows = await db.getAll<RawProductDefinitionRecord>(PRODUCT_DEFINITIONS_SELLABLE_QUERY);
      return rows.map(toProductDefinitionRow);
    },

    async getVersion(slug, version) {
      const rows = await db.getAll<RawProductDefinitionRecord>(PRODUCT_DEFINITIONS_EXACT_VERSION_QUERY, [
        slug,
        version,
      ]);
      return rows[0] ? toProductDefinitionRow(rows[0]) : null;
    },
  };
}
