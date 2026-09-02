import type { AbstractPowerSyncDatabase } from '@powersync/common';

/**
 * Local-SQLite mirror of `discount_terms` (0022_discount_terms.sql /
 * schema.ts). SERVER-WRITTEN ONLY (publish CLI, 03-04) — read-only repo,
 * mirroring discount_terms' connector posture (any client write rejected).
 *
 * Referenced by the discount block's `termsRef` (D-17) — never embedded in
 * the product definition JSON, so a company can change terms without
 * publishing a new product version.
 */
export interface DiscountTermsRow {
  id: string;
  company_id: string;
  product_slug: string;
  version: number;
  status: 'draft' | 'published';
  type: 'markdown' | 'standalone';
  door_price: number;
  /** Struck-through online price (D-16) — null for a standalone (no online counterpart) variant. */
  comparison_price: number | null;
  /**
   * 0090 (H02/D-1) — the ONE-TIME setup position. `null` means no setup fee is
   * stated; `0` means it is waived. Downstream renderers must therefore branch
   * on `!== null`, never on truthiness, or a waived fee silently disappears.
   */
  setup_fee: number | null;
  /** 0090 — the struck-through regular counterpart of setup_fee, or null. */
  setup_fee_comparison: number | null;
  /** 0090 — minimum contract term in months, or null when none is stated. */
  minimum_term_months: number | null;
  /** 0090/D-5 — tenant-authored price disclosure. DISPLAY ONLY, never arithmetic. */
  price_note: string | null;
  terms_text: string;
  created_at: string;
}

interface RawDiscountTermsRecord {
  id: string;
  company_id: string;
  product_slug: string;
  version: string;
  status: string;
  type: string;
  door_price: string;
  comparison_price: string | null;
  setup_fee: string | null;
  setup_fee_comparison: string | null;
  minimum_term_months: string | null;
  price_note: string | null;
  terms_text: string;
  created_at: string;
}

const DISCOUNT_TERMS_BY_ID_QUERY = `
  SELECT id, company_id, product_slug, version, status, type, door_price, comparison_price,
         setup_fee, setup_fee_comparison, minimum_term_months, price_note, terms_text, created_at
  FROM discount_terms
  WHERE id = ?
`;

function toDiscountTermsRow(record: RawDiscountTermsRecord): DiscountTermsRow {
  return {
    id: record.id,
    company_id: record.company_id,
    product_slug: record.product_slug,
    version: Number(record.version),
    status: record.status as DiscountTermsRow['status'],
    type: record.type as DiscountTermsRow['type'],
    door_price: Number(record.door_price),
    comparison_price: record.comparison_price !== null ? Number(record.comparison_price) : null,
    // Same `!== null ? Number(...) : null` shape as comparison_price above:
    // a stated 0 must survive as 0, not collapse into null.
    setup_fee: record.setup_fee !== null ? Number(record.setup_fee) : null,
    setup_fee_comparison:
      record.setup_fee_comparison !== null ? Number(record.setup_fee_comparison) : null,
    minimum_term_months:
      record.minimum_term_months !== null ? Number(record.minimum_term_months) : null,
    price_note: record.price_note,
    terms_text: record.terms_text,
    created_at: record.created_at,
  };
}

export interface CreateDiscountTermsRepoOptions {
  db: AbstractPowerSyncDatabase;
}

export interface DiscountTermsRepo {
  getTermsById(id: string): Promise<DiscountTermsRow | null>;
}

/** Injectable repo (options-object DI, matches createHousesRepo). Read-only. */
export function createDiscountTermsRepo(options: CreateDiscountTermsRepoOptions): DiscountTermsRepo {
  const { db } = options;

  return {
    async getTermsById(id) {
      const rows = await db.getAll<RawDiscountTermsRecord>(DISCOUNT_TERMS_BY_ID_QUERY, [id]);
      return rows[0] ? toDiscountTermsRow(rows[0]) : null;
    },
  };
}
