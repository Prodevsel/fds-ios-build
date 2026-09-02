import { describe, expect, it } from 'vitest';
import {
  type Block,
  DEFAULT_OFFER_CONSENT_BLOCK,
  directSignQuestionBlocks,
} from '@frontdoorsales/flow-schema';
import {
  buildDirectSignOfferSnapshot,
  deriveOfferContactFromAnswers,
  resolveOfferConsentBlock,
} from './directSignOffer';

/**
 * Pure-module test: `directSignOffer.ts` imports only from
 * `@frontdoorsales/flow-schema`, so no native mock is needed here.
 */

const packageBlock = {
  type: 'choice',
  id: 'q-package',
  label: 'Ihr Paket',
  options: [
    { value: 'basic', label: 'Basic', price: '99,00 EUR mtl.' },
    { value: 'plus', label: 'Plus', price: '199,00 EUR mtl.' },
  ],
} as unknown as Block;

/** A choice that is a QUESTION, not a package: no option carries a price. */
const partyBlock = {
  type: 'choice',
  id: 'q-party',
  label: 'Wer schliesst ab?',
  options: [
    { value: 'privat', label: 'Privatperson' },
    { value: 'firma', label: 'Firma' },
  ],
} as unknown as Block;

const belehrungBlock = {
  type: 'belehrung',
  id: 'belehrung',
  label: 'Widerrufsbelehrung',
  gate: true,
  noticeText: 'Sie haben das Recht, binnen 14 Tagen zu widerrufen.',
  requiresConfirmation: true,
} as unknown as Block;

const emailBlock = {
  type: 'contact',
  id: 'q-email',
  label: 'E-Mail',
  gate: false,
  field: 'email',
  required: true,
} as unknown as Block;

const phoneBlock = { ...(emailBlock as object), id: 'q-phone', field: 'phone' } as unknown as Block;
const nameBlock = { ...(emailBlock as object), id: 'q-name', field: 'name' } as unknown as Block;

const choiceBlock = {
  type: 'choice',
  id: 'q-package',
  label: 'Paket',
  gate: false,
  options: [{ value: 'plus', label: 'Plus' }],
} as unknown as Block;

const productConsentBlock = {
  type: 'consent',
  id: 'product-consent',
  label: 'Eigene Einwilligung',
  gate: false,
  consentText: 'Produkteigener Einwilligungstext.',
  requiresConfirmation: true,
  contactFields: ['email'],
} as unknown as Block;

describe('resolveOfferConsentBlock (D-4)', () => {
  it("falls back to the platform default for the block list publishDirectSignProduct actually writes (questions + belehrung, NO consent)", () => {
    const published: Block[] = [emailBlock, choiceBlock, belehrungBlock];
    expect(resolveOfferConsentBlock(published)).toBe(DEFAULT_OFFER_CONSENT_BLOCK);
  });

  it("prefers the product's own consent block when the blocks carry one", () => {
    const resolved = resolveOfferConsentBlock([emailBlock, productConsentBlock, belehrungBlock]);
    expect(resolved.id).toBe('product-consent');
    expect(resolved).not.toBe(DEFAULT_OFFER_CONSENT_BLOCK);
  });

  it('falls back for an empty block list rather than returning undefined', () => {
    expect(resolveOfferConsentBlock([])).toBe(DEFAULT_OFFER_CONSENT_BLOCK);
  });

  it('does NOT add the consent block to what the flow asks — directSignQuestionBlocks stays the SSOT filter', () => {
    const blocks: Block[] = [emailBlock, productConsentBlock, belehrungBlock];
    expect(directSignQuestionBlocks(blocks).map((b) => b.id)).toEqual(['q-email']);
  });
});

describe('deriveOfferContactFromAnswers (D-5, the e-mail is not asked twice)', () => {
  it('maps a contact block with field email onto the contact email', () => {
    expect(deriveOfferContactFromAnswers([emailBlock], { 'q-email': 'a@b.de' })).toEqual({
      email: 'a@b.de',
    });
  });

  it('maps phone and name likewise', () => {
    expect(
      deriveOfferContactFromAnswers([phoneBlock, nameBlock], {
        'q-phone': '+49 30 123456',
        'q-name': 'Erika Mustermann',
      }),
    ).toEqual({ phone: '+49 30 123456', name: 'Erika Mustermann' });
  });

  it('produces NO key for a blank or whitespace-only answer, never an empty string', () => {
    expect(deriveOfferContactFromAnswers([emailBlock], { 'q-email': '   ' })).toEqual({});
    expect(deriveOfferContactFromAnswers([emailBlock], { 'q-email': '' })).toEqual({});
    expect(deriveOfferContactFromAnswers([emailBlock], {})).toEqual({});
  });

  it('ignores a non-string answer', () => {
    expect(deriveOfferContactFromAnswers([emailBlock], { 'q-email': 42 })).toEqual({});
    expect(deriveOfferContactFromAnswers([emailBlock], { 'q-email': null })).toEqual({});
  });

  it('ignores non-contact blocks entirely', () => {
    expect(
      deriveOfferContactFromAnswers([choiceBlock, belehrungBlock], {
        'q-package': 'plus',
        belehrung: true,
      }),
    ).toEqual({});
  });

  it('trims the value it does keep', () => {
    expect(deriveOfferContactFromAnswers([emailBlock], { 'q-email': ' a@b.de ' })).toEqual({
      email: 'a@b.de',
    });
  });
});

describe('buildDirectSignOfferSnapshot (D-6, redemption routing)', () => {
  it('always carries the productSlug, so a redeemed code reopens the PDF path', () => {
    const snapshot = buildDirectSignOfferSnapshot({
      productSlug: 'social-media-plus',
      answers: { 'q-email': 'a@b.de' },
    });
    expect(snapshot.productSlug).toBe('social-media-plus');
  });

  it('carries the answers actually shown to the customer', () => {
    const answers = { 'q-email': 'a@b.de', 'q-package': 'plus' };
    const snapshot = buildDirectSignOfferSnapshot({ productSlug: 'p', answers });
    expect(snapshot.answers).toEqual(answers);
  });

  it('pins the product version, so a redemption after a new publish still shows what was quoted', () => {
    const snapshot = buildDirectSignOfferSnapshot({
      productSlug: 'p',
      answers: {},
      productDefinitionId: 'd3100000-0000-0000-0000-000000000001',
      productVersion: 4,
    });
    expect(snapshot.productDefinitionId).toBe('d3100000-0000-0000-0000-000000000001');
    expect(snapshot.productVersion).toBe(4);
  });

  it('omits both pin keys rather than writing null: offer_portal_view guards on key presence', () => {
    const snapshot = buildDirectSignOfferSnapshot({
      productSlug: 'p',
      answers: {},
      productDefinitionId: null,
      productVersion: 4,
    });
    expect(Object.keys(snapshot)).not.toContain('productDefinitionId');
    expect(Object.keys(snapshot)).not.toContain('productVersion');
  });

  it('never fabricates doorPrice, comparisonPrice or discountAmount for a product that captured none', () => {
    const snapshot = buildDirectSignOfferSnapshot({ productSlug: 'p', answers: {} });
    expect(Object.keys(snapshot)).not.toContain('doorPrice');
    expect(Object.keys(snapshot)).not.toContain('comparisonPrice');
    expect(Object.keys(snapshot)).not.toContain('discountAmount');
  });

  it('does not alias the caller\'s answers object into the frozen snapshot', () => {
    const answers: Record<string, unknown> = { 'q-email': 'a@b.de' };
    const snapshot = buildDirectSignOfferSnapshot({ productSlug: 'p', answers });
    answers['q-email'] = 'changed@later.de';
    expect((snapshot.answers as Record<string, unknown>)['q-email']).toBe('a@b.de');
  });
  it('freezes the chosen package and its price, so the page shows conditions and not a date', () => {
    const snapshot = buildDirectSignOfferSnapshot({
      productSlug: 'p',
      answers: { 'q-package': 'plus' },
      blocks: [packageBlock],
    });
    expect(snapshot.packageLabel).toBe('Plus');
    expect(snapshot.packagePrice).toBe('199,00 EUR mtl.');
  });

  it('skips a choice whose chosen option has no price -- an ordinary question is not a package', () => {
    const snapshot = buildDirectSignOfferSnapshot({
      productSlug: 'p',
      answers: { 'q-party': 'firma', 'q-package': 'plus' },
      blocks: [partyBlock, packageBlock],
    });
    expect(snapshot.packageLabel).toBe('Plus');
  });

  it('freezes nothing at all when no package was chosen, rather than an empty string', () => {
    const snapshot = buildDirectSignOfferSnapshot({
      productSlug: 'p',
      answers: {},
      blocks: [packageBlock],
    });
    expect(Object.keys(snapshot)).not.toContain('packageLabel');
    expect(Object.keys(snapshot)).not.toContain('packagePrice');
  });

  it('carries the houseId, which is the only route the customer address has to the contract', () => {
    const snapshot = buildDirectSignOfferSnapshot({
      productSlug: 'p',
      answers: {},
      houseId: 'd3100000-0000-0000-0000-0000000000aa',
    });
    expect(snapshot.houseId).toBe('d3100000-0000-0000-0000-0000000000aa');
  });

  it('omits houseId rather than writing null: offer_portal_sign casts a present key', () => {
    const snapshot = buildDirectSignOfferSnapshot({ productSlug: 'p', answers: {} });
    expect(Object.keys(snapshot)).not.toContain('houseId');
  });
});
