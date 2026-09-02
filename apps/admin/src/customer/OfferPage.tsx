import { type FormEvent, useEffect, useState } from 'react';
import {
  buildBrowserAuditPackage,
  buildConfirmedGateEntry,
  computeDocumentHash,
  computePackageHash,
  type ConfirmedGateEntry,
} from './auditPackage';
import { COPY } from './copy';
import { offerApi, type OfferApi } from './offerApi';
import {
  type BelehrungBlock,
  deriveDocument,
  deriveSignState,
  deriveState,
  type OfferDocument,
  formatDate,
  formatEuro,
  INITIAL_STATE,
  isSignatureReachable,
  type OfferDetails,
  type OfferState,
} from './offerState';
import { type SignatureCapture, SignaturePad } from './SignaturePad';

/**
 * The customer-facing offer page.
 *
 * One screen, one strict order, each step unreachable until the one before it
 * is done:
 *   code  ->  offer  ->  Widerrufsbelehrung  ->  signature  ->  done
 *
 * "Unreachable" is meant literally at both gates. Before a correct code the
 * offer data does not EXIST in this component — offerState.ts's locked variant
 * has no field to put it in, so there is nothing for a curious reader of the
 * page's memory or the network tab to find. Before the withdrawal notice is
 * confirmed the signature surface is not in the DOM — not disabled, not hidden.
 * A disabled control is a control, and the whole point of § 312b BGB's notice
 * requirement is that signing is not something the customer can arrive at
 * before he has been told he may withdraw.
 *
 * No router, no query client, no i18n runtime, no Supabase client. The customer
 * downloads a page, not a dashboard.
 */

export interface OfferPageProps {
  /** Injected in tests. Defaults to the real fetch-based client. */
  api?: OfferApi;
  /** Injected in tests so no test depends on jsdom's location. */
  token?: string | null;
  /** Injected in tests: jsdom's canvas cannot rasterize. See SignaturePad. */
  renderPng?: (canvas: HTMLCanvasElement) => string | null;
  /** Injected in tests so an assertion can name a fixed instant. */
  now?: () => Date;
}

function readTokenFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('t');
}

function Refusal({ message }: { message: string }) {
  return (
    <p data-testid="refusal" style={{ margin: '1.5rem 0', lineHeight: 1.6 }}>
      {message}
    </p>
  );
}

/** A snapshot string, or null so PriceRow omits the row entirely. Never ''. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function PriceRow({ label, value }: { label: string; value: string | null }) {
  // A missing price field omits the whole row. Never "0,00 €".
  if (value === null) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0' }}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function OfferPage({ api = offerApi, token: tokenProp, renderPng, now }: OfferPageProps = {}) {
  const token = tokenProp !== undefined ? tokenProp : readTokenFromLocation();
  const clock = now ?? (() => new Date());
  const [state, setState] = useState<OfferState>(INITIAL_STATE);
  const [code, setCode] = useState('');
  const [confirmedGates, setConfirmedGates] = useState<ConfirmedGateEntry[]>([]);
  const [signature, setSignature] = useState<SignatureCapture | null>(null);
  // `undefined` = not asked yet (the direct_pdf page shows a "wird geladen"
  // line), `null` = asked and there is none. The two are NOT the same thing and
  // collapsing them would make a still-loading page look like a permanent
  // refusal to the one customer whose contract takes a second to render.
  const [contractDoc, setContractDoc] = useState<OfferDocument | null | undefined>(undefined);

  // Without a token there is nothing to ask about, so there is no form to fill
  // in. Rendering one would invite a customer to type his code into a page that
  // cannot use it.
  if (!token) {
    return (
      <main style={pageStyle}>
        <h1 style={{ fontSize: '1.25rem' }}>{COPY.gateTitle}</h1>
        <Refusal message={COPY.errorNoToken} />
      </main>
    );
  }

  async function onSubmitCode(event: FormEvent) {
    event.preventDefault();
    if (!token || code.trim().length === 0) return;
    setState({ kind: 'checking' });
    try {
      const { status, body } = await api.view(token, code);
      const next = deriveState(status, body);
      setState(next);
      // Only after the code was accepted, and only for the product kind that
      // HAS a document. A flow_form offer is a rendered page, not a file, and
      // asking for one would spend a rate-limit try on a guaranteed null.
      if (next.kind === 'unlocked' && next.offer.productKind === 'direct_pdf') {
        // Its OWN try: a failed document render must not throw away an offer
        // the server already validated. The customer keeps his conditions and
        // gets the no-document fallback, which is a smaller loss than being
        // sent back to the code field.
        try {
          const doc = await api.document(token, code);
          setContractDoc(deriveDocument(doc.status, doc.body));
        } catch {
          setContractDoc(null);
        }
      }
    } catch {
      setState({ kind: 'network_error' });
    }
  }

  /**
   * Confirming a notice block records WHAT WAS SHOWN, not that a box was
   * ticked: the entry carries the SHA-256 of the block's own noticeText, and
   * migration 0030's BEFORE INSERT trigger refuses any contract whose
   * confirmedGates do not cover every belehrung gate block of the pinned
   * product version. The checkbox is the customer's act; the hash is the record
   * of the text he acted on.
   */
  async function onConfirmGate(block: BelehrungBlock) {
    const entry = await buildConfirmedGateEntry(block, clock().toISOString());
    setConfirmedGates((previous) =>
      previous.some((e) => e.blockId === entry.blockId) ? previous : [...previous, entry]
    );
  }

  async function onSign(offer: OfferDetails) {
    if (!token || !signature) return;
    setState({ kind: 'signing', offer, confirmedGateIds: confirmedGates.map((g) => g.blockId) });
    try {
      const signedAtIso = clock().toISOString();
      // Two paths, two honest bases for the same field name. On direct_pdf
      // there IS an original document, and its hash is the one the app's audit
      // package carries (D-04) — using it here is what makes a contract signed
      // in a browser comparable to one signed at the door. On flow_form there
      // is no file at all, so the hash covers exactly the facts that were on
      // the screen. auditPackage.ts names the difference; this is the only
      // place it is chosen.
      const documentHashSha256 = contractDoc
        ? contractDoc.originalSha256
        : await computeDocumentHash(offer.snapshot, {});
      const auditPackage = buildBrowserAuditPackage({
        documentHashSha256,
        signedAtIso,
        confirmedGates,
        signatureStrokeData: signature.strokes,
      });
      const packageHashSha256 = await computePackageHash(auditPackage);
      const { status, body } = await api.sign(token, code, {
        answers: {},
        auditPackage: auditPackage as unknown as Record<string, unknown>,
        packageHashSha256,
        signaturePngBase64: signature.pngDataUrl,
      });
      setState(deriveSignState(status, body));
    } catch {
      setState({ kind: 'network_error' });
    }
  }

  if (state.kind === 'signed') {
    return (
      <main style={pageStyle}>
        <h1 style={{ fontSize: '1.25rem' }} data-testid="done">{COPY.doneHeading}</h1>
        {state.dealReference
          ? (
            <p data-testid="deal-reference">
              {`${COPY.doneReference}: `}
              <strong>{state.dealReference}</strong>
            </p>
          )
          : null}
        <p style={{ lineHeight: 1.6 }}>{COPY.doneMailHint}</p>
      </main>
    );
  }

  if (state.kind === 'unlocked' || state.kind === 'signing') {
    return (
      <main style={pageStyle}>
        <OfferView offer={state.offer} />
        <NoticeAndSignature
          offer={state.offer}
          document={contractDoc}
          confirmedGates={confirmedGates}
          onConfirmGate={onConfirmGate}
          signature={signature}
          onSignatureChange={setSignature}
          onSign={() => onSign(state.offer)}
          submitting={state.kind === 'signing'}
          renderPng={renderPng}
        />
      </main>
    );
  }

  const refusal = refusalCopy(state.kind);

  return (
    <main style={pageStyle}>
      <h1 style={{ fontSize: '1.25rem' }}>{COPY.gateTitle}</h1>
      <p style={{ lineHeight: 1.6 }}>{COPY.gateIntro}</p>
      <form onSubmit={onSubmitCode}>
        <label htmlFor="offer-code" style={{ display: 'block', marginBottom: '0.5rem' }}>
          {COPY.gateCodeLabel}
        </label>
        <input
          id="offer-code"
          name="code"
          data-testid="code-input"
          autoComplete="one-time-code"
          placeholder={COPY.gateCodePlaceholder}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          style={{ fontSize: '1.1rem', padding: '0.6rem', width: '100%', boxSizing: 'border-box' }}
        />
        <button
          type="submit"
          data-testid="code-submit"
          disabled={state.kind === 'checking'}
          style={{ marginTop: '1rem', fontSize: '1.05rem', padding: '0.7rem 1.2rem', width: '100%' }}
        >
          {state.kind === 'checking' ? COPY.gateChecking : COPY.gateSubmit}
        </button>
      </form>
      {refusal ? <Refusal message={refusal} /> : null}
    </main>
  );
}

function refusalCopy(kind: OfferState['kind']): string | null {
  switch (kind) {
    case 'invalid':
      return COPY.errorInvalid;
    case 'expired':
      return COPY.errorExpired;
    case 'redeemed':
      return COPY.errorRedeemed;
    case 'unavailable':
      return COPY.errorUnavailable;
    case 'rate_limited':
      return COPY.errorRateLimited;
    case 'network_error':
      return COPY.errorNetwork;
    default:
      return null;
  }
}

function OfferView({ offer }: { offer: OfferDetails }) {
  const validUntil = formatDate(offer.offerExpiresAt);
  return (
    <section data-testid="offer">
      {/* The customer sees the COMPANY's name here, never ours. */}
      <h1 style={{ fontSize: '1.25rem' }}>{offer.companyDisplayName ?? COPY.gateTitle}</h1>
      {offer.contactName
        ? <p data-testid="greeting">{`${COPY.offerGreeting} ${offer.contactName},`}</p>
        : null}

      <h2 style={{ fontSize: '1.05rem', marginTop: '1.5rem' }}>{COPY.offerHeading}</h2>
      <div data-testid="conditions">
        {/* The `direct_pdf` pair. Passed through as authored TEXT, never through
            formatEuro: the product author wrote "199,00 EUR mtl." and a parse
            back into a number would drop the "mtl." the price depends on. */}
        <PriceRow label={COPY.offerPackage} value={text(offer.snapshot.packageLabel)} />
        <PriceRow label={COPY.offerPackagePrice} value={text(offer.snapshot.packagePrice)} />
        <PriceRow label={COPY.offerDoorPrice} value={formatEuro(offer.snapshot.doorPrice)} />
        <PriceRow label={COPY.offerComparisonPrice} value={formatEuro(offer.snapshot.comparisonPrice)} />
        <PriceRow label={COPY.offerDiscount} value={formatEuro(offer.snapshot.discountAmount)} />
      </div>
      {offer.snapshot.termsText
        ? (
          <p data-testid="terms-text" style={{ lineHeight: 1.6 }}>
            {offer.snapshot.termsText}
          </p>
        )
        : null}
      {validUntil
        ? <p data-testid="valid-until">{`${COPY.offerValidUntil}: ${validUntil}`}</p>
        : null}
    </section>
  );
}

interface NoticeAndSignatureProps {
  offer: OfferDetails;
  /** undefined while the render is in flight; null when there is none. */
  document: OfferDocument | null | undefined;
  confirmedGates: ConfirmedGateEntry[];
  onConfirmGate: (block: BelehrungBlock) => void;
  signature: SignatureCapture | null;
  onSignatureChange: (capture: SignatureCapture | null) => void;
  onSign: () => void;
  submitting: boolean;
  renderPng?: (canvas: HTMLCanvasElement) => string | null;
}

/**
 * The two gates after the offer, in the only order that is lawful — and, for a
 * `direct_pdf` offer, the document they are about.
 *
 * This used to short-circuit for `direct_pdf` and print "Dieser Abschluss läuft
 * über Ihren Berater": a sentence naming an action the customer cannot perform,
 * because the rep is two houses further on by then. He now reads the SAME
 * contract, filled with his own answers, that the server will mail him — the
 * render comes out of the renderer the dispatcher runs (offer-portal's
 * /document route), so page and PDF cannot disagree.
 *
 * The document is a PRECONDITION on that path, not a decoration: no document,
 * no signature. Signing something the customer was never shown is the failure
 * this whole route exists to avoid, so a null document falls back to the old
 * sentence — which is now the exception it was always meant to be.
 */
function NoticeAndSignature({
  offer,
  document,
  confirmedGates,
  onConfirmGate,
  signature,
  onSignatureChange,
  onSign,
  submitting,
  renderPng,
}: NoticeAndSignatureProps) {
  const needsDocument = offer.productKind === 'direct_pdf';

  if (needsDocument && document === undefined) {
    return (
      <p data-testid="document-loading" style={{ marginTop: '1.5rem', lineHeight: 1.6 }}>
        {COPY.documentLoading}
      </p>
    );
  }

  if (needsDocument && document === null) {
    return (
      <p data-testid="direct-pdf-hint" style={{ marginTop: '1.5rem', lineHeight: 1.6 }}>
        {COPY.directPdfHint}
      </p>
    );
  }

  const blocks = offer.belehrungBlocks;
  // No notice block means the signature is permanently unreachable — the mirror
  // of isSignatureReachable(…, []) === false, and of 0030 refusing the INSERT
  // anyway. Telling the customer now beats letting him sign into a server
  // error he cannot act on.
  if (blocks.length === 0) {
    return (
      <p data-testid="notice-missing" style={{ marginTop: '1.5rem', lineHeight: 1.6 }}>
        {COPY.noticeMissing}
      </p>
    );
  }

  const confirmedIds = confirmedGates.map((g) => g.blockId);
  const signatureReachable = isSignatureReachable(confirmedIds, blocks);

  return (
    <>
      {document ? <ContractDocument document={document} /> : null}
      <section data-testid="notice" style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1.05rem' }}>{COPY.noticeHeading}</h2>
        {blocks.map((block) => (
          <div key={block.id} style={{ marginBottom: '1.5rem' }}>
            {/* The text comes from the product's pinned block and from nowhere
                else — never a local constant, never extracted from a PDF. It is
                also the exact string whose hash goes into the audit package. */}
            <p
              data-testid={`notice-text-${block.id}`}
              style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, maxHeight: '18rem', overflowY: 'auto' }}
            >
              {block.noticeText}
            </p>
            <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', lineHeight: 1.5 }}>
              <input
                type="checkbox"
                data-testid={`notice-confirm-${block.id}`}
                checked={confirmedIds.includes(block.id)}
                // One-way on purpose: the confirmation is a recorded act with a
                // timestamp and a hash, not a preference that can be toggled
                // back and forth until the record is meaningless.
                disabled={confirmedIds.includes(block.id)}
                onChange={() => onConfirmGate(block)}
                style={{ marginTop: '0.25rem' }}
              />
              <span>{COPY.noticeConfirm}</span>
            </label>
          </div>
        ))}
      </section>

      {/* NOT `disabled`, NOT `hidden`: absent. */}
      {signatureReachable
        ? (
          <section data-testid="signature" style={{ marginTop: '1rem' }}>
            <h2 style={{ fontSize: '1.05rem' }}>{COPY.signatureHeading}</h2>
            <SignaturePad onChange={onSignatureChange} renderPng={renderPng} disabled={submitting} />
            <button
              type="button"
              data-testid="sign-submit"
              // An empty box is not a signature, and the button says so rather
              // than letting the request fail somewhere the customer cannot see.
              disabled={signature === null || submitting}
              onClick={onSign}
              style={{ marginTop: '1rem', fontSize: '1.05rem', padding: '0.8rem 1.2rem', width: '100%' }}
            >
              {submitting ? COPY.signatureSubmitting : COPY.signatureSubmit}
            </button>
          </section>
        )
        : null}
    </>
  );
}

/**
 * The contract itself, in the page, before the signature field.
 *
 * `<object>` rather than a link or a download: the customer must be able to
 * READ what he is about to sign without leaving the page and without a second
 * app. A browser that cannot display PDFs inline shows the fallback link
 * instead, which is what <object>'s children are for.
 *
 * The blob URL is created once per document and revoked on unmount — an
 * un-revoked object URL keeps the whole PDF alive in memory for the lifetime of
 * the page, and this one is the largest thing the page ever holds.
 */
function ContractDocument({ document: doc }: { document: OfferDocument }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const binary = atob(doc.pdfBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [doc.pdfBase64]);

  return (
    <section data-testid="contract-document" style={{ marginTop: '2rem' }}>
      <h2 style={{ fontSize: '1.05rem' }}>{COPY.documentHeading}</h2>
      <p style={{ lineHeight: 1.6 }}>{COPY.documentHint}</p>
      {url
        ? (
          <object
            data={url}
            type="application/pdf"
            aria-label={COPY.documentHeading}
            style={{ width: '100%', height: '28rem', border: '1px solid #ccc' }}
          >
            <a href={url} target="_blank" rel="noreferrer" data-testid="contract-document-link">
              {COPY.documentFallback}
            </a>
          </object>
        )
        : null}
    </section>
  );
}

const pageStyle: React.CSSProperties = {
  maxWidth: '32rem',
  margin: '0 auto',
  padding: '1.5rem',
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
};
