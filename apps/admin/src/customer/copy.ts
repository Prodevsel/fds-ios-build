/**
 * German end-customer copy for the offer page, as named constants.
 *
 * Language policy (CLAUDE.md): the working language is English, end-user-facing
 * copy is German and lives in a resource, never hardcoded in a component. This
 * file is that resource. It is deliberately NOT i18next: pulling i18next into
 * the customer bundle would drag a second runtime and a loader into a page with
 * exactly one locale, and scripts/ci/customer-bundle-isolation.mjs forbids it
 * for that reason.
 *
 * The customer never reads our platform name. Every place a name belongs, the
 * COMPANY name from the server response is used instead.
 */
export const COPY = {
  // ── Code gate ─────────────────────────────────────────────────────────────
  gateTitle: 'Ihr Angebot',
  gateIntro:
    'Bitte geben Sie den Einmalcode aus Ihrer E-Mail ein, um Ihr Angebot anzusehen.',
  gateCodeLabel: 'Einmalcode',
  gateCodePlaceholder: 'FDS-XXXX-XXXX',
  gateSubmit: 'Angebot anzeigen',
  gateChecking: 'Einen Moment …',

  // ── Refusals ──────────────────────────────────────────────────────────────
  // Deliberately says neither "dieses Angebot gibt es nicht" nor "der Code ist
  // falsch". The server cannot tell the two apart on purpose, and this sentence
  // must not undo that.
  errorInvalid:
    'Mit diesen Angaben können wir kein Angebot öffnen. Bitte prüfen Sie den Link aus Ihrer E-Mail und den Einmalcode.',
  errorExpired:
    'Die Frist für dieses Angebot ist abgelaufen. Ihr Berater kann Ihnen ein neues Angebot zusenden.',
  errorRedeemed:
    'Dieses Angebot wurde bereits angenommen. Eine Bestätigung ist an Ihre E-Mail-Adresse unterwegs.',
  errorUnavailable:
    'Dieses Angebot kann online derzeit nicht angezeigt werden. Bitte wenden Sie sich an Ihren Berater.',
  errorRateLimited:
    'Es gab zu viele Versuche. Bitte versuchen Sie es in einer Stunde noch einmal.',
  errorNetwork:
    'Die Verbindung ist fehlgeschlagen. Bitte versuchen Sie es noch einmal.',
  errorNoToken:
    'Diese Seite wird über den Link in Ihrer Angebots-E-Mail geöffnet. Bitte rufen Sie den Link von dort aus auf.',

  // ── Offer ─────────────────────────────────────────────────────────────────
  offerHeading: 'Ihre Konditionen',
  offerPackage: 'Ihr Paket',
  offerPackagePrice: 'Monatlich',
  offerDoorPrice: 'Ihr Preis',
  offerComparisonPrice: 'Vergleichspreis',
  offerDiscount: 'Ihr Vorteil',
  offerTerms: 'Konditionen',
  offerValidUntil: 'Gültig bis',
  offerGreeting: 'Guten Tag',

  // ── Withdrawal notice (Widerrufsbelehrung) gate ───────────────────────────
  noticeHeading: 'Widerrufsbelehrung',
  noticeConfirm: 'Ich habe die Widerrufsbelehrung gelesen und zur Kenntnis genommen.',
  noticeMissing:
    'Für dieses Angebot liegt keine Widerrufsbelehrung vor. Ein Abschluss ist hier deshalb nicht möglich — bitte wenden Sie sich an Ihren Berater.',

  // ── Signature ─────────────────────────────────────────────────────────────
  signatureHeading: 'Ihre Unterschrift',
  signatureHint: 'Bitte unterschreiben Sie mit dem Finger oder der Maus im Feld.',
  signatureClear: 'Neu unterschreiben',
  signatureSubmit: 'Jetzt verbindlich abschliessen',
  signatureSubmitting: 'Wird übermittelt …',

  // ── Done ──────────────────────────────────────────────────────────────────
  doneHeading: 'Vielen Dank — Ihr Vertrag ist abgeschlossen.',
  doneReference: 'Ihre Vorgangsnummer',
  doneMailHint:
    'Sie erhalten Ihren Vertrag als PDF in Kürze per E-Mail. Bitte sehen Sie gegebenenfalls auch im Spam-Ordner nach.',

  // ── The contract document (direct_pdf) ────────────────────────────────────
  documentHeading: 'Ihr Vertrag',
  documentHint:
    'Bitte lesen Sie den Vertrag. Ihre Angaben sind bereits eingetragen — unterschreiben können Sie weiter unten.',
  documentFallback: 'Vertrag als PDF öffnen',
  documentLoading: 'Ihr Vertrag wird vorbereitet …',

  // The EXCEPTION, not the normal case: the product has no signable document
  // (no template, or one published without a signature placement). It no longer
  // stands in for "we did not build this" — the customer signs here now.
  directPdfHint:
    'Dieser Vertrag lässt sich hier gerade nicht anzeigen. Ihre Konditionen sehen Sie oben; Ihr Berater meldet sich für den Abschluss bei Ihnen.',
} as const;
