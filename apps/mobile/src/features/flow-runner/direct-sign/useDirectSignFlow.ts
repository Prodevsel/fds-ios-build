import type { BelehrungBlock } from '@frontdoorsales/flow-schema';
import {
  type ConfirmedGateEntry,
  buildConfirmedGateEntry,
  isSignatureReachable,
} from './directSignGate';

/**
 * DSGN-01/DSGN-02: pure orchestration for the direct-sign flow's three
 * fixed steps (view -> belehrung -> signature), mirroring FlowRunnerScreen's
 * StatusSheet.tsx-style split (pure, exported, DI'd functions; the screen —
 * Task 3's other half, DirectSignFlowScreen.tsx — only wires these to React
 * state). No react-test-renderer needed for this module.
 */

/**
 * A step is either one of the three fixed ones or a question the PRODUCT
 * declares, addressed as `question:<blockId>`.
 *
 * The three fixed steps used to be the whole list, which is why a direct_pdf
 * product could ask nothing: the customer saw the PDF, confirmed the notice
 * and signed, with no way to pick the package the document was about. The
 * questions come first — a customer must choose before reading the document
 * their choice produced.
 */
export type DirectSignStepId = 'view' | 'belehrung' | 'signature' | `question:${string}`;

/** The three steps every direct-sign flow ends with, in order. */
const FIXED_TAIL: DirectSignStepId[] = ['view', 'belehrung', 'signature'];

/**
 * Step order for a product: its question blocks (authored order), then the
 * fixed tail. Passing no question ids reproduces the original three-step list
 * exactly, so a product without questions behaves as it always did.
 */
export function deriveSteps(questionBlockIds: readonly string[] = []): DirectSignStepId[] {
  return [...questionBlockIds.map((id): DirectSignStepId => `question:${id}`), ...FIXED_TAIL];
}

/**
 * Index of the terminal signature step for a flow with NO questions. Kept as a
 * named constant because it is the default `advanceStep` falls back to; a flow
 * with questions passes its own index from `signatureStepIndex`.
 */
export const DIRECT_SIGN_SIGNATURE_STEP_INDEX = 2;

/** The signature is always last — derive rather than assume a fixed index. */
export function signatureStepIndex(steps: readonly DirectSignStepId[]): number {
  return steps.length - 1;
}

/**
 * The step a "Weiter"/option tap should land on, expressed against the visible
 * list the answer PRODUCES — not against the one it was tapped in.
 *
 * DirectSignFlowScreen used to advance with a bare `current + 1`
 * (DirectSignFlowScreen.tsx:337). That is only accidentally right: it assumes
 * every block a showIf reveals sits AFTER the question that revealed it, so the
 * insertion never shifts anything at or before `current`. Nothing in
 * conditions.ts enforces that — `showIf` names a field, not a position, and an
 * author may perfectly well put the conditional block earlier in the authored
 * order than the branch question it depends on. When that happens `current + 1`
 * lands on the question that was just answered, or skips the one after it.
 *
 * Anchoring on the ANSWERED BLOCK'S id removes the assumption entirely: the
 * next step is whatever follows that block once the new answers are applied.
 * Falls back to `current + 1` when the answered block is no longer visible
 * (D-15 pruning can hide it) — there is no "block after it" to anchor to then.
 */
export function nextQuestionStepIndex(
  /** Question block ids visible AFTER the answer (and after D-15 pruning). */
  nextQuestionBlockIds: readonly string[],
  answeredBlockId: string,
  currentIndex: number,
): number {
  const answeredIndex = nextQuestionBlockIds.indexOf(answeredBlockId);
  return answeredIndex === -1 ? currentIndex + 1 : answeredIndex + 1;
}

/** The block id a question step addresses, or null for the fixed steps. */
export function questionBlockId(step: DirectSignStepId): string | null {
  return step.startsWith('question:') ? step.slice('question:'.length) : null;
}

export interface CanAdvanceToSignatureParams {
  confirmedGates: ConfirmedGateEntry[];
  belehrungBlock: BelehrungBlock | null;
}

/**
 * T-10-20: the signature step is reachable ONLY once the product's
 * belehrung gate block (never a PDF-derived heuristic, T-10-21) has a
 * matching confirmedGates entry. A null belehrungBlock (unresolved gate)
 * can never be satisfied — delegates to directSignGate.isSignatureReachable,
 * the single source of truth for this check (also proven in
 * directSignGate.test.ts).
 */
export function canAdvanceToSignature(params: CanAdvanceToSignatureParams): boolean {
  const { confirmedGates, belehrungBlock } = params;
  return isSignatureReachable(confirmedGates, belehrungBlock?.id ?? null);
}

export interface ConfirmBelehrungParams {
  belehrungBlock: BelehrungBlock;
  now: () => Date;
  digestFn: (data: string) => Promise<string>;
}

/**
 * Records the belehrung confirmation as a confirmedGates entry, sourced
 * from `belehrungBlock.noticeText` (the app-native, published product's own
 * text) — never from the rendered PDF. Delegates to
 * directSignGate.buildConfirmedGateEntry (single source of truth for the
 * entry shape/hashing path, D-26).
 */
export async function confirmBelehrung(
  params: ConfirmBelehrungParams,
): Promise<ConfirmedGateEntry> {
  const { belehrungBlock, now, digestFn } = params;
  return buildConfirmedGateEntry(belehrungBlock, now().toISOString(), digestFn);
}

/**
 * T-10-20: the SAME root-cause guard as FlowRunnerScreen's
 * clampToUnconfirmedGate — a proposed step transition that would cross INTO
 * the signature step while it is not yet reachable is rejected (clamped to
 * stay strictly before it), regardless of whether the transition came from
 * a "Weiter" tap or a StepOverview-style direct jump. This is the function
 * that makes the signature step TECHNICALLY unreachable (not merely
 * visually disabled) — proven by the "signature step is technically
 * unreachable without confirmation" test block.
 */
export function advanceStep(
  currentIndex: number,
  requestedIndex: number,
  signatureReachable: boolean,
  /** Index of the signature step; defaults to the question-less three-step flow. */
  signatureIndex: number = DIRECT_SIGN_SIGNATURE_STEP_INDEX,
): number {
  const clampedRequest = Math.max(0, Math.min(requestedIndex, signatureIndex));
  if (clampedRequest >= signatureIndex && !signatureReachable) {
    return Math.min(currentIndex, signatureIndex - 1);
  }
  return clampedRequest;
}
