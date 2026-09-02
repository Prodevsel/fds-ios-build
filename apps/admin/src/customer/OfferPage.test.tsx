import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { COPY } from './copy';
import type { OfferApi } from './offerApi';
import { OfferPage } from './OfferPage';

/**
 * The page-level half of "the link alone shows nothing". offerState.test.ts
 * proves the rule; these prove the page obeys it.
 */

const TOKEN = '7e000000-0000-4000-8000-000000000001';

const okBody = {
  state: 'ok',
  companyDisplayName: 'Stadtwerke Elbufer GmbH',
  contactName: 'Frau Gueltig',
  offerExpiresAt: '2026-09-10T00:00:00Z',
  snapshot: { doorPrice: 49.9, comparisonPrice: 59.9, discountAmount: 10, termsText: '24 Monate Laufzeit' },
  productKind: 'flow_form',
  productPinned: true,
  belehrungBlocks: [{ id: 'withdrawal-notice', noticeText: 'Sie haben das Recht ...' }],
};

/**
 * A 1x1 transparent PNG standing in for the rendered contract. jsdom does not
 * display PDFs and does not need to — what these tests assert is that the page
 * ASKS for the document and gates the signature on the answer, not what a
 * viewer does with the bytes.
 */
const DOC_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const DOC_SHA = 'a'.repeat(64);
const okDocument = {
  status: 200,
  body: { state: 'ok', document: { pdfBase64: DOC_BASE64, originalSha256: DOC_SHA } },
};

function fakeApi(
  view: { status: number; body: unknown },
  sign: { status: number; body: unknown } = { status: 200, body: { state: 'ok', dealReference: 'FDS-20260828-ABCDEF01' } },
  document: { status: number; body: unknown } = { status: 200, body: { state: 'ok', document: null } },
): OfferApi {
  return {
    view: vi.fn().mockResolvedValue(view),
    document: vi.fn().mockResolvedValue(document),
    sign: vi.fn().mockResolvedValue(sign),
  } as unknown as OfferApi;
}

/**
 * jsdom implements <canvas> as a DOM node and nothing more — no 2d context, no
 * toDataURL. The page therefore takes its rasterizer as a prop (SignaturePad
 * explains why that is DI and not a fake), and every test below injects this
 * one. What is NOT stubbed is the pointer handling, the stroke recording, the
 * hashing or the gate rule: those run for real.
 */
const PNG = 'data:image/png;base64,aGVsbG8=';
const renderPng = () => PNG;

/** Draws one stroke, the way a finger does: down, a move, up. */
function drawSignature() {
  const canvas = screen.getByTestId('signature-canvas');
  fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 40, clientY: 30 });
  fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 40, clientY: 30 });
}

/**
 * Deliberately `fireEvent` and not `@testing-library/user-event`: this plan
 * installs no new package (T-KAS-SC), and the rest of the admin suite drives
 * its forms the same way. Nothing asserted below depends on the per-keystroke
 * fidelity user-event would add — the page reads the field once, on submit.
 */
function enterCode(code = 'FDS-PRTA-2345') {
  fireEvent.change(screen.getByTestId('code-input'), { target: { value: code } });
  fireEvent.click(screen.getByTestId('code-submit'));
}

describe('before the code is entered', () => {
  it('renders no offer data at all — not hidden, ABSENT', () => {
    render(<OfferPage token={TOKEN} api={fakeApi({ status: 200, body: okBody })} />);
    expect(screen.queryByTestId('offer')).toBeNull();
    expect(screen.queryByTestId('conditions')).toBeNull();
    // And nothing from the offer is anywhere in the document.
    expect(document.body.textContent).not.toContain('Stadtwerke Elbufer');
    expect(document.body.textContent).not.toContain('49,90');
  });

  it('does not call the API on mount — the link alone asks the server nothing', () => {
    const api = fakeApi({ status: 200, body: okBody });
    render(<OfferPage token={TOKEN} api={api} />);
    expect(api.view).not.toHaveBeenCalled();
  });

  it('renders no form at all without a token in the URL', () => {
    render(<OfferPage token={null} api={fakeApi({ status: 200, body: okBody })} />);
    expect(screen.queryByTestId('code-input')).toBeNull();
    expect(screen.getByTestId('refusal').textContent).toBe(COPY.errorNoToken);
  });
});

describe('refusals', () => {
  it('says neither "no such offer" nor "wrong code" for an invalid pair', async () => {
    render(<OfferPage token={TOKEN} api={fakeApi({ status: 200, body: { state: 'invalid' } })} />);
    enterCode('FDS-WRNG-2345');
    const message = (await screen.findByTestId('refusal')).textContent ?? '';
    expect(message).toBe(COPY.errorInvalid);
    // The sentence must not resolve the ambiguity the server preserved.
    expect(message).not.toMatch(/existiert nicht|unbekannt|falsch(er)? Code/i);
    expect(screen.queryByTestId('offer')).toBeNull();
  });

  it.each([
    ['expired', COPY.errorExpired],
    ['redeemed', COPY.errorRedeemed],
    ['unavailable', COPY.errorUnavailable],
  ])('shows its own honest message for %s and no offer data', async (state, expected) => {
    render(<OfferPage token={TOKEN} api={fakeApi({ status: 200, body: { state } })} />);
    enterCode();
    expect((await screen.findByTestId('refusal')).textContent).toBe(expected);
    expect(screen.queryByTestId('offer')).toBeNull();
  });

  it('has its own state and message for 429', async () => {
    render(<OfferPage token={TOKEN} api={fakeApi({ status: 429, body: { state: 'rate_limited' } })} />);
    enterCode();
    expect((await screen.findByTestId('refusal')).textContent).toBe(COPY.errorRateLimited);
  });
});

describe('after a correct code', () => {
  it('renders the frozen door price, comparison price and discount from the snapshot', async () => {
    render(<OfferPage token={TOKEN} api={fakeApi({ status: 200, body: okBody })} />);
    enterCode();
    const conditions = await screen.findByTestId('conditions');
    expect(conditions.textContent).toContain('49,90');
    expect(conditions.textContent).toContain('59,90');
    expect(conditions.textContent).toContain('10,00');
    expect(screen.getByTestId('offer').textContent).toContain('Stadtwerke Elbufer GmbH');
  });

  it('omits a missing price row entirely rather than printing 0,00 €', async () => {
    const body = { ...okBody, snapshot: { doorPrice: 49.9 } };
    render(<OfferPage token={TOKEN} api={fakeApi({ status: 200, body })} />);
    enterCode();
    const conditions = await screen.findByTestId('conditions');
    expect(conditions.textContent).toContain('49,90');
    expect(conditions.textContent).not.toContain('0,00');
    expect(conditions.textContent).not.toContain(COPY.offerComparisonPrice);
    expect(conditions.textContent).not.toContain(COPY.offerDiscount);
  });

  it('shows the code form no more, and never echoes the code back', async () => {
    render(<OfferPage token={TOKEN} api={fakeApi({ status: 200, body: okBody })} />);
    enterCode();
    await waitFor(() => expect(screen.getByTestId('offer')).toBeTruthy());
    expect(screen.queryByTestId('code-input')).toBeNull();
    expect(document.body.textContent).not.toContain('FDS-PRTA-2345');
  });

  it('still shows a direct_pdf customer his conditions when no document can be rendered', async () => {
    const body = { ...okBody, productKind: 'direct_pdf' };
    render(<OfferPage token={TOKEN} api={fakeApi({ status: 200, body })} />);
    enterCode();
    expect((await screen.findByTestId('direct-pdf-hint')).textContent).toBe(COPY.directPdfHint);
    expect(screen.getByTestId('conditions').textContent).toContain('49,90');
  });

  it('shows the package and the price a direct_pdf offer froze, not just a date', async () => {
    const body = {
      ...okBody,
      productKind: 'direct_pdf',
      // A direct_pdf product has no discount block (D-04) and therefore none of
      // the three numeric price fields — its conditions ARE these two strings.
      snapshot: { packageLabel: 'Plus', packagePrice: '199,00 EUR mtl.' },
    };
    render(<OfferPage token={TOKEN} api={fakeApi({ status: 200, body })} />);
    enterCode();
    const conditions = await screen.findByTestId('conditions');
    expect(conditions.textContent).toContain('Plus');
    expect(conditions.textContent).toContain('199,00 EUR mtl.');
  });

  it('never asks for a document on the flow_form path — it has none and the ask costs a try', async () => {
    const api = fakeApi({ status: 200, body: okBody });
    render(<OfferPage token={TOKEN} api={api} />);
    enterCode();
    await screen.findByTestId('conditions');
    expect(api.document).not.toHaveBeenCalled();
  });
});

describe('the withdrawal-notice gate', () => {
  it('does not put the signature surface in the DOM before the notice is confirmed', async () => {
    render(<OfferPage token={TOKEN} api={fakeApi({ status: 200, body: okBody })} renderPng={renderPng} />);
    enterCode();
    await screen.findByTestId('notice');
    // Absent, not disabled and not hidden. A disabled control is still a
    // control, and the customer must not be able to arrive at signing before
    // he has been told he may withdraw.
    expect(screen.queryByTestId('signature')).toBeNull();
    expect(screen.queryByTestId('signature-canvas')).toBeNull();
    expect(screen.queryByTestId('sign-submit')).toBeNull();
  });

  it('shows the notice text from the delivered block, not from a local constant', async () => {
    render(<OfferPage token={TOKEN} api={fakeApi({ status: 200, body: okBody })} renderPng={renderPng} />);
    enterCode();
    expect((await screen.findByTestId('notice-text-withdrawal-notice')).textContent)
      .toBe('Sie haben das Recht ...');
  });

  it('reveals the signature surface only after every gate block is confirmed', async () => {
    const twoBlocks = {
      ...okBody,
      belehrungBlocks: [
        { id: 'withdrawal-notice', noticeText: 'Sie haben das Recht ...' },
        { id: 'second-notice', noticeText: 'Und ausserdem ...' },
      ],
    };
    render(<OfferPage token={TOKEN} api={fakeApi({ status: 200, body: twoBlocks })} renderPng={renderPng} />);
    enterCode();
    fireEvent.click(await screen.findByTestId('notice-confirm-withdrawal-notice'));
    await waitFor(() =>
      expect((screen.getByTestId('notice-confirm-withdrawal-notice') as HTMLInputElement).checked).toBe(true)
    );
    expect(screen.queryByTestId('signature')).toBeNull();
    fireEvent.click(screen.getByTestId('notice-confirm-second-notice'));
    expect(await screen.findByTestId('signature')).toBeTruthy();
  });

  it('leaves the signature permanently unreachable when no notice was delivered', async () => {
    const noNotice = { ...okBody, belehrungBlocks: [] };
    render(<OfferPage token={TOKEN} api={fakeApi({ status: 200, body: noNotice })} renderPng={renderPng} />);
    enterCode();
    // The offer is still shown — the customer is entitled to see what was
    // discussed — but there is nothing here to sign with, and the page says so.
    expect((await screen.findByTestId('notice-missing')).textContent).toBe(COPY.noticeMissing);
    expect(screen.getByTestId('conditions').textContent).toContain('49,90');
    expect(screen.queryByTestId('notice')).toBeNull();
    expect(screen.queryByTestId('signature')).toBeNull();
  });

  it('shows a direct_pdf customer his filled contract, then the notice and the signature', async () => {
    const body = { ...okBody, productKind: 'direct_pdf' };
    render(
      <OfferPage
        token={TOKEN}
        api={fakeApi({ status: 200, body }, undefined, okDocument)}
        renderPng={renderPng}
      />,
    );
    enterCode();
    // The contract itself is IN the page, above the gate — read, then confirm,
    // then sign. Not a link to the rep.
    expect(await screen.findByTestId('contract-document')).not.toBeNull();
    expect(screen.getByTestId('notice')).not.toBeNull();
    expect(screen.queryByTestId('direct-pdf-hint')).toBeNull();
  });

  it('refuses to offer a signature for a direct_pdf product with no document', async () => {
    const body = { ...okBody, productKind: 'direct_pdf' };
    render(<OfferPage token={TOKEN} api={fakeApi({ status: 200, body })} renderPng={renderPng} />);
    enterCode();
    // The exception, not the normal case: nothing to show means nothing to
    // sign. Signing a document the customer was never shown is the failure the
    // whole route exists to avoid.
    expect((await screen.findByTestId('direct-pdf-hint')).textContent).toBe(COPY.directPdfHint);
    expect(screen.queryByTestId('notice')).toBeNull();
    expect(screen.queryByTestId('signature')).toBeNull();
  });
});

describe('signing', () => {
  const FIXED_NOW = new Date('2026-08-28T09:05:00.000Z');
  /**
   * SHA-256 of exactly `Sie haben das Recht ...`, the delivered noticeText.
   * Verified OUTSIDE this codebase (`printf ... | sha256sum`) so the assertion
   * cannot be satisfied by a wrong implementation agreeing with itself.
   */
  const NOTICE_SHA256 = '614524c590efd7508af5cf4c09422f4ed3196ab978a9b81d597432303111f1a5';

  async function reachSignature(api = fakeApi({ status: 200, body: okBody })) {
    render(<OfferPage token={TOKEN} api={api} renderPng={renderPng} now={() => FIXED_NOW} />);
    enterCode();
    fireEvent.click(await screen.findByTestId('notice-confirm-withdrawal-notice'));
    await screen.findByTestId('signature');
    return api;
  }

  it('will not submit an empty signature box', async () => {
    await reachSignature();
    expect((screen.getByTestId('sign-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables the submit once a stroke has been drawn', async () => {
    await reachSignature();
    drawSignature();
    await waitFor(() =>
      expect((screen.getByTestId('sign-submit') as HTMLButtonElement).disabled).toBe(false)
    );
  });

  it('sends a gate entry hashing exactly the delivered notice text, and an honest package', async () => {
    const api = await reachSignature();
    drawSignature();
    await waitFor(() =>
      expect((screen.getByTestId('sign-submit') as HTMLButtonElement).disabled).toBe(false)
    );
    fireEvent.click(screen.getByTestId('sign-submit'));
    await screen.findByTestId('done');

    const [, , payload] = (api.sign as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    const sent = payload as { auditPackage: Record<string, unknown>; signaturePngBase64: string };
    expect(sent.auditPackage.confirmedGates).toEqual([
      {
        blockId: 'withdrawal-notice',
        confirmedAtIso: FIXED_NOW.toISOString(),
        noticeTextSha256: NOTICE_SHA256,
      },
    ]);
    expect(sent.auditPackage.channel).toBe('customer-browser');
    expect(sent.auditPackage.deviceId).toBeNull();
    expect(sent.auditPackage.gps).toBeNull();
    expect(sent.auditPackage.serverTimeAnchor).toBeNull();
    // The stroke actually drawn above, not a fixture handed to the component.
    expect((sent.auditPackage.signatureStrokeData as unknown[][])[0]!.length).toBeGreaterThan(1);
    expect(sent.signaturePngBase64).toBe(PNG);
  });

  it('shows the deal reference and the mail note when the server accepted', async () => {
    await reachSignature();
    drawSignature();
    await waitFor(() =>
      expect((screen.getByTestId('sign-submit') as HTMLButtonElement).disabled).toBe(false)
    );
    fireEvent.click(screen.getByTestId('sign-submit'));
    expect((await screen.findByTestId('deal-reference')).textContent).toContain('FDS-20260828-ABCDEF01');
    expect(screen.getByTestId('done').textContent).toBe(COPY.doneHeading);
    expect(screen.queryByTestId('signature')).toBeNull();
  });

  it('answers a redeemed verdict from /sign with the same honest sentence as /view', async () => {
    const api = await reachSignature(
      fakeApi({ status: 200, body: okBody }, { status: 200, body: { state: 'redeemed' } }),
    );
    drawSignature();
    await waitFor(() =>
      expect((screen.getByTestId('sign-submit') as HTMLButtonElement).disabled).toBe(false)
    );
    fireEvent.click(screen.getByTestId('sign-submit'));
    // Two tabs, or two taps. Not an error — the truth.
    expect((await screen.findByTestId('refusal')).textContent).toBe(COPY.errorRedeemed);
    expect(api.sign).toHaveBeenCalledTimes(1);
  });
});
