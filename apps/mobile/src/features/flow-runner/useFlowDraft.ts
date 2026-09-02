import { useCallback, useEffect, useState } from 'react';
import type { Block } from '@frontdoorsales/flow-schema';
import { snapshotFromDraftRow, type CompletionSnapshot, type FlowDraftsRepo } from './db/flowDraftsRepo';
import type { ProductDefinitionsRepo } from './db/productDefinitionsRepo';

/**
 * D-04 auto-save core (useFollowUpSchedule.ts split: pure DI'd functions +
 * thin useState-machine hook wrapper). Reusable outside FlowRunnerScreen
 * (e.g. a future resume-list screen) — FlowRunnerScreen.tsx implements its
 * own step-navigation-aware variant of this same repo contract so its
 * business-logic functions stay colocated with the wizard shell per the
 * plan's own file split, but both wrap the identical FlowDraftsRepo methods.
 *
 * D-09/D-10/D-11 version selection + tester-flag draft flow: a NEWLY started
 * flow takes `getLatestPublished` (or, for a tester starting a flow against a
 * Draft version, an explicit `draftVersion`); a RESUMED flow re-reads its
 * EXACT pinned `product_version` via `getVersion` — never re-selects latest
 * mid-flow (keeps the notice text pinned, legally required). `is_test` is
 * decided ONCE, at draft creation, from the selected version's `status`
 * ('draft' → is_test=true, D-10/D-11) — since the version is pinned and
 * never switches for the lifetime of the draft, this is equivalent to (and
 * simpler than) re-deciding it again at completion time, and is proven by
 * the completion test below (the flag set at creation survives unchanged
 * through `complete()`).
 */

export type FlowDraftRepo = Pick<
  FlowDraftsRepo,
  'getDraftForHouse' | 'insertDraft' | 'saveAnswer' | 'markCompleted' | 'saveSnapshot' | 'discardDraft'
>;

export type ProductDefinitionsSource = Pick<ProductDefinitionsRepo, 'getLatestPublished' | 'getVersion'>;

export interface StartOrResumeDraftParams {
  repo: FlowDraftRepo;
  productDefinitionsRepo: ProductDefinitionsSource;
  houseId: string;
  slug: string;
  createdBy: string;
  territoryId?: string | null;
  /** D-10: a tester's explicit choice of a Draft version for a NEW flow — omitted for the normal latest-published path. */
  draftVersion?: number;
}

export interface StartOrResumeDraftResult {
  draftId: string;
  answers: Record<string, unknown>;
  blocks: Block[];
  productDefinitionId: string;
  productVersion: number;
  /** D-10/D-11: true when the selected product version's status is 'draft'. */
  isTest: boolean;
  /**
   * Gap 2B (03-UAT.md): the persisted discount snapshot re-hydrated from the
   * draft row on resume (via snapshotFromDraftRow), or null when no snapshot
   * has been captured yet (fresh draft, or discount block not yet reached).
   * Never recomputed — only ever the already-frozen persisted values (D-19).
   */
  snapshot: CompletionSnapshot | null;
}

/**
 * D-04/D-09: resumes an existing in_progress draft for the house (re-reading
 * its EXACT pinned version, never the latest), or starts a fresh one against
 * the latest published version (or a tester's explicit Draft version).
 * Pure, DI'd — no React.
 */
export async function startOrResumeDraft(
  params: StartOrResumeDraftParams,
): Promise<StartOrResumeDraftResult> {
  const { repo, productDefinitionsRepo, houseId, slug, createdBy, territoryId, draftVersion } = params;

  const existing = await repo.getDraftForHouse(houseId);
  if (existing) {
    // D-09: never switch mid-flow — re-read the EXACT pinned version, even
    // if a newer (or newly-published) version now exists locally.
    const pinnedVersion = existing.product_version ?? 1;
    const product = await productDefinitionsRepo.getVersion(slug, pinnedVersion);
    return {
      draftId: existing.id,
      answers: existing.answers,
      blocks: product?.blocks ?? [],
      productDefinitionId: existing.product_definition_id ?? product?.id ?? '',
      productVersion: pinnedVersion,
      isTest: existing.is_test,
      snapshot: snapshotFromDraftRow(existing),
    };
  }

  const product =
    draftVersion !== undefined
      ? await productDefinitionsRepo.getVersion(slug, draftVersion)
      : await productDefinitionsRepo.getLatestPublished(slug);
  if (!product) {
    throw new Error(`startOrResumeDraft: no product definition locally available for slug=${slug}`);
  }

  const isTest = product.status === 'draft'; // D-10/D-11
  const draftId = await repo.insertDraft({
    houseId,
    productDefinitionId: product.id,
    productVersion: product.version,
    createdBy,
    territoryId: territoryId ?? null,
    isTest,
  });
  return {
    draftId,
    answers: {},
    blocks: product.blocks,
    productDefinitionId: product.id,
    productVersion: product.version,
    isTest,
    snapshot: null,
  };
}

export interface RecordAnswerParams {
  repo: FlowDraftRepo;
  draftId: string;
  fieldId: string;
  value: unknown;
}

/** D-04: auto-saves immediately — never batched, never debounced. */
export async function recordAnswer(params: RecordAnswerParams): Promise<void> {
  await params.repo.saveAnswer(params.draftId, params.fieldId, params.value);
}

export interface CompleteDraftParams {
  repo: FlowDraftRepo;
  draftId: string;
  snapshot: CompletionSnapshot;
}

/**
 * Forwards the ALREADY-frozen discount snapshot (D-19/Pitfall 4) — never
 * recomputed here. `is_test` is NOT re-decided here: it was already set
 * correctly at draft creation (startOrResumeDraft) from the pinned version's
 * status, and D-09 guarantees that version never changes mid-flow.
 */
export async function completeDraft(params: CompleteDraftParams): Promise<void> {
  await params.repo.markCompleted(params.draftId, params.snapshot);
}

export interface DiscardDraftParams {
  repo: FlowDraftRepo;
  draftId: string;
}

export async function discardDraft(params: DiscardDraftParams): Promise<void> {
  await params.repo.discardDraft(params.draftId);
}

export type FlowDraftStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface FlowDraftState {
  status: FlowDraftStatus;
  error: string | null;
  draftId: string | null;
  answers: Record<string, unknown>;
  blocks: Block[];
  productDefinitionId: string | null;
  productVersion: number | null;
  isTest: boolean;
  /** Gap 2B (03-UAT.md): mirrors StartOrResumeDraftResult.snapshot — kept type-consistent with the spread below. */
  snapshot: CompletionSnapshot | null;
}

const IDLE: FlowDraftState = {
  status: 'idle',
  error: null,
  draftId: null,
  answers: {},
  blocks: [],
  productDefinitionId: null,
  productVersion: null,
  isTest: false,
  snapshot: null,
};

export interface UseFlowDraftParams {
  repo: FlowDraftRepo;
  productDefinitionsRepo: ProductDefinitionsSource;
  houseId: string;
  slug: string;
  createdBy: string;
  territoryId?: string | null;
  draftVersion?: number;
}

export interface UseFlowDraftResult {
  state: FlowDraftState;
  saveAnswer: (fieldId: string, value: unknown) => Promise<void>;
  complete: (snapshot: CompletionSnapshot) => Promise<void>;
  discard: () => Promise<void>;
}

/** Thin useState-machine wrapper (useFollowUpSchedule.ts pattern) around the pure DI'd core above. */
export function useFlowDraft(params: UseFlowDraftParams): UseFlowDraftResult {
  const { repo, productDefinitionsRepo, houseId, slug, createdBy, territoryId, draftVersion } = params;
  const [state, setState] = useState<FlowDraftState>(IDLE);

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, status: 'loading' }));
    startOrResumeDraft({ repo, productDefinitionsRepo, houseId, slug, createdBy, territoryId, draftVersion })
      .then((result) => {
        if (cancelled) return;
        setState({ status: 'ready', error: null, ...result });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState((prev) => ({ ...prev, status: 'error', error: describeError(error) }));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houseId, slug]);

  const saveAnswer = useCallback(
    async (fieldId: string, value: unknown) => {
      if (!state.draftId) return;
      await recordAnswer({ repo, draftId: state.draftId, fieldId, value });
      setState((prev) => ({ ...prev, answers: { ...prev.answers, [fieldId]: value } }));
    },
    [repo, state.draftId],
  );

  const complete = useCallback(
    async (snapshot: CompletionSnapshot) => {
      if (!state.draftId) return;
      await completeDraft({ repo, draftId: state.draftId, snapshot });
    },
    [repo, state.draftId],
  );

  const discard = useCallback(async () => {
    if (!state.draftId) return;
    await discardDraft({ repo, draftId: state.draftId });
  }, [repo, state.draftId]);

  return { state, saveAnswer, complete, discard };
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
