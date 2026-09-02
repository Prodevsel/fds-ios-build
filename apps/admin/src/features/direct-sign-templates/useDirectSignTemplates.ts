import { getSupabase } from '@/lib/supabase';
import {
  directSignFieldPlacementsSchema,
  type DirectSignFieldPlacement,
} from '@frontdoorsales/flow-schema';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { directSignQuestionBlocks, type Block } from '@frontdoorsales/flow-schema';

/**
 * Direct-sign template data layer (DSGN-01, table 0066, bucket 0067).
 *
 * A company uploads a finished contract PDF that a customer signs UNCHANGED
 * at the door (D-04). This module owns:
 *   - the RLS-scoped read of a company's `direct_sign_templates` rows
 *   - the upload path: bytes -> `direct-sign-templates` bucket (upsert:false,
 *     D-19 never-overwrite) -> a draft table row carrying the ORIGINAL bytes'
 *     sha256 (the documentHashSha256 cross-check source, D-04 two-hash model)
 *   - the placement-step write (Task 3): {signature_page, signature_x_frac,
 *     signature_y_frac} — normalized fractions only, never raw pixels
 *     (Pitfall 6)
 *
 * Publishing (Task 4, product_definitions write + status flip) lives in the
 * sibling `publishDirectSignProduct.ts` so the flow-schema SSOT validator can
 * be called from a plain, injectable, unit-testable function.
 */

export type DirectSignTemplateStatus = 'draft' | 'published';

export interface DirectSignTemplate {
  id: string;
  companyId: string;
  storagePath: string;
  sha256: string;
  signaturePage: number | null;
  signatureXFrac: number | null;
  signatureYFrac: number | null;
  noticeText: string | null;
  /** 0085: variable anchors for the customer's answers — [] until placed. */
  fieldPlacements: DirectSignFieldPlacement[];
  status: DirectSignTemplateStatus;
  createdAt: string;
}

/** The per-tenant private Storage bucket 0067 provisions for uploaded PDFs. */
export const DIRECT_SIGN_TEMPLATES_BUCKET = 'direct-sign-templates';

export const DIRECT_SIGN_TEMPLATES_QUERY_KEY = ['direct-sign-templates', 'list'] as const;

/** Write-boundary max upload size (T-10-16/V5) — generous for a scanned contract PDF. */
export const MAX_TEMPLATE_BYTES = 25 * 1024 * 1024;

const SELECT_COLS =
  'id, company_id, storage_path, sha256, signature_page, signature_x_frac, signature_y_frac, notice_text, field_placements, status, created_at';

interface DirectSignTemplateRow {
  id: string;
  company_id: string;
  storage_path: string;
  sha256: string;
  signature_page: number | null;
  // Postgres `numeric` columns surface as strings over the JS client by
  // default (no float precision loss on the wire) — normalized in fromRow().
  signature_x_frac: number | string | null;
  signature_y_frac: number | string | null;
  notice_text: string | null;
  field_placements: unknown;
  status: DirectSignTemplateStatus;
  created_at: string;
}

function fromRow(row: DirectSignTemplateRow): DirectSignTemplate {
  return {
    id: row.id,
    companyId: row.company_id,
    storagePath: row.storage_path,
    sha256: row.sha256,
    signaturePage: row.signature_page,
    signatureXFrac: row.signature_x_frac === null ? null : Number(row.signature_x_frac),
    signatureYFrac: row.signature_y_frac === null ? null : Number(row.signature_y_frac),
    noticeText: row.notice_text,
    // Validated against the flow-schema SSOT rather than trusted: a row that
    // predates 0085, or one written by an older client, must surface as "no
    // placements" instead of crashing the placement screen.
    fieldPlacements: directSignFieldPlacementsSchema.safeParse(row.field_placements).data ?? [],
    status: row.status,
    createdAt: row.created_at,
  };
}

/**
 * A company's direct-sign templates. RLS (`visible_direct_sign_templates`,
 * 0066) is the real scoping boundary — the `.eq('company_id', ...)` filter is
 * a query narrowing, never trusted as the security boundary on its own
 * (mirrors useCompanyProducts in features/companies/useCompanies.ts).
 */
export function useDirectSignTemplates(companyId: string | null) {
  return useQuery({
    queryKey: [...DIRECT_SIGN_TEMPLATES_QUERY_KEY, companyId],
    enabled: Boolean(companyId),
    queryFn: async (): Promise<DirectSignTemplate[]> => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('direct_sign_templates')
        .select(SELECT_COLS)
        .eq('company_id', companyId as string)
        .order('created_at', { ascending: false });
      if (error) {
        throw error;
      }
      return ((data ?? []) as unknown as DirectSignTemplateRow[]).map(fromRow);
    },
  });
}

/**
 * SHA-256 of raw bytes (browser SubtleCrypto), lowercase hex. Hashes the
 * EXACT uploaded bytes at upload time — the documentHashSha256 cross-check
 * source (D-04 two-hash model). Pure and independently testable.
 */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Write-boundary validation (T-10-16/V5): PDF mime + sane max size. */
export function validateTemplateFile(file: File): 'invalidType' | 'tooLarge' | null {
  if (file.type !== 'application/pdf') {
    return 'invalidType';
  }
  if (file.size > MAX_TEMPLATE_BYTES) {
    return 'tooLarge';
  }
  return null;
}

/**
 * Uploads a validated PDF into the per-tenant bucket at
 * `${companyId}/${uuid}.pdf` with `upsert:false` (never overwrite, D-19),
 * hashes the exact uploaded bytes, and inserts a draft `direct_sign_templates`
 * row. Placement (Task 3) and notice/publish (Task 4) are set in later steps.
 */
export async function uploadDirectSignTemplate(
  companyId: string,
  file: File,
): Promise<DirectSignTemplate> {
  const invalidReason = validateTemplateFile(file);
  if (invalidReason) {
    throw new Error(`uploadDirectSignTemplate: ${invalidReason}`);
  }

  const supabase = getSupabase();
  const buffer = await file.arrayBuffer();
  const hash = await sha256Hex(buffer);
  const path = `${companyId}/${crypto.randomUUID()}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from(DIRECT_SIGN_TEMPLATES_BUCKET)
    .upload(path, file, { upsert: false, contentType: 'application/pdf' });
  if (uploadError) {
    throw uploadError;
  }

  const { data, error: insertError } = await supabase
    .from('direct_sign_templates')
    .insert({ company_id: companyId, storage_path: path, sha256: hash })
    .select(SELECT_COLS)
    .single();
  if (insertError) {
    throw insertError;
  }

  return fromRow(data as unknown as DirectSignTemplateRow);
}

export function useCreateDirectSignTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { companyId: string; file: File }) =>
      uploadDirectSignTemplate(input.companyId, input.file),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: [...DIRECT_SIGN_TEMPLATES_QUERY_KEY, variables.companyId],
      });
    },
  });
}

/** A short-lived signed URL for a draft/published template's PDF (private bucket). */
export async function signDirectSignTemplate(storagePath: string): Promise<string> {
  const supabase = getSupabase();
  const { data, error } = await supabase.storage
    .from(DIRECT_SIGN_TEMPLATES_BUCKET)
    .createSignedUrl(storagePath, 3600);
  if (error) {
    throw error;
  }
  return data.signedUrl;
}

export interface TemplatePlacement {
  page: number;
  xFrac: number;
  yFrac: number;
}

/**
 * Persists the signature anchor (Task 3, D-03/Pitfall 6) — page + normalized
 * 0-1 fractions ONLY, never raw screen pixels. Only a draft row is writable
 * (0066's immutability trigger rejects any UPDATE once status='published').
 */
export async function saveTemplatePlacement(
  templateId: string,
  placement: TemplatePlacement,
): Promise<void> {
  if (
    placement.xFrac < 0 ||
    placement.xFrac > 1 ||
    placement.yFrac < 0 ||
    placement.yFrac > 1
  ) {
    throw new Error('saveTemplatePlacement: xFrac/yFrac must be within [0,1]');
  }
  const supabase = getSupabase();
  const { error } = await supabase
    .from('direct_sign_templates')
    .update({
      signature_page: placement.page,
      signature_x_frac: placement.xFrac,
      signature_y_frac: placement.yFrac,
    })
    .eq('id', templateId);
  if (error) {
    throw error;
  }
}

export function useSaveTemplatePlacement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { templateId: string; companyId: string; placement: TemplatePlacement }) =>
      saveTemplatePlacement(input.templateId, input.placement),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: [...DIRECT_SIGN_TEMPLATES_QUERY_KEY, variables.companyId],
      });
    },
  });
}

/**
 * Persists the variable anchors (0085). Same posture as
 * `saveTemplatePlacement`: normalized fractions only, draft rows only (0066's
 * immutability trigger rejects any UPDATE once the template is published), and
 * validated against the flow-schema SSOT before the write so a malformed
 * anchor never reaches the column's CHECK constraint as a 500.
 */
export async function saveFieldPlacements(
  templateId: string,
  placements: DirectSignFieldPlacement[],
): Promise<void> {
  const parsed = directSignFieldPlacementsSchema.safeParse(placements);
  if (!parsed.success) {
    throw new Error('saveFieldPlacements: invalid placement shape');
  }
  const supabase = getSupabase();
  const { error } = await supabase
    .from('direct_sign_templates')
    .update({ field_placements: parsed.data })
    .eq('id', templateId);
  if (error) {
    throw error;
  }
}

export function useSaveFieldPlacements() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      templateId: string;
      companyId: string;
      placements: DirectSignFieldPlacement[];
    }) => saveFieldPlacements(input.templateId, input.placements),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: [...DIRECT_SIGN_TEMPLATES_QUERY_KEY, variables.companyId],
      });
    },
  });
}

/** A published product whose questions a direct-sign template can adopt. */
export interface QuestionSourceProduct {
  id: string;
  slug: string;
  version: number;
  blocks: Block[];
}

/**
 * 0085: published products of the SAME company that carry blocks a direct-sign
 * flow can ask.
 *
 * The alternative was a block editor in the admin, which is a whole product of
 * its own. Companies that sell the same thing two ways — smaica runs a guided
 * wizard AND a signed PDF — already have the questions authored once; this
 * reuses them rather than asking an operator to retype a package list into a
 * second screen and get it subtly wrong.
 * ponytail: adopt-an-existing-question-set. A real block editor is the upgrade
 * path if a company ever needs PDF-only questions.
 */
export function useQuestionSourceProducts(companyId: string | null) {
  return useQuery({
    queryKey: ['direct-sign-templates', 'question-sources', companyId],
    enabled: Boolean(companyId),
    queryFn: async (): Promise<QuestionSourceProduct[]> => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('product_definitions')
        .select('id, slug, version, blocks')
        .eq('company_id', companyId as string)
        .eq('status', 'published')
        .order('slug', { ascending: true });
      if (error) {
        throw error;
      }
      return ((data ?? []) as { id: string; slug: string; version: number; blocks: Block[] }[])
        .map((row) => ({ ...row, blocks: directSignQuestionBlocks(row.blocks ?? []) }))
        .filter((row) => row.blocks.length > 0);
    },
  });
}
