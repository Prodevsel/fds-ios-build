import { z } from 'zod';
import type { Block } from './product-definition.ts';

/**
 * Variables in a direct-sign PDF (0085).
 *
 * A direct_pdf product used to be able to ask nothing at all: the flow was a
 * fixed PDF -> Widerrufsbelehrung -> Unterschrift, so the customer signed
 * whatever single variant the uploaded document happened to describe. This
 * module is the SSOT for the other half: which of a product's blocks may be
 * asked before the PDF, where their answers land on the page, and — the part
 * that matters most — the ONE function that turns an answer into the printed
 * string.
 *
 * That last point is deliberate. The device shows the customer a filled
 * preview and the server stamps the artifact; those are two different
 * runtimes and two different renderers. If each formatted answers its own way,
 * a customer could be shown "Plus — 20 Inhalte im Monat" and sign a document
 * reading "plus". Both sides call `formatPlacementValue`.
 */

export const directSignFieldPlacementSchema = z.object({
  /** Id of a block on the referencing product_definitions row. */
  blockId: z.string().min(1),
  /**
   * ONE-based page number, the same convention `direct_sign_templates
   * .signature_page` uses end to end (CR-01): the operator sees "Seite 1" and
   * the stored record says 1. The single 0-based conversion lives in the
   * renderer.
   */
  page: z.number().int().min(1),
  /** Fractions of the ACTUAL page size, never screen pixels (Pitfall 6). */
  xFrac: z.number().min(0).max(1),
  yFrac: z.number().min(0).max(1),
  /** Point size for the stamped text; the renderer's default applies when absent. */
  fontSize: z.number().min(4).max(48).optional(),
/**
 * What a placement PUTS on the page.
 *
 * Until now a placement could only ever be "the answer to block X". Two lines
 * of a real contract cannot be expressed that way, and both came back blank on
 * the first document a customer ever signed:
 *
 *   * "Monatlich:" — the package PRICE. A direct_pdf product carries no
 *     discount block (D-04), so the price lives on the chosen option
 *     (`price` on a choice option) and is not an answer of its own. `part`
 *     selects it.
 *   * "Anschrift:" — the customer's address, which the flow never asks for
 *     because it already knows it: the consultation was started from a HOUSE
 *     on the map, and that house has an address. `source` reads it from the
 *     context the caller supplies instead of from an answer. Asking a customer
 *     to dictate an address the rep is currently standing in front of is the
 *     kind of question that loses a signature.
 *
 * Both optional, both defaulting to today's behaviour, so every placement
 * authored before this keeps stamping exactly what it stamped.
 */
  part: z.enum(['label', 'price']).optional(),
  /** A key into the caller's context map, e.g. 'house.address'. Wins over blockId. */
  source: z.string().optional(),
});
export type DirectSignFieldPlacement = z.infer<typeof directSignFieldPlacementSchema>;

export const directSignFieldPlacementsSchema = z.array(directSignFieldPlacementSchema);

/** Default stamp size — matches the 11pt body text renderPdf.ts draws. */
export const DIRECT_SIGN_FIELD_DEFAULT_FONT_SIZE = 11;

/**
 * The block types a direct-sign flow may ask BEFORE the PDF step.
 *
 * Deliberately not "everything the wizard can render". `discount` captures a
 * pricing snapshot a direct_pdf product does not have (D-04); `id-scan` needs
 * the flow-draft + attachment machinery the direct-sign screen has no
 * equivalent of; `belehrung` and `signature` ARE the two fixed steps that
 * follow.
 *
 * `iban-scan` WAS excluded on the same "attachment machinery" grounds, and
 * that was simply wrong about the block: IbanScanBlock's own header states it
 * retains no image and makes "no attachment-queue or photo-album save call
 * anywhere in this file" (T-04-16/T-04-14). It writes one normalized string,
 * scan and manual entry converging on the same mod-97 checksum. There was
 * therefore nothing to exclude it for, and excluding it meant a direct_pdf
 * product could never collect a SEPA mandate — the customer signed a contract
 * for a monthly price with no way to pay it.
 *
 * `id-scan` stays out on purpose, and not only for the machinery: a COMPANY
 * has no identity document to present. Who signed is captured by the `contact`
 * block's `name`/`company` fields, which work for both kinds of customer.
 */
export const DIRECT_SIGN_QUESTION_BLOCK_TYPES = [
  'text',
  'choice',
  'slider',
  'contact',
  'iban-scan',
] as const;
export type DirectSignQuestionBlockType = (typeof DIRECT_SIGN_QUESTION_BLOCK_TYPES)[number];

export type DirectSignQuestionBlock = Extract<Block, { type: DirectSignQuestionBlockType }>;

/** True for a block the direct-sign flow can ask and the PDF can carry a value for. */
export function isDirectSignQuestionBlock(block: Block): block is DirectSignQuestionBlock {
  return (DIRECT_SIGN_QUESTION_BLOCK_TYPES as readonly string[]).includes(block.type);
}

/**
 * The product's askable blocks, in authored order. Used by the app to build
 * the question steps and by the admin to list what can be placed — one
 * definition, so the operator can never place a field the flow never asks.
 */
export function directSignQuestionBlocks(blocks: readonly Block[]): DirectSignQuestionBlock[] {
  return blocks.filter(isDirectSignQuestionBlock);
}

/**
 * The string that gets stamped onto the page for one answer.
 *
 * A choice renders its OPTION LABEL, not the stored value — "Plus — 20 Inhalte
 * im Monat, bis zu acht Reels" is what the customer chose and what belongs in
 * a contract; `plus` is a database key. A slider appends its unit. Anything
 * unanswered returns an empty string rather than "undefined": a blank line on
 * a contract is a gap someone notices, the word "undefined" is a document
 * nobody can hand to a customer.
 */
export function formatPlacementValue(
  block: Block,
  answer: unknown,
  part: 'label' | 'price' = 'label',
): string {
  if (answer === null || answer === undefined) return '';

  switch (block.type) {
    case 'choice': {
      const option = block.options.find((o) => o.value === answer);
      if (!option) return String(answer);
      // `part: 'price'` puts the chosen package's price on the contract's
      // "Monatlich:" line. An option with no price stamps nothing rather than
      // an empty box — a blank line on a contract is a gap someone notices.
      if (part === 'price') return option.price ?? '';
      return option.label;
    }
    case 'slider': {
      const unit = block.unit ? ` ${block.unit}` : '';
      return `${String(answer)}${unit}`;
    }
    default:
      return typeof answer === 'string' ? answer : String(answer);
  }
}

/** One resolved stamp: the text to draw and where. Built once, used by both renderers. */
export interface ResolvedDirectSignField {
  text: string;
  page: number;
  xFrac: number;
  yFrac: number;
  fontSize: number;
}

/**
 * Joins placements against the product's blocks and the customer's answers.
 * Placements whose block no longer exists, or whose answer is empty, are
 * DROPPED — a stale placement from an earlier product version must not stamp
 * a blank box or crash the render half a year after signing.
 */
export function resolveDirectSignFields(
  placements: readonly DirectSignFieldPlacement[],
  blocks: readonly Block[],
  answers: Record<string, unknown>,
  /** Values the flow already knows without asking, e.g. { 'house.address': '...' }. */
  context: Readonly<Record<string, string>> = {},
): ResolvedDirectSignField[] {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const resolved: ResolvedDirectSignField[] = [];
  for (const placement of placements) {
    let text: string;
    if (placement.source) {
      // A context placement does not need a block at all — and an unknown key
      // stamps nothing rather than the key name.
      text = context[placement.source] ?? '';
    } else {
      const block = byId.get(placement.blockId);
      if (!block) continue;
      text = formatPlacementValue(block, answers[placement.blockId], placement.part);
    }
    if (text.trim().length === 0) continue;
    resolved.push({
      text,
      page: placement.page,
      xFrac: placement.xFrac,
      yFrac: placement.yFrac,
      fontSize: placement.fontSize ?? DIRECT_SIGN_FIELD_DEFAULT_FONT_SIZE,
    });
  }
  return resolved;
}
