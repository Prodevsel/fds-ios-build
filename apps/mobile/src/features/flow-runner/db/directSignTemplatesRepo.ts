import type { AbstractPowerSyncDatabase } from '@powersync/common';
import {
  directSignFieldPlacementsSchema,
  type DirectSignFieldPlacement,
} from '@frontdoorsales/flow-schema';

/**
 * Local-SQLite mirror of `direct_sign_templates` (0066 / schema.ts).
 * SERVER-WRITTEN ONLY — the admin upload/placement step is the sole writer and
 * the connector rejects any client write, so this repo is read-only.
 *
 * Every synced column is `column.text` by schema.ts convention; the numeric
 * placement fields are parsed HERE rather than at the call site, so no caller
 * has to remember that `signature_x_frac` arrives as a string.
 */
export interface DirectSignTemplateRow {
  id: string;
  company_id: string;
  /** Path inside the `direct-sign-templates` bucket (0067). */
  storage_path: string;
  /** The operator-published original's hash — the value a download is checked against. */
  sha256: string;
  /** 1-based page the signature belongs on; null until the placement step ran. */
  signature_page: number | null;
  /** Normalized 0-1 fractions of page width/height (0066), never raw pixels. */
  signature_x_frac: number | null;
  signature_y_frac: number | null;
  status: 'draft' | 'published';
  /** 0085: variable anchors for the customer's answers; empty when none were placed. */
  field_placements: DirectSignFieldPlacement[];
}

interface RawDirectSignTemplateRecord {
  id: string;
  company_id: string;
  storage_path: string;
  sha256: string;
  signature_page: string | null;
  signature_x_frac: string | null;
  signature_y_frac: string | null;
  status: string;
  field_placements: string | null;
}

const BY_ID_QUERY = `
  SELECT id, company_id, storage_path, sha256, signature_page, signature_x_frac, signature_y_frac, status,
         field_placements
  FROM direct_sign_templates
  WHERE id = ?
  LIMIT 1
`;

function numberOrNull(value: string | null): number | null {
  if (value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse the jsonb-as-text placement list, validating it against the
 * flow-schema SSOT. A malformed or stale value degrades to "no placements"
 * rather than throwing: an unplaceable field must never stop a rep from
 * closing at the door — the contract still carries the answers, and the
 * server-side render simply stamps nothing.
 */
function parsePlacements(raw: string | null): DirectSignFieldPlacement[] {
  if (!raw) return [];
  try {
    const parsed = directSignFieldPlacementsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function toRow(record: RawDirectSignTemplateRecord): DirectSignTemplateRow {
  return {
    id: record.id,
    company_id: record.company_id,
    storage_path: record.storage_path,
    sha256: record.sha256,
    signature_page: numberOrNull(record.signature_page),
    signature_x_frac: numberOrNull(record.signature_x_frac),
    signature_y_frac: numberOrNull(record.signature_y_frac),
    status: record.status === 'draft' ? 'draft' : 'published',
    field_placements: parsePlacements(record.field_placements),
  };
}

export interface DirectSignTemplatesRepo {
  getById(id: string): Promise<DirectSignTemplateRow | null>;
}

export function createDirectSignTemplatesRepo(options: {
  db: AbstractPowerSyncDatabase;
}): DirectSignTemplatesRepo {
  const { db } = options;
  return {
    async getById(id) {
      const rows = await db.getAll<RawDirectSignTemplateRecord>(BY_ID_QUERY, [id]);
      const first = rows[0];
      return first ? toRow(first) : null;
    },
  };
}
