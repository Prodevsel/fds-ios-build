import {
  type Block,
  pruneInvalidatedAnswers,
  visibleBlocks,
} from '@frontdoorsales/flow-schema';
import { describe, expect, it, vi } from 'vitest';
import type { ConfirmedGateEntry } from './directSignGate';
import {
  DIRECT_SIGN_SIGNATURE_STEP_INDEX,
  advanceStep,
  canAdvanceToSignature,
  confirmBelehrung,
  deriveSteps,
  nextQuestionStepIndex,
  questionBlockId,
  signatureStepIndex,
} from './useDirectSignFlow';

const BELEHRUNG_BLOCK: Extract<Block, { type: 'belehrung' }> = {
  type: 'belehrung',
  id: 'direct-sign-belehrung',
  label: 'Widerrufsbelehrung',
  gate: true,
  noticeText: 'Sie haben das Recht, binnen vierzehn Tagen zu widerrufen.',
};

describe('deriveSteps', () => {
  it('is the fixed [view, belehrung, signature] sequence', () => {
    expect(deriveSteps()).toEqual(['view', 'belehrung', 'signature']);
  });
});

describe('canAdvanceToSignature', () => {
  it('is false with no confirmedGates', () => {
    expect(canAdvanceToSignature({ confirmedGates: [], belehrungBlock: BELEHRUNG_BLOCK })).toBe(
      false,
    );
  });

  it('is false when belehrungBlock could not be resolved (no gate to satisfy at all)', () => {
    const confirmedGates: ConfirmedGateEntry[] = [
      {
        blockId: 'direct-sign-belehrung',
        confirmedAtIso: '2026-08-04T10:00:00.000Z',
        noticeTextSha256: 'x',
      },
    ];
    expect(canAdvanceToSignature({ confirmedGates, belehrungBlock: null })).toBe(false);
  });

  it('is true once the belehrung block is confirmed', () => {
    const confirmedGates: ConfirmedGateEntry[] = [
      {
        blockId: 'direct-sign-belehrung',
        confirmedAtIso: '2026-08-04T10:00:00.000Z',
        noticeTextSha256: 'x',
      },
    ];
    expect(canAdvanceToSignature({ confirmedGates, belehrungBlock: BELEHRUNG_BLOCK })).toBe(true);
  });
});

describe('confirmBelehrung', () => {
  it('builds a confirmedGates entry sourced from the block noticeText (never the PDF)', async () => {
    const digestFn = vi.fn(async (data: string) => `sha256(${data})`);
    const now = () => new Date('2026-08-04T12:00:00.000Z');
    const entry = await confirmBelehrung({ belehrungBlock: BELEHRUNG_BLOCK, now, digestFn });
    expect(entry).toEqual({
      blockId: 'direct-sign-belehrung',
      confirmedAtIso: '2026-08-04T12:00:00.000Z',
      noticeTextSha256: `sha256(${BELEHRUNG_BLOCK.noticeText})`,
    });
  });
});

describe('advanceStep — the signature step is technically unreachable without confirmation', () => {
  it('BLOCKS jumping straight from the view step (0) to the signature step (2) when unconfirmed', () => {
    const next = advanceStep(0, DIRECT_SIGN_SIGNATURE_STEP_INDEX, false);
    expect(next).toBeLessThan(DIRECT_SIGN_SIGNATURE_STEP_INDEX);
  });

  it('BLOCKS advancing from the belehrung step (1) to the signature step (2) when unconfirmed', () => {
    const next = advanceStep(1, DIRECT_SIGN_SIGNATURE_STEP_INDEX, false);
    expect(next).toBe(1);
  });

  it('ALLOWS advancing to the signature step once signatureReachable is true', () => {
    const next = advanceStep(1, DIRECT_SIGN_SIGNATURE_STEP_INDEX, true);
    expect(next).toBe(DIRECT_SIGN_SIGNATURE_STEP_INDEX);
  });

  it('never returns an index below 0 or above the signature step', () => {
    expect(advanceStep(0, -5, true)).toBe(0);
    expect(advanceStep(0, 99, true)).toBe(DIRECT_SIGN_SIGNATURE_STEP_INDEX);
  });

  it('allows the normal forward step view(0) -> belehrung(1) regardless of signature reachability', () => {
    expect(advanceStep(0, 1, false)).toBe(1);
  });
});

/**
 * The reported direct-sign fault, reproduced against the SMAICA demo product's
 * branch (scripts/demo/seed-smaica-direct-sign-v7.sql:37-66): "Wer schliesst
 * den Vertrag?" reveals `customerName` for a Privatperson, and answering it is
 * supposed to land on `email`.
 *
 * The simulation below runs exactly what DirectSignFlowScreen.handleQuestionAnswer
 * runs — prune, re-filter, resolve the next index, clamp — so it is the flow's
 * navigation and not a paraphrase of it.
 */
const BRANCH_BLOCKS: Block[] = [
  {
    type: 'choice',
    id: 'kundenart',
    label: 'Wer schliesst den Vertrag?',
    gate: true,
    options: [
      { value: 'person', label: 'Privatperson' },
      { value: 'firma', label: 'Firma' },
    ],
  },
  {
    type: 'contact',
    id: 'customerName',
    label: 'Auf welchen Namen laeuft der Vertrag?',
    gate: true,
    field: 'name',
    required: true,
    showIf: [{ field: 'kundenart', operator: 'equals', value: 'person' }],
  },
  {
    type: 'contact',
    id: 'customerCompany',
    label: 'Wie lautet der Firmenname?',
    gate: true,
    field: 'company',
    required: true,
    showIf: [{ field: 'kundenart', operator: 'equals', value: 'firma' }],
  },
  {
    type: 'contact',
    id: 'ansprechpartner',
    label: 'Wer ist die Ansprechperson?',
    gate: false,
    field: 'name',
    required: false,
    showIf: [{ field: 'kundenart', operator: 'equals', value: 'firma' }],
  },
  {
    type: 'contact',
    id: 'email',
    label: 'An welche E-Mail-Adresse soll der Vertrag gehen?',
    gate: true,
    field: 'email',
    required: true,
  },
];

/** One "Weiter"/option tap: returns the block id the flow lands on. */
function tap(
  authored: Block[],
  answers: Record<string, unknown>,
  stepIndex: number,
  fieldId: string,
  value: unknown,
): { answers: Record<string, unknown>; stepIndex: number; blockId: string | null } {
  const nextAnswers = pruneInvalidatedAnswers(authored, { ...answers, [fieldId]: value });
  const nextQuestionIds = visibleBlocks(authored, nextAnswers).map((b) => b.id);
  const nextSteps = deriveSteps(nextQuestionIds);
  const nextIndex = advanceStep(
    stepIndex,
    nextQuestionStepIndex(nextQuestionIds, fieldId, stepIndex),
    false,
    signatureStepIndex(nextSteps),
  );
  return {
    answers: nextAnswers,
    stepIndex: nextIndex,
    blockId: questionBlockId(nextSteps[nextIndex] ?? 'view'),
  };
}

describe('nextQuestionStepIndex', () => {
  it('lands on the block that follows the answered one in the list the answer produced', () => {
    expect(nextQuestionStepIndex(['kundenart', 'customerName', 'email'], 'kundenart', 0)).toBe(1);
    expect(nextQuestionStepIndex(['kundenart', 'customerName', 'email'], 'customerName', 1)).toBe(2);
  });

  /**
   * `showIf` names a field, not a position (conditions.ts:8-13), so a revealed
   * block may sit BEFORE the question that reveals it. `current + 1` then lands
   * on the question that was just answered; anchoring on the id does not.
   */
  it('is unaffected when the reveal lands before the answered block, where current + 1 is wrong', () => {
    const nextIds = ['customerName', 'kundenart', 'email'];
    expect(nextQuestionStepIndex(nextIds, 'kundenart', 0)).toBe(2);
    // What the old `current + 1` would have produced: the answered block again.
    expect(nextIds[0 + 1]).toBe('kundenart');
  });

  it('falls back to current + 1 when D-15 pruning hid the answered block itself', () => {
    expect(nextQuestionStepIndex(['kundenart', 'email'], 'customerCompany', 1)).toBe(2);
  });
});

describe('direct-sign branch navigation (device report: one tap advanced two steps)', () => {
  it('advances exactly one step per tap along the Privatperson branch', () => {
    // kundenart(0), email(1) — customerName is not visible yet.
    let state = tap(BRANCH_BLOCKS, {}, 0, 'kundenart', 'person');
    expect(state.blockId).toBe('customerName');

    state = tap(BRANCH_BLOCKS, state.answers, state.stepIndex, 'customerName', 'Anna Musterfrau');
    expect(state.blockId).toBe('email');
    // The block the flow lands on has NO answer — nothing was submitted for it,
    // so nothing about it may render as validated.
    expect(state.answers.email).toBeUndefined();
    expect(state.answers.customerName).toBe('Anna Musterfrau');
  });

  it('advances exactly one step per tap along the Firma branch (two blocks revealed at once)', () => {
    let state = tap(BRANCH_BLOCKS, {}, 0, 'kundenart', 'firma');
    expect(state.blockId).toBe('customerCompany');

    state = tap(BRANCH_BLOCKS, state.answers, state.stepIndex, 'customerCompany', 'ACME GmbH');
    expect(state.blockId).toBe('ansprechpartner');

    state = tap(BRANCH_BLOCKS, state.answers, state.stepIndex, 'ansprechpartner', 'Anna Musterfrau');
    expect(state.blockId).toBe('email');
  });

  it('re-answering the branch from the review jump lands on the new branch, dropping the old answer', () => {
    let state = tap(BRANCH_BLOCKS, {}, 0, 'kundenart', 'person');
    state = tap(BRANCH_BLOCKS, state.answers, state.stepIndex, 'customerName', 'Anna Musterfrau');
    // ReviewScreen jump back to the branch question (index 0).
    state = tap(BRANCH_BLOCKS, state.answers, 0, 'kundenart', 'firma');
    expect(state.blockId).toBe('customerCompany');
    expect(state.answers.customerName).toBeUndefined();
  });
});
