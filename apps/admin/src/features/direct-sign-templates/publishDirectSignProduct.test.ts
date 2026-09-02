import { PLATFORM_DEFAULT_BELEHRUNG_TEXT } from '@frontdoorsales/flow-schema';
import { describe, expect, it } from 'vitest';
import { publishDirectSignProduct } from './publishDirectSignProduct';

/**
 * Fakes a minimal supabase-js query-builder chain — only the calls
 * publishDirectSignProduct actually makes (`.from(...).insert(...).select(...)
 * .single()` and `.from(...).update(...).eq(...)`). Records every call so a
 * test can assert "no write happened" when the SSOT validator throws
 * (T-10-14: a notice-less direct-sign product must never reach Postgres).
 */
function makeFakeSupabase(options: { insertedId?: string; failInsert?: boolean; failUpdate?: boolean } = {}) {
  const calls: { table: string; op: string; payload?: unknown }[] = [];
  const insertedId = options.insertedId ?? 'aaaaaaaa-0000-0000-0000-000000000001';

  const supabase = {
    from(table: string) {
      return {
        insert(payload: unknown) {
          calls.push({ table, op: 'insert', payload });
          return {
            select() {
              return {
                async single() {
                  if (options.failInsert) {
                    return { data: null, error: new Error('insert failed') };
                  }
                  return { data: { id: insertedId }, error: null };
                },
              };
            },
          };
        },
        update(payload: unknown) {
          calls.push({ table, op: 'update', payload });
          return {
            eq: async (_col: string, _val: string) =>
              options.failUpdate ? { error: new Error('update failed') } : { error: null },
          };
        },
      };
    },
  };

  return { supabase, calls };
}

describe('publishDirectSignProduct (DSGN-01/02, SSOT-validated publish)', () => {
  it('valid publish writes both the product_definitions row and flips the template to published', async () => {
    const { supabase, calls } = makeFakeSupabase();
    const result = await publishDirectSignProduct(
      {
        companyId: 'company-1',
        templateId: 'template-1',
        slug: 'glasfaser-basic',
        version: 1,
        noticeText: 'Individueller Belehrungstext.',
      },
      { supabase: supabase as never },
    );

    expect(result.productId).toBe('aaaaaaaa-0000-0000-0000-000000000001');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ table: 'product_definitions', op: 'insert' });
    const insertPayload = calls[0]!.payload as Record<string, unknown>;
    expect(insertPayload.contract_mode).toBe('direct_pdf');
    expect(insertPayload.direct_sign_template_id).toBe('template-1');
    expect(insertPayload.company_id).toBe('company-1');
    const blocks = insertPayload.blocks as Array<{ type: string; gate: boolean; noticeText: string }>;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('belehrung');
    expect(blocks[0]!.gate).toBe(true);
    expect(blocks[0]!.noticeText).toBe('Individueller Belehrungstext.');

    expect(calls[1]).toMatchObject({ table: 'direct_sign_templates', op: 'update' });
    const updatePayload = calls[1]!.payload as Record<string, unknown>;
    expect(updatePayload.status).toBe('published');
    expect(updatePayload.notice_text).toBe('Individueller Belehrungstext.');
  });

  it('falls back to the platform-default notice text when no override is given', async () => {
    const { supabase, calls } = makeFakeSupabase();
    await publishDirectSignProduct(
      { companyId: 'company-1', templateId: 'template-1', slug: 'glasfaser-basic', version: 1 },
      { supabase: supabase as never },
    );
    const insertPayload = calls[0]!.payload as { blocks: Array<{ noticeText: string }> };
    expect(insertPayload.blocks[0]!.noticeText).toBe(PLATFORM_DEFAULT_BELEHRUNG_TEXT);
  });

  it('falls back to the platform-default notice text when the override is an empty string', async () => {
    const { supabase, calls } = makeFakeSupabase();
    await publishDirectSignProduct(
      { companyId: 'company-1', templateId: 'template-1', slug: 'glasfaser-basic', version: 1, noticeText: '' },
      { supabase: supabase as never },
    );
    const insertPayload = calls[0]!.payload as { blocks: Array<{ noticeText: string }> };
    expect(insertPayload.blocks[0]!.noticeText).toBe(PLATFORM_DEFAULT_BELEHRUNG_TEXT);
  });

  it('throws BEFORE any write when the template id is missing (SSOT gate, T-10-14)', async () => {
    const { supabase, calls } = makeFakeSupabase();
    await expect(
      publishDirectSignProduct(
        { companyId: 'company-1', templateId: '', slug: 'glasfaser-basic', version: 1 },
        { supabase: supabase as never },
      ),
    ).rejects.toThrow(/directSignTemplateId/);
    // Neither the product insert nor the template status flip may have run —
    // a notice-less/anchor-less direct-sign product must never reach Postgres.
    expect(calls).toHaveLength(0);
  });

  it('propagates an insert error and never flips the template to published', async () => {
    const { supabase, calls } = makeFakeSupabase({ failInsert: true });
    await expect(
      publishDirectSignProduct(
        { companyId: 'company-1', templateId: 'template-1', slug: 'glasfaser-basic', version: 1 },
        { supabase: supabase as never },
      ),
    ).rejects.toThrow('insert failed');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.op).toBe('insert');
  });
});
