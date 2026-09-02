import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { productDefinitionSchema } from './product-definition.ts';
import { discountTermsSchema } from './discount-terms.ts';
import { visibleBlocks } from './conditions.ts';

/**
 * Gate on the AUTHORED product files under products/.
 *
 * Publishing is a CLI call against a live database, so an authoring mistake is
 * caught either by a schema error at the terminal or — worse — by nobody, and
 * then it is standing at a front door. These assertions run in CI against the
 * files themselves.
 *
 * The pricing rule is the reason this file exists: a `discount` block points at
 * exactly ONE terms row. Until v3, smaica had one discount block and three
 * packages, so Basic, Plus and Max all cost 199 EUR. The fix is one block per
 * package, each gated on the `paket` answer — and the thing that must hold is
 * that exactly one of them is ever visible at a time. Zero means a customer who
 * chose a package sees no price; two means they see two.
 */

const PRODUCTS_DIR = join(__dirname, '..', '..', '..', 'products');

function productDirs(): string[] {
  if (!existsSync(PRODUCTS_DIR)) return [];
  return readdirSync(PRODUCTS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('authored product files', () => {
  const dirs = productDirs();

  it('finds the products directory', () => {
    expect(dirs.length).toBeGreaterThan(0);
  });

  for (const dir of dirs) {
    const base = join(PRODUCTS_DIR, dir);
    const versions = readdirSync(base).filter((f) => /^v\d+\.json$/.test(f));

    for (const file of versions) {
      it(`${dir}/${file} validates against productDefinitionSchema`, () => {
        const result = productDefinitionSchema.safeParse(readJson(join(base, file)));
        expect(result.success ? null : result.error.issues).toBeNull();
      });
    }

    const termsDir = join(base, 'discount-terms');
    if (existsSync(termsDir)) {
      for (const file of readdirSync(termsDir).filter((f) => /^v\d+\.json$/.test(f))) {
        it(`${dir}/discount-terms/${file} validates against discountTermsSchema`, () => {
          const result = discountTermsSchema.safeParse(readJson(join(termsDir, file)));
          expect(result.success ? null : result.error.issues).toBeNull();
        });
      }
    }
  }
});

describe('a product with a package choice prices every package', () => {
  for (const dir of productDirs()) {
    const base = join(PRODUCTS_DIR, dir);
    for (const file of readdirSync(base).filter((f) => /^v\d+\.json$/.test(f))) {
      const parsed = productDefinitionSchema.safeParse(readJson(join(base, file)));
      if (!parsed.success) continue;
      const blocks = parsed.data.blocks;
      const choice = blocks.find((b) => b.type === 'choice' && b.id === 'paket');
      const discounts = blocks.filter((b) => b.type === 'discount');
      // Only meaningful once the authoring pattern is in use: a package choice
      // AND more than one discount block. A single-discount product is the old
      // shape and is reported by the flat-price test below instead.
      if (!choice || choice.type !== 'choice' || discounts.length < 2) continue;

      for (const option of choice.options) {
        it(`${dir}/${file}: exactly one discount is visible for "${option.value}"`, () => {
          const visible = visibleBlocks(blocks, { paket: option.value });
          const visibleDiscounts = visible.filter((b) => b.type === 'discount');
          expect(visibleDiscounts).toHaveLength(1);
        });
      }
    }
  }
});

/**
 * H02 — attachment paths are Storage keys, not free text.
 *
 * `attachments[].storagePath` names an object in the private
 * direct-sign-templates bucket, whose first path segment IS the owning
 * company's id (0067). The dispatcher enforces that prefix before it downloads
 * anything (isAttachmentPathAllowed, T-H02-01), which means an authoring typo
 * does not produce a wrong document — it produces a render job that
 * dead-letters at the door, after the customer has already signed. Catching it
 * here, in CI, against the authored file is the only place it is still cheap.
 */
describe('authored attachments name a company-scoped Storage object', () => {
  const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  for (const dir of productDirs()) {
    const base = join(PRODUCTS_DIR, dir);
    for (const file of readdirSync(base).filter((f) => /^v\d+\.json$/.test(f))) {
      const parsed = productDefinitionSchema.safeParse(readJson(join(base, file)));
      if (!parsed.success || parsed.data.attachments.length === 0) continue;

      it(`${dir}/${file}: every attachment path is <company-uuid>/<object>`, () => {
        for (const attachment of parsed.data.attachments) {
          const [companySegment, ...rest] = attachment.storagePath.split('/');
          expect(companySegment).toMatch(UUID_SEGMENT);
          expect(rest.length).toBeGreaterThan(0);
          expect(rest.join('/')).not.toBe('');
          expect(attachment.storagePath).not.toContain('..');
          expect(attachment.label.trim()).not.toBe('');
        }
      });
    }
  }
});
