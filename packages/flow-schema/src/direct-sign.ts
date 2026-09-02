import type { BelehrungBlock } from './blocks/belehrung.ts';
import type { ProductDefinition } from './product-definition.ts';

/**
 * Single Fachanwalt-reviewable platform-default Widerrufsbelehrung
 * (statutory withdrawal notice, § 312g/355 BGB) text. This is the SOLE
 * default-notice-text definition in the package (D-02): a direct-sign
 * product's belehrung gate block falls back to this text unless a company
 * supplies its own override at upload time. Kept as German legal text per
 * the language policy (translated legal terms lose their precise meaning).
 *
 * DSGN-04: this exact constant is the artifact reviewed and signed off by
 * a Fachanwalt (specialized attorney) before any direct-sign product may
 * go to production.
 */
export const PLATFORM_DEFAULT_BELEHRUNG_TEXT = `Widerrufsbelehrung

Widerrufsrecht

Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gruenden diesen Vertrag zu widerrufen.

Die Widerrufsfrist betraegt vierzehn Tage ab dem Tag des Vertragsschlusses.

Um Ihr Widerrufsrecht auszuueben, muessen Sie uns mittels einer eindeutigen Erklaerung (z. B. ein mit der Post versandter Brief, Telefax oder E-Mail) ueber Ihren Entschluss, diesen Vertrag zu widerrufen, informieren. Sie koennen dafuer das beigefuegte Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist.

Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung ueber die Ausuebung des Widerrufsrechts vor Ablauf der Widerrufsfrist absenden.

Folgen des Widerrufs

Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben, unverzueglich und spaetestens binnen vierzehn Tagen ab dem Tag zurueckzuzahlen, an dem die Mitteilung ueber Ihren Widerruf dieses Vertrags bei uns eingegangen ist. Fuer diese Rueckzahlung verwenden wir dasselbe Zahlungsmittel, das Sie bei der urspruenglichen Transaktion eingesetzt haben, es sei denn, mit Ihnen wurde ausdruecklich etwas anderes vereinbart; in keinem Fall werden Ihnen wegen dieser Rueckzahlung Entgelte berechnet.

Haben Sie verlangt, dass die Dienstleistungen waehrend der Widerrufsfrist beginnen sollen, so haben Sie uns einen angemessenen Betrag zu zahlen, der dem Anteil der bis zu dem Zeitpunkt, zu dem Sie uns von der Ausuebung des Widerrufsrechts hinsichtlich dieses Vertrags unterrichten, bereits erbrachten Dienstleistungen im Vergleich zum Gesamtumfang der im Vertrag vorgesehenen Dienstleistungen entspricht.`;

/** The stable id the notice-gate trigger (0030) resolves this gate block by. */
export const DIRECT_SIGN_BELEHRUNG_BLOCK_ID = 'direct-sign-belehrung';

/**
 * Builds the app-native belehrung gate block that every direct_pdf product
 * MUST carry so the UNMODIFIED 0030 notice-gate trigger enforces it
 * (Pattern 3 / D-02). Uses PLATFORM_DEFAULT_BELEHRUNG_TEXT unless the
 * company supplied an override.
 */
export function buildBelehrungGateBlock(noticeText?: string): BelehrungBlock {
  return {
    type: 'belehrung',
    id: DIRECT_SIGN_BELEHRUNG_BLOCK_ID,
    label: 'Widerrufsbelehrung',
    gate: true,
    noticeText: noticeText && noticeText.length > 0 ? noticeText : PLATFORM_DEFAULT_BELEHRUNG_TEXT,
  };
}

/**
 * Publish-time validator (SSOT gate, called by the admin publish path —
 * Plan 10-06 — before writing a direct_pdf product_definitions row).
 * Structurally forbids a notice-less direct-sign product: rejects a
 * direct_pdf product missing a directSignTemplateId, missing a belehrung
 * gate block, or carrying one with empty noticeText. No-op for flow_form
 * products (does not disturb the existing publish path).
 */
export function assertDirectSignPublishable(product: ProductDefinition): void {
  if (product.contract_mode !== 'direct_pdf') {
    return;
  }

  if (!product.directSignTemplateId) {
    throw new Error(
      `direct_pdf product "${product.slug}" is missing a directSignTemplateId`,
    );
  }

  const belehrungGateBlock = product.blocks.find(
    (block): block is BelehrungBlock => block.type === 'belehrung' && block.gate === true,
  );

  if (!belehrungGateBlock) {
    throw new Error(
      `direct_pdf product "${product.slug}" is missing a belehrung gate block (gate=true) — the notice-gate trigger cannot enforce Widerrufsbelehrung without it`,
    );
  }

  if (!belehrungGateBlock.noticeText || belehrungGateBlock.noticeText.trim().length === 0) {
    throw new Error(
      `direct_pdf product "${product.slug}"'s belehrung gate block has empty noticeText`,
    );
  }
}
