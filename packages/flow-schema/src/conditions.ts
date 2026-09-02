import { z } from 'zod';
import type { Block } from './product-definition.ts';

/**
 * Flat-AND show-if condition (D-13): field-operator-value, AND-combined.
 * No OR, no nesting — deliberately capped per CONTEXT.md D-13.
 */
export const showIfConditionSchema = z.object({
  field: z.string(),
  operator: z.enum(['equals', 'not_equals', 'gte', 'lte', 'in']),
  value: z.union([z.string(), z.number(), z.array(z.string())]),
});
export type ShowIfCondition = z.infer<typeof showIfConditionSchema>;

function evaluateOne(condition: ShowIfCondition, actual: unknown): boolean {
  switch (condition.operator) {
    case 'equals':
      return actual === condition.value;
    case 'not_equals':
      return actual !== condition.value;
    case 'gte':
      return typeof actual === 'number' && typeof condition.value === 'number' && actual >= condition.value;
    case 'lte':
      return typeof actual === 'number' && typeof condition.value === 'number' && actual <= condition.value;
    case 'in':
      return Array.isArray(condition.value) && typeof actual === 'string' && condition.value.includes(actual);
    default:
      return false;
  }
}

/**
 * AND-combines all conditions (D-13). No conditions (undefined/empty) means
 * "always visible".
 */
export function evaluateShowIf(
  conditions: ShowIfCondition[] | undefined,
  answers: Record<string, unknown>,
): boolean {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every((c) => evaluateOne(c, answers[c.field]));
}

/** Filters blocks down to those whose showIf passes against the current answers. */
export function visibleBlocks(blocks: Block[], answers: Record<string, unknown>): Block[] {
  return blocks.filter((b) => evaluateShowIf(b.showIf as ShowIfCondition[] | undefined, answers));
}

/**
 * Drops answer keys belonging to blocks no longer visible (D-15) — the
 * final contract dataset must only contain answers of visible blocks.
 */
export function pruneInvalidatedAnswers(
  blocks: Block[],
  answers: Record<string, unknown>,
): Record<string, unknown> {
  const visibleIds = new Set(visibleBlocks(blocks, answers).map((b) => b.id));
  return Object.fromEntries(Object.entries(answers).filter(([fieldId]) => visibleIds.has(fieldId)));
}
