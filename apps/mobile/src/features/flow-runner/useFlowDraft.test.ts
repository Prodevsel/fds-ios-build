import { beforeEach, describe, expect, it, vi } from 'vitest';

// useFlowDraft.ts now value-imports snapshotFromDraftRow from
// db/flowDraftsRepo.ts (Gap 2B re-hydration), which in turn imports the real
// expo-crypto native module — stub it (mirrors flowDraftsRepo.test.ts /
// FlowRunnerScreen.test.tsx precedent) so this plain-node-environment suite
// never touches native code, even though these tests don't call insertDraft's
// crypto path themselves.
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'fixed-uuid') }));

import {
  completeDraft,
  discardDraft,
  recordAnswer,
  startOrResumeDraft,
  type FlowDraftRepo,
  type ProductDefinitionsSource,
} from './useFlowDraft';
import type { FlowDraftRow } from './db/flowDraftsRepo';
import type { ProductDefinitionRow } from './db/productDefinitionsRepo';

function fakeDraftRow(overrides: Partial<FlowDraftRow> = {}): FlowDraftRow {
  return {
    id: 'draft-existing',
    created_by: 'user-1',
    house_id: 'house-1',
    product_definition_id: 'product-1',
    product_version: 1,
    terms_id: null,
    terms_version: null,
    territory_id: null,
    status: 'in_progress',
    answers: { intro: 'hi' },
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

function fakeProductRow(overrides: Partial<ProductDefinitionRow> = {}): ProductDefinitionRow {
  return {
    id: 'product-1',
    company_id: 'company-1',
    slug: 'glasfaser-home',
    version: 1,
    status: 'published',
  contract_mode: 'flow_form',
  direct_sign_template_id: null,
    blocks: [],
    created_at: '2026-07-22T00:00:00Z',
    ...overrides,
  };
}

function fakeRepo(overrides: Partial<FlowDraftRepo> = {}): FlowDraftRepo {
  return {
    getDraftForHouse: vi.fn(async () => null),
    insertDraft: vi.fn(async () => 'draft-1'),
    saveAnswer: vi.fn(async () => {}),
    markCompleted: vi.fn(async () => {}),
    saveSnapshot: vi.fn(async () => {}),
    discardDraft: vi.fn(async () => {}),
    ...overrides,
  };
}

function fakeProductDefinitionsRepo(
  overrides: Partial<ProductDefinitionsSource> = {},
): ProductDefinitionsSource {
  return {
    getLatestPublished: vi.fn(async () => fakeProductRow()),
    getVersion: vi.fn(async () => fakeProductRow()),
    ...overrides,
  };
}

describe('startOrResumeDraft (D-04/D-09)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts a fresh draft against the latest published version when no in_progress draft exists', async () => {
    const repo = fakeRepo();
    const productDefinitionsRepo = fakeProductDefinitionsRepo({
      getLatestPublished: vi.fn(async () => fakeProductRow({ version: 3, status: 'published' })),
    });

    const result = await startOrResumeDraft({
      repo,
      productDefinitionsRepo,
      houseId: 'house-1',
      slug: 'glasfaser-home',
      createdBy: 'user-1',
    });

    expect(result.draftId).toBe('draft-1');
    expect(result.productVersion).toBe(3);
    expect(result.isTest).toBe(false);
    expect(productDefinitionsRepo.getLatestPublished).toHaveBeenCalledWith('glasfaser-home');
    expect(repo.insertDraft).toHaveBeenCalledWith({
      houseId: 'house-1',
      productDefinitionId: 'product-1',
      productVersion: 3,
      createdBy: 'user-1',
      territoryId: null,
      isTest: false,
    });
  });

  it('resumes an existing in_progress draft, re-reading its EXACT pinned version (never re-selecting latest, D-09)', async () => {
    const repo = fakeRepo({
      getDraftForHouse: vi.fn(async () => fakeDraftRow({ product_version: 1 })),
    });
    const productDefinitionsRepo = fakeProductDefinitionsRepo({
      getLatestPublished: vi.fn(async () => fakeProductRow({ version: 5 })), // a newer version now exists...
      getVersion: vi.fn(async () => fakeProductRow({ version: 1 })), // ...but the pinned v1 is what must be re-read
    });

    const result = await startOrResumeDraft({
      repo,
      productDefinitionsRepo,
      houseId: 'house-1',
      slug: 'glasfaser-home',
      createdBy: 'user-1',
    });

    expect(result.draftId).toBe('draft-existing');
    expect(result.productVersion).toBe(1);
    expect(repo.insertDraft).not.toHaveBeenCalled();
    expect(productDefinitionsRepo.getVersion).toHaveBeenCalledWith('glasfaser-home', 1);
    expect(productDefinitionsRepo.getLatestPublished).not.toHaveBeenCalled();
  });

  it('a tester starting a NEW flow against an explicit Draft version sets is_test=true (D-10/D-11)', async () => {
    const repo = fakeRepo();
    const productDefinitionsRepo = fakeProductDefinitionsRepo({
      getVersion: vi.fn(async () => fakeProductRow({ version: 2, status: 'draft' })),
    });

    const result = await startOrResumeDraft({
      repo,
      productDefinitionsRepo,
      houseId: 'house-1',
      slug: 'glasfaser-home',
      createdBy: 'tester-1',
      draftVersion: 2,
    });

    expect(result.isTest).toBe(true);
    expect(productDefinitionsRepo.getVersion).toHaveBeenCalledWith('glasfaser-home', 2);
    expect(repo.insertDraft).toHaveBeenCalledWith(
      expect.objectContaining({ productVersion: 2, isTest: true }),
    );
  });

  it('a NEW flow against a published version sets is_test=false', async () => {
    const repo = fakeRepo();
    const productDefinitionsRepo = fakeProductDefinitionsRepo({
      getLatestPublished: vi.fn(async () => fakeProductRow({ version: 1, status: 'published' })),
    });

    const result = await startOrResumeDraft({
      repo,
      productDefinitionsRepo,
      houseId: 'house-1',
      slug: 'glasfaser-home',
      createdBy: 'user-1',
    });

    expect(result.isTest).toBe(false);
  });

  it('Gap 2B (03-UAT.md): resuming a draft with a captured snapshot re-hydrates it via snapshotFromDraftRow', async () => {
    const repo = fakeRepo({
      getDraftForHouse: vi.fn(async () =>
        fakeDraftRow({
          product_version: 1,
          terms_id: 'terms-1',
          terms_version: 2,
          snapshot_door_price: 34.99,
          snapshot_comparison_price: 49.99,
          snapshot_discount_amount: 15.0,
          snapshot_terms_text: 'terms text',
        }),
      ),
    });
    const productDefinitionsRepo = fakeProductDefinitionsRepo({
      getVersion: vi.fn(async () => fakeProductRow({ version: 1 })),
    });

    const result = await startOrResumeDraft({
      repo,
      productDefinitionsRepo,
      houseId: 'house-1',
      slug: 'glasfaser-home',
      createdBy: 'user-1',
    });

    expect(result.snapshot).toEqual({
      doorPrice: 34.99,
      comparisonPrice: 49.99,
      discountAmount: 15.0,
      termsText: 'terms text',
      termsId: 'terms-1',
      termsVersion: 2,
    });
  });

  it('Gap 2B (03-UAT.md): resuming a draft with no captured snapshot yet returns snapshot: null', async () => {
    const repo = fakeRepo({
      getDraftForHouse: vi.fn(async () => fakeDraftRow({ product_version: 1 })),
    });
    const productDefinitionsRepo = fakeProductDefinitionsRepo({
      getVersion: vi.fn(async () => fakeProductRow({ version: 1 })),
    });

    const result = await startOrResumeDraft({
      repo,
      productDefinitionsRepo,
      houseId: 'house-1',
      slug: 'glasfaser-home',
      createdBy: 'user-1',
    });

    expect(result.snapshot).toBeNull();
  });

  it('Gap 2B (03-UAT.md): starting a FRESH draft returns snapshot: null', async () => {
    const repo = fakeRepo();
    const productDefinitionsRepo = fakeProductDefinitionsRepo({
      getLatestPublished: vi.fn(async () => fakeProductRow({ version: 3, status: 'published' })),
    });

    const result = await startOrResumeDraft({
      repo,
      productDefinitionsRepo,
      houseId: 'house-1',
      slug: 'glasfaser-home',
      createdBy: 'user-1',
    });

    expect(result.snapshot).toBeNull();
  });

  it('throws when no product definition is locally available for the slug', async () => {
    const repo = fakeRepo();
    const productDefinitionsRepo = fakeProductDefinitionsRepo({
      getLatestPublished: vi.fn(async () => null),
    });

    await expect(
      startOrResumeDraft({
        repo,
        productDefinitionsRepo,
        houseId: 'house-1',
        slug: 'unknown-product',
        createdBy: 'user-1',
      }),
    ).rejects.toThrow(/no product definition/i);
  });
});

describe('completeDraft (D-10/D-11: is_test set at creation survives unchanged through completion)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a draft-version draft still carries is_test=true after completion', async () => {
    const repo = fakeRepo();
    const productDefinitionsRepo = fakeProductDefinitionsRepo({
      getVersion: vi.fn(async () => fakeProductRow({ version: 2, status: 'draft' })),
    });

    const { draftId, isTest } = await startOrResumeDraft({
      repo,
      productDefinitionsRepo,
      houseId: 'house-1',
      slug: 'glasfaser-home',
      createdBy: 'tester-1',
      draftVersion: 2,
    });
    expect(isTest).toBe(true);

    await completeDraft({
      repo,
      draftId,
      snapshot: {
        doorPrice: 10,
        comparisonPrice: null,
        discountAmount: null,
        termsText: '',
        termsId: 'terms-1',
        termsVersion: 1,
      },
    });

    // is_test was set on the insertDraft call at creation time (D-09: the
    // version never switches mid-flow, so it is never re-decided here).
    expect(repo.insertDraft).toHaveBeenCalledWith(expect.objectContaining({ isTest: true }));
    expect(repo.markCompleted).toHaveBeenCalledTimes(1);
  });

  it('a published-version draft carries is_test=false after completion', async () => {
    const repo = fakeRepo();
    const productDefinitionsRepo = fakeProductDefinitionsRepo({
      getLatestPublished: vi.fn(async () => fakeProductRow({ version: 1, status: 'published' })),
    });

    const { draftId, isTest } = await startOrResumeDraft({
      repo,
      productDefinitionsRepo,
      houseId: 'house-1',
      slug: 'glasfaser-home',
      createdBy: 'user-1',
    });
    expect(isTest).toBe(false);

    await completeDraft({
      repo,
      draftId,
      snapshot: {
        doorPrice: 10,
        comparisonPrice: null,
        discountAmount: null,
        termsText: '',
        termsId: 'terms-1',
        termsVersion: 1,
      },
    });

    expect(repo.insertDraft).toHaveBeenCalledWith(expect.objectContaining({ isTest: false }));
  });
});

describe('recordAnswer (D-04: auto-save fires on every answer, never batched)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves immediately via the repo', async () => {
    const repo = fakeRepo();
    await recordAnswer({ repo, draftId: 'draft-1', fieldId: 'device-count', value: 'few' });
    expect(repo.saveAnswer).toHaveBeenCalledWith('draft-1', 'device-count', 'few');
  });
});

describe('discardDraft', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks the draft discarded via the repo', async () => {
    const repo = fakeRepo();
    await discardDraft({ repo, draftId: 'draft-1' });
    expect(repo.discardDraft).toHaveBeenCalledWith('draft-1');
  });
});
