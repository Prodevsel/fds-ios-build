import { PLATFORM_DEFAULT_BELEHRUNG_TEXT } from './direct-sign.ts';
import type { Block } from './product-definition.ts';

/**
 * Build a complete, closable product out of a package list.
 *
 * Authoring a product means writing JSON and running a CLI. That is fine for
 * this repo and impossible for an operator, so the one product shape that
 * actually recurs — "here are our packages, here is what each costs" — gets a
 * form, and this function is what the form produces.
 *
 * The pricing rule is the reason it is a function and not a template someone
 * copies: a `discount` block points at exactly ONE terms row, so N packages
 * need N discount blocks, each gated on the package answer. Written by hand
 * that mistake is invisible — every package quietly costs the same, which is
 * exactly what smaica's product did until today.
 *
 * Deliberately NOT a general block editor. The blocks below are the minimum
 * that makes a consultation closable: choose, say where the contract goes,
 * see the price for what was chosen, read the withdrawal notice, sign. Anything
 * richer (ID scan, IBAN, branch questions) stays with the JSON + CLI path.
 */

export interface ProductPackage {
  /** Stable answer value — also the discount block's showIf target. */
  value: string;
  /** What the customer reads in the choice list and on the contract. */
  label: string;
  /** Id of the discount_terms row carrying this package's prices. */
  termsId: string;
}

export interface BuildPackageProductInput {
  packages: readonly ProductPackage[];
  /** Question above the package list. */
  choiceLabel?: string;
  /** Per-company withdrawal notice; falls back to the platform default (D-02). */
  noticeText?: string;
}

/** Slug-safe answer value derived from a package name. Exported for the form's preview. */
export function packageValueFromLabel(label: string): string {
  // German transliteration FIRST: NFD + mark-stripping would turn ö into a bare
  // o, and "Grosse" is not how anyone writes "Größe". Everything else that is
  // still non-ASCII afterwards loses its diacritic and keeps its base letter.
  return label
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * The blocks, in the order the customer meets them. Throws on an empty package
 * list: a product that asks a choice with no options is not a product, and
 * failing here is better than publishing an immutable row nobody can fix.
 */
export function buildPackageProductBlocks(input: BuildPackageProductInput): Block[] {
  if (input.packages.length === 0) {
    throw new Error('buildPackageProductBlocks: at least one package is required');
  }

  const seen = new Set<string>();
  for (const pkg of input.packages) {
    if (seen.has(pkg.value)) {
      throw new Error(`buildPackageProductBlocks: duplicate package value "${pkg.value}"`);
    }
    seen.add(pkg.value);
  }

  const choice: Block = {
    type: 'choice',
    id: 'paket',
    label: input.choiceLabel?.trim() || 'Welches Paket passt zum Bedarf?',
    gate: false,
    options: input.packages.map((pkg) => ({ value: pkg.value, label: pkg.label })),
  };

  // One per package, each visible only for its own answer. Exactly one is ever
  // on screen — asserted for every authored product in authored-products.test.ts.
  const discounts: Block[] = input.packages.map((pkg) => ({
    type: 'discount',
    id: `door-discount-${pkg.value}`,
    label: `Ihr exklusiver Tuer-Vorteil — ${pkg.label}`,
    gate: false,
    showIf: [{ field: 'paket', operator: 'equals', value: pkg.value }],
    termsRef: pkg.termsId,
    showComparisonPrice: true,
    emphasize: true,
  }));

  // QUICK-GTI (Befund 2): a dashboard-built package product had NO name source
  // at all — [choice, contact(email), ...discounts, belehrung, signature] —
  // so `contracts.customer_name` stayed null for every product built this way,
  // and /abschluesse showed a dash instead of a customer. `contracts` is
  // append-only (0004), so that value cannot be repaired afterwards. The block
  // TYPE always existed (contactBlockSchema.field includes 'name'); only this
  // generator never emitted one. Authored products in products/ carry an
  // `id-scan` block instead and were never affected.
  const customerName: Block = {
    type: 'contact',
    id: 'kundenname',
    field: 'name',
    // Gated for the same reason the email is: a contract with no name on it is
    // not a contract anybody can act on.
    gate: true,
    required: true,
    label: 'Auf welchen Namen läuft der Vertrag?',
  };

  const email: Block = {
    type: 'contact',
    id: 'email',
    // Gated: without an address the dispatcher has nothing to send the signed
    // contract to, and the render job dead-letters on "no customer email".
    gate: true,
    label: 'An welche E-Mail-Adresse soll der Vertrag gehen?',
    field: 'email',
    required: true,
  };

  const belehrung: Block = {
    type: 'belehrung',
    id: 'withdrawal-notice',
    label: 'Widerrufsbelehrung',
    gate: true,
    noticeText: input.noticeText?.trim() || PLATFORM_DEFAULT_BELEHRUNG_TEXT,
  };

  const signature: Block = {
    type: 'signature',
    id: 'signature',
    label: 'Unterschrift',
    gate: true,
  };

  return [choice, customerName, email, ...discounts, belehrung, signature];
}
