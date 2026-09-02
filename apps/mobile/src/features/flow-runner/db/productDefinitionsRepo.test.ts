import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProductDefinitionsRepo } from './productDefinitionsRepo';

interface FakeDb {
  getAll: ReturnType<typeof vi.fn>;
  watch: ReturnType<typeof vi.fn>;
}

function fakeDb(): FakeDb {
  return {
    getAll: vi.fn(async () => []),
    watch: vi.fn(),
  };
}

function fakeRawRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'product-1',
    company_id: 'company-1',
    slug: 'glasfaser-home',
    version: '1',
    status: 'published',
    blocks: '[]',
    created_at: '2026-07-22T00:00:00Z',
    ...overrides,
  };
}

describe('productDefinitionsRepo (read-only, server-written-only, D-09)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('listSellable asks for the newest PUBLISHED version of every slug (D-09 product picker)', async () => {
    const db = fakeDb();
    db.getAll.mockResolvedValueOnce([
      fakeRawRecord({ slug: 'smaica-social-media', version: '3' }),
      fakeRawRecord({
        id: 'product-2',
        slug: 'smaica-social-media-pdf',
        version: '2',
        contract_mode: 'direct_pdf',
        direct_sign_template_id: 'template-1',
      }),
    ]);
    const repo = createProductDefinitionsRepo({ db: db as never });

    const products = await repo.listSellable();

    expect(products.map((p) => [p.slug, p.version, p.contract_mode])).toEqual([
      ['smaica-social-media', 3, 'flow_form'],
      ['smaica-social-media-pdf', 2, 'direct_pdf'],
    ]);
    const [sql, params] = db.getAll.mock.calls[0] as [string, unknown[] | undefined];
    // Drafts must never be offered at a door, and one row per slug — otherwise
    // the sheet lists the same product once per published version.
    expect(sql).toContain("status = 'published'");
    expect(sql).toContain('GROUP BY slug');
    expect(sql).toContain('MAX(CAST(version AS INTEGER))');
    // No parameters: what is sellable is decided by what synced, never by a
    // slug the client passes in.
    expect(params).toBeUndefined();
  });

  it('getLatestPublished returns the highest published version and excludes drafts', async () => {
    const db = fakeDb();
    db.getAll.mockResolvedValueOnce([fakeRawRecord({ version: '3', status: 'published' })]);
    const repo = createProductDefinitionsRepo({ db: db as never });

    const product = await repo.getLatestPublished('glasfaser-home');

    expect(product?.version).toBe(3);
    expect(product?.status).toBe('published');
    const [sql, params] = db.getAll.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("status = 'published'");
    expect(sql).toContain('ORDER BY CAST(version AS INTEGER) DESC');
    expect(params).toEqual(['glasfaser-home']);
  });

  it('getLatestPublished returns null when no published row is locally available', async () => {
    const db = fakeDb();
    const repo = createProductDefinitionsRepo({ db: db as never });

    const product = await repo.getLatestPublished('glasfaser-home');

    expect(product).toBeNull();
  });

  it('getVersion re-reads the EXACT pinned version regardless of status (D-09/D-10)', async () => {
    const db = fakeDb();
    db.getAll.mockResolvedValueOnce([fakeRawRecord({ version: '1', status: 'draft' })]);
    const repo = createProductDefinitionsRepo({ db: db as never });

    const product = await repo.getVersion('glasfaser-home', 1);

    expect(product?.version).toBe(1);
    expect(product?.status).toBe('draft');
    const [sql, params] = db.getAll.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('WHERE slug = ? AND version = ?');
    expect(sql).not.toContain("status = 'published'");
    expect(params).toEqual(['glasfaser-home', 1]);
  });

  it('getVersion returns null when the exact version is not locally available', async () => {
    const db = fakeDb();
    const repo = createProductDefinitionsRepo({ db: db as never });

    const product = await repo.getVersion('glasfaser-home', 99);

    expect(product).toBeNull();
  });
});
