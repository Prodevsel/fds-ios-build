import { beforeEach, describe, expect, it, vi } from 'vitest';

// Node test environment (vitest.config.ts): never load the native
// expo-crypto module — only its randomUUID export is used, and it's stubbed
// deterministically here (mirrors housesRepo.test.ts's pattern).
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'fixed-uuid') }));

import { createFlowDraftsRepo, snapshotFromDraftRow, type FlowDraftRow } from './flowDraftsRepo';

interface FakeDb {
  execute: ReturnType<typeof vi.fn>;
  getAll: ReturnType<typeof vi.fn>;
}

function fakeDb(): FakeDb {
  return {
    execute: vi.fn(async () => ({})),
    getAll: vi.fn(async () => []),
  };
}

describe('flowDraftsRepo (device-local, single-writer, D-04/D-09/D-19)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('insertDraft writes a local INSERT with status=in_progress and empty answers', async () => {
    const db = fakeDb();
    const repo = createFlowDraftsRepo({ db: db as never });

    const id = await repo.insertDraft({
      houseId: 'house-1',
      productDefinitionId: 'product-1',
      productVersion: 1,
      createdBy: 'user-1',
    });

    expect(id).toBe('fixed-uuid');
    expect(db.execute).toHaveBeenCalledTimes(1);
    const [sql, params] = db.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO flow_drafts');
    expect(sql).toContain("'in_progress'");
    expect(sql).not.toMatch(/ON CONFLICT|upsert/i);
    expect(params).toEqual([
      'fixed-uuid',
      'user-1',
      'house-1',
      'product-1',
      1,
      null,
      0,
      expect.any(String),
      expect.any(String),
    ]);
  });

  it('saveAnswer issues a json_set UPDATE scoped to the field id, never overwriting other answers', async () => {
    const db = fakeDb();
    const repo = createFlowDraftsRepo({ db: db as never });

    await repo.saveAnswer('draft-1', 'device-count', 'few');

    expect(db.execute).toHaveBeenCalledTimes(1);
    const [sql, params] = db.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('json_set(answers');
    expect(sql).toContain('UPDATE flow_drafts');
    expect(params).toEqual(['$."device-count"', '"few"', expect.any(String), 'draft-1']);
  });

  it('markCompleted writes status=completed with the D-19 snapshot columns AND terms_id/terms_version (Gap 2A), never recomputing them', async () => {
    const db = fakeDb();
    const repo = createFlowDraftsRepo({ db: db as never });

    await repo.markCompleted('draft-1', {
      doorPrice: 34.99,
      comparisonPrice: 49.99,
      discountAmount: 15.0,
      termsText: 'Nur heute an Ihrer Tür...',
      termsId: 'terms-42',
      termsVersion: 7,
    });

    const [sql, params] = db.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("status = 'completed'");
    expect(sql).toContain('snapshot_door_price');
    expect(sql).toContain('terms_id');
    expect(sql).toContain('terms_version');
    expect(params).toEqual([
      34.99,
      49.99,
      15.0,
      'Nur heute an Ihrer Tür...',
      'terms-42',
      7,
      expect.any(String),
      'draft-1',
    ]);
  });

  it('saveSnapshot issues a plain UPDATE persisting the six snapshot/terms columns, leaving status untouched', async () => {
    const db = fakeDb();
    const repo = createFlowDraftsRepo({ db: db as never });

    await repo.saveSnapshot('draft-1', {
      doorPrice: 34.99,
      comparisonPrice: 49.99,
      discountAmount: 15.0,
      termsText: 'Nur heute an Ihrer Tür...',
      termsId: 'terms-42',
      termsVersion: 7,
    });

    const [sql, params] = db.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE flow_drafts');
    expect(sql).toContain('snapshot_door_price');
    expect(sql).toContain('snapshot_comparison_price');
    expect(sql).toContain('snapshot_discount_amount');
    expect(sql).toContain('snapshot_terms_text');
    expect(sql).toContain('terms_id');
    expect(sql).toContain('terms_version');
    expect(sql).not.toContain("status = 'completed'");
    expect(sql).not.toMatch(/ON CONFLICT|upsert/i);
    expect(params).toEqual([
      34.99,
      49.99,
      15.0,
      'Nur heute an Ihrer Tür...',
      'terms-42',
      7,
      expect.any(String),
      'draft-1',
    ]);
  });

  it('discardDraft marks status=discarded', async () => {
    const db = fakeDb();
    const repo = createFlowDraftsRepo({ db: db as never });

    await repo.discardDraft('draft-1');

    const [sql, params] = db.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("status = 'discarded'");
    expect(params).toEqual([expect.any(String), 'draft-1']);
  });

  it('getDraftForHouse queries in_progress rows only, JSON.parse-ing the jsonb answers column', async () => {
    const db = fakeDb();
    db.getAll.mockResolvedValueOnce([
      {
        id: 'draft-1',
        created_by: 'user-1',
        house_id: 'house-1',
        product_definition_id: 'product-1',
        product_version: '1',
        terms_id: null,
        terms_version: null,
        territory_id: null,
        status: 'in_progress',
        answers: '{"intro":"hi"}',
        is_test: '0',
        snapshot_door_price: null,
        snapshot_comparison_price: null,
        snapshot_discount_amount: null,
        snapshot_terms_text: null,
        created_at: '2026-07-22T00:00:00Z',
        updated_at: '2026-07-22T00:00:00Z',
      },
    ]);
    const repo = createFlowDraftsRepo({ db: db as never });

    const row = await repo.getDraftForHouse('house-1');

    expect(row?.answers).toEqual({ intro: 'hi' });
    expect(row?.product_version).toBe(1);
    expect(row?.is_test).toBe(false);
    const [sql, params] = db.getAll.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("status = 'in_progress'");
    expect(params).toEqual(['house-1']);
  });

  it('getDraftForHouse returns null when no in_progress draft exists', async () => {
    const db = fakeDb();
    const repo = createFlowDraftsRepo({ db: db as never });

    const row = await repo.getDraftForHouse('house-1');

    expect(row).toBeNull();
  });
});

describe('snapshotFromDraftRow (resume re-hydration mapper, Gap 2 defect B primitive)', () => {
  function fakeDraftRow(overrides: Partial<FlowDraftRow> = {}): FlowDraftRow {
    return {
      id: 'draft-1',
      created_by: 'user-1',
      house_id: 'house-1',
      product_definition_id: 'product-1',
      product_version: 1,
      terms_id: null,
      terms_version: null,
      territory_id: null,
      status: 'in_progress',
      answers: {},
      is_test: false,
      snapshot_door_price: null,
      snapshot_comparison_price: null,
      snapshot_discount_amount: null,
      snapshot_terms_text: null,
      created_at: '2026-07-22T00:00:00Z',
      updated_at: '2026-07-22T00:00:00Z',
      ...overrides,
    };
  }

  it('maps a populated snapshot row into a CompletionSnapshot including termsId/termsVersion', () => {
    const row = fakeDraftRow({
      terms_id: 'terms-42',
      terms_version: 7,
      snapshot_door_price: 34.99,
      snapshot_comparison_price: 49.99,
      snapshot_discount_amount: 15.0,
      snapshot_terms_text: 'Nur heute an Ihrer Tür...',
    });

    const snapshot = snapshotFromDraftRow(row);

    expect(snapshot).toEqual({
      doorPrice: 34.99,
      comparisonPrice: 49.99,
      discountAmount: 15.0,
      termsText: 'Nur heute an Ihrer Tür...',
      termsId: 'terms-42',
      termsVersion: 7,
    });
  });

  it('returns null when no snapshot has been captured yet (snapshot_door_price is null)', () => {
    const row = fakeDraftRow();

    expect(snapshotFromDraftRow(row)).toBeNull();
  });
});
