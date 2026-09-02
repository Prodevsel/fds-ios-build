import { describe, expect, it } from 'vitest';
import {
  PLATFORM_DEFAULT_BELEHRUNG_TEXT,
  assertDirectSignPublishable,
  buildBelehrungGateBlock,
} from './direct-sign';
import type { ProductDefinition } from './product-definition';

function flowFormProduct(): ProductDefinition {
  return {
    slug: 'fiber-basic',
    version: 1,
    status: 'draft',
    contract_mode: 'flow_form',
    blocks: [{ type: 'text', id: 'name', label: 'Your name', gate: false }],
  };
}

function directPdfProduct(overrides: Partial<ProductDefinition> = {}): ProductDefinition {
  return {
    slug: 'direct-sign-basic',
    version: 1,
    status: 'draft',
    contract_mode: 'direct_pdf',
    directSignTemplateId: '123e4567-e89b-12d3-a456-426614174000',
    blocks: [buildBelehrungGateBlock()],
    ...overrides,
  };
}

describe('PLATFORM_DEFAULT_BELEHRUNG_TEXT', () => {
  it('is non-empty', () => {
    expect(PLATFORM_DEFAULT_BELEHRUNG_TEXT.length).toBeGreaterThan(0);
  });
});

describe('buildBelehrungGateBlock', () => {
  it('returns a gate block using the platform default text when no override is passed', () => {
    const block = buildBelehrungGateBlock();
    expect(block.type).toBe('belehrung');
    expect(block.id).toBe('direct-sign-belehrung');
    expect(block.gate).toBe(true);
    expect(block.noticeText).toBe(PLATFORM_DEFAULT_BELEHRUNG_TEXT);
  });

  it('uses the override text when provided', () => {
    const block = buildBelehrungGateBlock('Custom company-provided notice text');
    expect(block.noticeText).toBe('Custom company-provided notice text');
  });
});

describe('assertDirectSignPublishable', () => {
  it('passes for a valid direct_pdf product with a belehrung gate block', () => {
    expect(() => assertDirectSignPublishable(directPdfProduct())).not.toThrow();
  });

  it('is a no-op for flow_form products', () => {
    expect(() => assertDirectSignPublishable(flowFormProduct())).not.toThrow();
  });

  it('throws when directSignTemplateId is missing', () => {
    const product = directPdfProduct({ directSignTemplateId: undefined });
    expect(() => assertDirectSignPublishable(product)).toThrow();
  });

  it('throws when there is no belehrung gate block', () => {
    const product = directPdfProduct({
      blocks: [{ type: 'text', id: 'name', label: 'Your name', gate: false }],
    });
    expect(() => assertDirectSignPublishable(product)).toThrow();
  });

  it('throws when the belehrung block has gate=false', () => {
    const product = directPdfProduct({
      blocks: [{ ...buildBelehrungGateBlock(), gate: false }],
    });
    expect(() => assertDirectSignPublishable(product)).toThrow();
  });

  it('throws when the belehrung gate block has empty noticeText', () => {
    const product = directPdfProduct({
      blocks: [{ ...buildBelehrungGateBlock(), noticeText: '' }],
    });
    expect(() => assertDirectSignPublishable(product)).toThrow();
  });
});
