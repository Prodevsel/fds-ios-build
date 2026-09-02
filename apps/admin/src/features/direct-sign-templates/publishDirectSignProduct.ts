import { getSupabase } from '@/lib/supabase';
import {
  assertDirectSignPublishable,
  buildBelehrungGateBlock,
  directSignQuestionBlocks,
  type Block,
  type ProductDefinition,
} from '@frontdoorsales/flow-schema';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Compose + validate + write the `direct_pdf` `product_definitions` row
 * (DSGN-01/02). This is the ONLY place the admin app writes a direct-sign
 * product — it always runs the flow-schema SSOT `assertDirectSignPublishable`
 * validator BEFORE any write, so a notice-less/anchor-less direct-sign
 * product structurally cannot reach Postgres (T-10-14). Never re-implements
 * the gate locally.
 */

export interface PublishDirectSignProductInput {
  companyId: string;
  templateId: string;
  slug: string;
  version: number;
  /** Optional per-company override; falls back to PLATFORM_DEFAULT_BELEHRUNG_TEXT (D-02). */
  noticeText?: string;
  /**
   * 0085: the questions the flow asks BEFORE the PDF. Until now this function
   * wrote `blocks: [belehrungGate]` hard-coded, which is why a direct_pdf
   * product could not offer a package choice at all — the customer was handed
   * whichever single variant the uploaded document described. Filtered through
   * the flow-schema SSOT so only block types the direct-sign screen can
   * actually ask are ever published.
   */
  questionBlocks?: Block[];
}

export interface PublishDirectSignProductDeps {
  /** Injectable for tests — defaults to the real app client (DI, no local re-implementation). */
  supabase?: SupabaseClient;
}

export interface PublishDirectSignProductResult {
  productId: string;
}

export async function publishDirectSignProduct(
  input: PublishDirectSignProductInput,
  deps: PublishDirectSignProductDeps = {},
): Promise<PublishDirectSignProductResult> {
  const supabase = deps.supabase ?? getSupabase();

  // buildBelehrungGateBlock (SSOT, packages/flow-schema) falls back to
  // PLATFORM_DEFAULT_BELEHRUNG_TEXT whenever noticeText is undefined/empty —
  // the notice is NEVER empty by construction.
  const belehrungBlock = buildBelehrungGateBlock(input.noticeText);

  // Questions first, notice gate last — the customer chooses, then reads the
  // withdrawal notice for what they chose.
  const questions = directSignQuestionBlocks(input.questionBlocks ?? []);

  const product: ProductDefinition = {
    slug: input.slug,
    version: input.version,
    status: 'published',
    blocks: [...questions, belehrungBlock],
    contract_mode: 'direct_pdf',
    directSignTemplateId: input.templateId || undefined,
    // H02 (quick-260827-h02) added `attachments` to productDefinitionSchema
    // with `.default([])`. A zod default is optional on the INPUT side but
    // REQUIRED on the inferred OUTPUT type, and `ProductDefinition` is the
    // output type — so every literal construction site must now name it. A
    // direct-sign product carries no static partner PDFs: the whole document
    // IS the partner's own template (contract_mode 'direct_pdf'), so the empty
    // array is the correct value here, not merely a compile-time placeholder.
    attachments: [],
  };

  // SSOT gate (packages/flow-schema/src/direct-sign.ts) — throws BEFORE any
  // write if the belehrung gate block or template id is missing/empty.
  assertDirectSignPublishable(product);

  const { data, error: insertError } = await supabase
    .from('product_definitions')
    .insert({
      company_id: input.companyId,
      slug: product.slug,
      version: product.version,
      status: product.status,
      blocks: product.blocks,
      contract_mode: product.contract_mode,
      direct_sign_template_id: product.directSignTemplateId,
    })
    .select('id')
    .single();
  if (insertError) {
    throw insertError;
  }

  // Flip the template to published (immutable thereafter, 0066's trigger) —
  // only after the product row is durably written, never before.
  const { error: updateError } = await supabase
    .from('direct_sign_templates')
    .update({ status: 'published', notice_text: belehrungBlock.noticeText })
    .eq('id', input.templateId);
  if (updateError) {
    throw updateError;
  }

  return { productId: (data as { id: string }).id };
}
