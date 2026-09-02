import { useMemo } from 'react';
import type { RecommendationRule } from '@frontdoorsales/flow-schema';
import { evaluateRecommendation } from '@frontdoorsales/flow-schema';

/**
 * Pure core (no React) deriving the recommended result from the SSOT
 * `evaluateRecommendation` (03-01) — exported separately so it is directly
 * unit-testable without mounting a component (no react-test-renderer in
 * this repo, mirrors useShowIf.ts's deriveShowIfState/useShowIf split).
 */
export function deriveRecommendation(
  rules: RecommendationRule[],
  answers: Record<string, unknown>,
): string {
  return evaluateRecommendation(rules, answers);
}

/**
 * Thin `useMemo` wrapper over `deriveRecommendation` — no DI/async. The
 * ordered rule list's mandatory fallback (empty `conditions`) always
 * resolves a suggestion (D-14). Changing an earlier answer re-derives the
 * suggestion via the same memo whenever `answers` changes.
 */
export function useRecommendation(
  rules: RecommendationRule[],
  answers: Record<string, unknown>,
): string {
  return useMemo(() => deriveRecommendation(rules, answers), [rules, answers]);
}
