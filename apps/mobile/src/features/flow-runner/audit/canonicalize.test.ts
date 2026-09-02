import { describe, expect, it } from 'vitest';
import { canonicalize, hashCanonical } from './canonicalize';

/**
 * D-26: a hash is only evidence if independently reproducible. ONE
 * canonicalize() feeds both the document hash and the audit-package hash —
 * these tests pin the serializer's behavior directly, since both hashes
 * derive from it.
 */

describe('canonicalize', () => {
  it('is key-order independent for flat objects', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it('sorts nested object keys recursively', () => {
    const nested = canonicalize({ z: { b: 1, a: 2 }, a: 1 });
    const reordered = canonicalize({ a: 1, z: { a: 2, b: 1 } });
    expect(nested).toBe(reordered);
    expect(nested).toBe('{"a":1,"z":{"a":2,"b":1}}');
  });

  it('preserves array order', () => {
    expect(canonicalize({ list: [3, 1, 2] })).toBe('{"list":[3,1,2]}');
  });

  it('sorts object keys nested inside arrays', () => {
    expect(canonicalize({ list: [{ b: 1, a: 2 }] })).toBe('{"list":[{"a":2,"b":1}]}');
  });

  it('produces no insignificant whitespace', () => {
    const out = canonicalize({ a: 1, b: [1, 2, 3], c: { d: 'x' } });
    expect(out).not.toMatch(/[\n\t]|(?<=[{,:[])\s|\s(?=[},:\]])/);
  });

  it('omits undefined-valued keys deterministically', () => {
    expect(canonicalize({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
  });

  it('preserves null values', () => {
    expect(canonicalize({ a: null, b: 1 })).toBe('{"a":null,"b":1}');
  });

  it('is stable across repeated calls (byte-identical)', () => {
    const value = { a: 1, nested: { z: 1, y: [1, { b: 2, a: 1 }] } };
    expect(canonicalize(value)).toBe(canonicalize(value));
  });

  it('handles primitives directly', () => {
    expect(canonicalize('x')).toBe('"x"');
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize(true)).toBe('true');
  });
});

describe('hashCanonical', () => {
  it('delegates to canonicalize before hashing — single serializer for both hashes', async () => {
    const seen: string[] = [];
    const digestFn = async (input: string) => {
      seen.push(input);
      return `digest:${input.length}`;
    };
    const value = { b: 1, a: 2 };
    const result = await hashCanonical(value, digestFn);
    expect(seen).toEqual([canonicalize(value)]);
    expect(result).toBe(`digest:${canonicalize(value).length}`);
  });

  it('is reproducible for the same input', async () => {
    const digestFn = async (input: string) => `d:${input}`;
    const value = { z: 1, a: { c: 2, b: 3 } };
    const first = await hashCanonical(value, digestFn);
    const second = await hashCanonical(value, digestFn);
    expect(first).toBe(second);
  });
});
