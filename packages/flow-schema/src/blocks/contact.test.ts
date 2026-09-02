import { describe, expect, it } from 'vitest';
import { contactBlockSchema, validateContactValue } from './contact.ts';

describe('contactBlockSchema', () => {
  it('defaults gate to false and required to true', () => {
    const parsed = contactBlockSchema.parse({
      type: 'contact',
      id: 'email',
      label: 'E-Mail',
      field: 'email',
    });
    expect(parsed.gate).toBe(false);
    expect(parsed.required).toBe(true);
  });

  it('rejects a field outside the closed set', () => {
    expect(
      contactBlockSchema.safeParse({ type: 'contact', id: 'x', label: 'x', field: 'iban' }).success,
    ).toBe(false);
  });
});

describe('validateContactValue', () => {
  // The contract is emailed to whatever lands here, so a typo the rep cannot
  // see means the customer never receives their copy.
  it('accepts a real address and rejects near-misses', () => {
    expect(validateContactValue('email', 's.elkhalil@vizionists.com', true)).toBe('ok');
    expect(validateContactValue('email', 's.elkhalil@vizionists', true)).toBe('invalid');
    expect(validateContactValue('email', 's.elkhalil.vizionists.com', true)).toBe('invalid');
    expect(validateContactValue('email', 'a b@c.de', true)).toBe('invalid');
  });

  it('distinguishes empty from invalid so the message can differ', () => {
    expect(validateContactValue('email', '   ', true)).toBe('empty');
    expect(validateContactValue('email', '   ', false)).toBe('ok');
  });

  it('accepts common German phone shapes', () => {
    expect(validateContactValue('phone', '+49 170 1234567', true)).toBe('ok');
    expect(validateContactValue('phone', '07152/123456', true)).toBe('ok');
    expect(validateContactValue('phone', '12', true)).toBe('invalid');
  });
});
