import { describe, expect, it } from 'vitest';
import { productDefinitionSchema } from './product-definition';

function validProduct() {
  return {
    slug: 'fiber-basic',
    version: 1,
    status: 'draft' as const,
    blocks: [
      { type: 'text', id: 'name', label: 'Your name' },
      {
        type: 'choice',
        id: 'speed',
        label: 'Speed tier',
        options: [{ value: '100', label: '100 Mbit/s' }],
      },
      {
        type: 'slider',
        id: 'devices',
        label: 'Devices',
        min: 1,
        max: 10,
        step: 1,
      },
      { type: 'iban-scan', id: 'iban', label: 'IBAN' },
      { type: 'id-scan', id: 'id', label: 'ID document' },
      {
        type: 'belehrung',
        id: 'notice',
        label: 'Withdrawal notice',
        noticeText: 'You have the right to withdraw within 14 days.',
      },
      {
        type: 'discount',
        id: 'discount',
        label: 'Your door-exclusive offer',
        termsRef: 'terms-123',
      },
      { type: 'signature', id: 'sign', label: 'Sign here' },
    ],
  };
}

describe('productDefinitionSchema', () => {
  it('validates a product containing one of each of the 8 block types', () => {
    const result = productDefinitionSchema.safeParse(validProduct());
    expect(result.success).toBe(true);
  });

  it('defaults contract_mode to flow_form when omitted', () => {
    const result = productDefinitionSchema.safeParse(validProduct());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contract_mode).toBe('flow_form');
    }
  });

  it('accepts contract_mode direct_pdf with a directSignTemplateId', () => {
    const product = {
      ...validProduct(),
      contract_mode: 'direct_pdf' as const,
      directSignTemplateId: '123e4567-e89b-12d3-a456-426614174000',
    };
    const result = productDefinitionSchema.safeParse(product);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contract_mode).toBe('direct_pdf');
      expect(result.data.directSignTemplateId).toBe('123e4567-e89b-12d3-a456-426614174000');
    }
  });

  it('rejects a contract_mode outside the enum', () => {
    const product = { ...validProduct(), contract_mode: 'pdf' };
    const result = productDefinitionSchema.safeParse(product);
    expect(result.success).toBe(false);
  });

  it('rejects an unknown block type', () => {
    const product = validProduct();
    (product.blocks as Array<Record<string, unknown>>).push({
      type: 'unknown-block-type',
      id: 'bogus',
      label: 'Bogus',
    });
    const result = productDefinitionSchema.safeParse(product);
    expect(result.success).toBe(false);
  });

  it('rejects a non-positive version', () => {
    const product = { ...validProduct(), version: 0 };
    const result = productDefinitionSchema.safeParse(product);
    expect(result.success).toBe(false);
  });

  it('rejects an invalid status', () => {
    const product = { ...validProduct(), status: 'archived' };
    const result = productDefinitionSchema.safeParse(product);
    expect(result.success).toBe(false);
  });
});

/**
 * H02 (quick-260827-h02) — attachments, the missing half of `flow_form`.
 *
 * A fixed-price uploaded PDF cannot represent three differently-priced
 * packages. The answer is the order form we GENERATE from the answers plus
 * the partner's STATIC PDFs carried along unchanged. `attachments` is that
 * second half — additive, defaulted, and explicitly NOT a third contract_mode.
 */
describe('productDefinitionSchema — attachments (H02)', () => {
  it('defaults attachments to [] when omitted (every existing product file keeps validating)', () => {
    const result = productDefinitionSchema.safeParse(validProduct());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.attachments).toEqual([]);
    }
  });

  it('accepts a storagePath/label attachment entry', () => {
    const product = {
      ...validProduct(),
      attachments: [
        { storagePath: '123e4567-e89b-12d3-a456-426614174000/anlage-1.pdf', label: 'Anlage 1' },
      ],
    };
    const result = productDefinitionSchema.safeParse(product);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.attachments).toHaveLength(1);
      expect(result.data.attachments[0].label).toBe('Anlage 1');
    }
  });

  it('rejects an attachment entry missing storagePath', () => {
    const product = { ...validProduct(), attachments: [{ label: 'Anlage 1' }] };
    expect(productDefinitionSchema.safeParse(product).success).toBe(false);
  });

  it('rejects an attachment entry missing label', () => {
    const product = { ...validProduct(), attachments: [{ storagePath: 'x/y.pdf' }] };
    expect(productDefinitionSchema.safeParse(product).success).toBe(false);
  });

  it('attachments do not introduce a third contract_mode', () => {
    const product = {
      ...validProduct(),
      attachments: [{ storagePath: 'x/y.pdf', label: 'Anlage 1' }],
    };
    const result = productDefinitionSchema.safeParse(product);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contract_mode).toBe('flow_form');
    }
  });
});
