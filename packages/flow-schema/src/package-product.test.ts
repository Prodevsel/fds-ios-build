import { describe, expect, it } from 'vitest';
import { visibleBlocks } from './conditions.ts';
import { productDefinitionSchema } from './product-definition.ts';
import { buildPackageProductBlocks, packageValueFromLabel } from './package-product.ts';

const PACKAGES = [
  { value: 'basic', label: 'Basic', termsId: '00000000-0000-4000-8000-000000000001' },
  { value: 'plus', label: 'Plus', termsId: '00000000-0000-4000-8000-000000000002' },
  { value: 'max', label: 'Max', termsId: '00000000-0000-4000-8000-000000000003' },
];

describe('packageValueFromLabel', () => {
  it('produces a stable, slug-safe answer value', () => {
    expect(packageValueFromLabel('Basic — 12 Inhalte')).toBe('basic-12-inhalte');
    expect(packageValueFromLabel('Größe L')).toBe('groesse-l');
  });
});

describe('buildPackageProductBlocks', () => {
  it('produces a product that validates against the schema', () => {
    const result = productDefinitionSchema.safeParse({
      slug: 'test-produkt',
      version: 1,
      status: 'published',
      blocks: buildPackageProductBlocks({ packages: PACKAGES }),
    });
    expect(result.success ? null : result.error.issues).toBeNull();
  });

  it('shows exactly one price, for the package the customer chose', () => {
    const blocks = buildPackageProductBlocks({ packages: PACKAGES });
    for (const pkg of PACKAGES) {
      const visible = visibleBlocks(blocks, { paket: pkg.value });
      const discounts = visible.filter((b) => b.type === 'discount');
      expect(discounts).toHaveLength(1);
      expect(discounts[0] && 'termsRef' in discounts[0] ? discounts[0].termsRef : null).toBe(
        pkg.termsId,
      );
    }
  });

  it('emits a contact(name) block before the email — without it customer_name is null forever', () => {
    // QUICK-GTI (Befund 2): the generator had no name source at all, so every
    // dashboard-built product wrote a null contracts.customer_name and
    // /abschluesse showed a dash. contracts is append-only (0004) — the value
    // is captured in the flow or it is lost for that deal.
    const blocks = buildPackageProductBlocks({ packages: PACKAGES });
    const name = blocks.find((b) => b.type === 'contact' && 'field' in b && b.field === 'name');
    expect(name).toBeDefined();
    expect(name?.gate).toBe(true);
    const nameIndex = blocks.findIndex((b) => b.id === name?.id);
    const emailIndex = blocks.findIndex((b) => b.id === 'email');
    expect(nameIndex).toBeLessThan(emailIndex);
  });

  it('gates the email — without it the signed contract has nowhere to go', () => {
    const blocks = buildPackageProductBlocks({ packages: PACKAGES });
    const email = blocks.find((b) => b.id === 'email');
    expect(email?.gate).toBe(true);
  });

  it('carries a withdrawal notice and a signature, both gated', () => {
    const blocks = buildPackageProductBlocks({ packages: PACKAGES });
    expect(blocks.find((b) => b.type === 'belehrung')?.gate).toBe(true);
    expect(blocks.find((b) => b.type === 'signature')?.gate).toBe(true);
    const notice = blocks.find((b) => b.type === 'belehrung');
    expect(notice && 'noticeText' in notice ? notice.noticeText.length : 0).toBeGreaterThan(100);
  });

  it('refuses an empty package list rather than publishing an unfixable row', () => {
    expect(() => buildPackageProductBlocks({ packages: [] })).toThrow(/at least one/i);
  });

  it('refuses duplicate package values — two prices for one answer', () => {
    expect(() =>
      buildPackageProductBlocks({
        packages: [PACKAGES[0]!, { ...PACKAGES[0]!, termsId: 'other' }],
      }),
    ).toThrow(/duplicate/i);
  });
});
