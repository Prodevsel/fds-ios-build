import { useMemo } from 'react';
import type { Block } from '@frontdoorsales/flow-schema';
import { pruneInvalidatedAnswers, visibleBlocks } from '@frontdoorsales/flow-schema';

export interface ShowIfState {
  /** The SINGLE derived visible-blocks-in-order list (Pitfall 3) — every
   * consumer (rendering, navigation, gate guard) must read THIS list, never
   * index the raw `blocks` array directly. */
  visible: Block[];
  /** D-15: answers belonging to now-hidden blocks dropped from the dataset. */
  prunedAnswers: Record<string, unknown>;
}

/**
 * Pure core (no React) computing the visible list and the invalidation-pruned
 * answer set TOGETHER from the same `blocks`/`answers` inputs, so the two can
 * never independently disagree (Pitfall 3). Exported separately from the hook
 * so it is directly unit-testable without mounting a component (no
 * react-test-renderer in this repo).
 */
export function deriveShowIfState(blocks: Block[], answers: Record<string, unknown>): ShowIfState {
  return {
    visible: visibleBlocks(blocks, answers),
    prunedAnswers: pruneInvalidatedAnswers(blocks, answers),
  };
}

/**
 * Thin `useMemo` wrapper over the SSOT `visibleBlocks`/`pruneInvalidatedAnswers`
 * (03-01) — no DI/async. FlowRunnerScreen and StepOverview both consume this
 * single derived list (Pitfall 3).
 */
export function useShowIf(blocks: Block[], answers: Record<string, unknown>): ShowIfState {
  return useMemo(() => deriveShowIfState(blocks, answers), [blocks, answers]);
}
