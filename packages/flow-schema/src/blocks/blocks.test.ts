import { describe, expect, it } from 'vitest';
import { textBlockSchema } from './text';
import { choiceBlockSchema } from './choice';
import { sliderBlockSchema } from './slider';
import { ibanScanBlockSchema } from './iban-scan';
import { idScanBlockSchema } from './id-scan';
import { belehrungBlockSchema } from './belehrung';
import { discountBlockSchema } from './discount';
import { signatureBlockSchema } from './signature';
import { consentBlockSchema } from './consent';
import { blockSchema } from '../product-definition';

describe('block schemas', () => {
  it('text block validates with required fields', () => {
    const result = textBlockSchema.safeParse({
      type: 'text',
      id: 'block-1',
      label: 'Your name',
    });
    expect(result.success).toBe(true);
  });

  it('text block accepts optional multiline flag', () => {
    const result = textBlockSchema.safeParse({
      type: 'text',
      id: 'block-1',
      label: 'Notes',
      multiline: true,
    });
    expect(result.success).toBe(true);
  });

  it('text block defaults gate to false', () => {
    const result = textBlockSchema.parse({
      type: 'text',
      id: 'block-1',
      label: 'Your name',
    });
    expect(result.gate).toBe(false);
  });

  it('choice block requires at least one option', () => {
    const result = choiceBlockSchema.safeParse({
      type: 'choice',
      id: 'block-2',
      label: 'Pick one',
      options: [],
    });
    expect(result.success).toBe(false);
  });

  it('choice block validates with options', () => {
    const result = choiceBlockSchema.safeParse({
      type: 'choice',
      id: 'block-2',
      label: 'Pick one',
      options: [{ value: 'a', label: 'Option A' }],
    });
    expect(result.success).toBe(true);
  });

  it('slider block validates min/max/step', () => {
    const result = sliderBlockSchema.safeParse({
      type: 'slider',
      id: 'block-3',
      label: 'Devices',
      min: 1,
      max: 10,
      step: 1,
      unit: 'devices',
    });
    expect(result.success).toBe(true);
  });

  it('iban-scan block validates manual-entry metadata', () => {
    const result = ibanScanBlockSchema.safeParse({
      type: 'iban-scan',
      id: 'block-4',
      label: 'IBAN',
    });
    expect(result.success).toBe(true);
  });

  it('id-scan block validates manual-entry metadata', () => {
    const result = idScanBlockSchema.safeParse({
      type: 'id-scan',
      id: 'block-5',
      label: 'ID document',
    });
    expect(result.success).toBe(true);
  });

  it('belehrung block requires noticeText', () => {
    const result = belehrungBlockSchema.safeParse({
      type: 'belehrung',
      id: 'block-6',
      label: 'Withdrawal notice',
    });
    expect(result.success).toBe(false);
  });

  it('belehrung block validates with noticeText', () => {
    const result = belehrungBlockSchema.safeParse({
      type: 'belehrung',
      id: 'block-6',
      label: 'Withdrawal notice',
      noticeText: 'You have the right to withdraw within 14 days.',
    });
    expect(result.success).toBe(true);
  });

  it('discount block requires termsRef and rejects an embedded terms object', () => {
    const result = discountBlockSchema.safeParse({
      type: 'discount',
      id: 'block-7',
      label: 'Your door-exclusive offer',
      termsRef: 'terms-123',
    });
    expect(result.success).toBe(true);
  });

  it('discount block rejects missing termsRef', () => {
    const result = discountBlockSchema.safeParse({
      type: 'discount',
      id: 'block-7',
      label: 'Your door-exclusive offer',
    });
    expect(result.success).toBe(false);
  });

  it('signature block validates as a placeholder marker', () => {
    const result = signatureBlockSchema.safeParse({
      type: 'signature',
      id: 'block-8',
      label: 'Sign here',
    });
    expect(result.success).toBe(true);
  });

  it('consent block requires consentText (missing consentText fails)', () => {
    const result = consentBlockSchema.safeParse({
      type: 'consent',
      id: 'block-9',
      label: 'Einwilligung',
      requiresConfirmation: true,
    });
    expect(result.success).toBe(false);
  });

  it('consent block validates with consentText and an explicit boolean confirmation field', () => {
    const result = consentBlockSchema.safeParse({
      type: 'consent',
      id: 'block-9',
      label: 'Einwilligung',
      consentText: 'Ich willige ein, dass meine Kontaktdaten an den Anbieter übermittelt werden.',
      requiresConfirmation: true,
    });
    expect(result.success).toBe(true);
  });

  it('consent block requires an explicit boolean confirmation field', () => {
    const result = consentBlockSchema.safeParse({
      type: 'consent',
      id: 'block-9',
      label: 'Einwilligung',
      consentText: 'Ich willige ein …',
    });
    expect(result.success).toBe(false);
  });

  it('the block union/registry now includes the consent block type', () => {
    const result = blockSchema.safeParse({
      type: 'consent',
      id: 'block-9',
      label: 'Einwilligung',
      consentText: 'Ich willige ein, dass meine Kontaktdaten an den Anbieter übermittelt werden.',
      requiresConfirmation: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a block missing its required id', () => {
    const result = textBlockSchema.safeParse({
      type: 'text',
      label: 'Your name',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a block missing its required label', () => {
    const result = textBlockSchema.safeParse({
      type: 'text',
      id: 'block-1',
    });
    expect(result.success).toBe(false);
  });
});
