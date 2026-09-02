/**
 * The customer page's entire network surface: two POSTs, plain `fetch`.
 *
 * Deliberately NOT @supabase/supabase-js. That package would pull an auth
 * client with a localStorage session, a realtime client and a storage client
 * into a page that will never have a session, never subscribe to anything and
 * never touch storage directly — and it would blur the bundle-separation check
 * (scripts/ci/customer-bundle-isolation.mjs), which is easier to trust when the
 * customer bundle's dependency set is `react`, `react-dom` and nothing else.
 */

import type { DocumentResponse, SignResponse, ViewResponse } from './offerState';

export interface ApiResult<T> {
  status: number;
  body: T | null;
}

export type { DocumentResponse, SignResponse };

export interface SignPayload {
  answers: Record<string, unknown>;
  auditPackage: Record<string, unknown>;
  packageHashSha256: string;
  signaturePngBase64: string;
}

function functionsBaseUrl(): string {
  const raw = import.meta.env.VITE_SUPABASE_URL;
  if (typeof raw !== 'string' || raw.length === 0) {
    // Loud rather than a request to `undefined/functions/v1/...` that fails as
    // a confusing network error.
    throw new Error('VITE_SUPABASE_URL is not set — the offer page cannot reach the backend');
  }
  return `${raw.replace(/\/+$/, '')}/functions/v1/offer-portal`;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  // The offer-portal function runs with verify_jwt = false, so no credential is
  // required to reach it. The anon key is sent ONLY when the build defines one,
  // because the hosted API gateway still expects an `apikey` on every request
  // while the local edge runtime does not. It is a publishable key and carries
  // no privilege of its own — RLS and the SECURITY DEFINER functions decide
  // everything — but it is also not required for this page to work.
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (typeof anon === 'string' && anon.length > 0) {
    h.apikey = anon;
    h.Authorization = `Bearer ${anon}`;
  }
  return h;
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<ApiResult<T>> {
  const res = await fetch(`${functionsBaseUrl()}${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  let parsed: T | null = null;
  try {
    parsed = (await res.json()) as T;
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

export interface OfferApi {
  view(token: string, code: string): Promise<ApiResult<ViewResponse>>;
  /**
   * The filled contract for a `direct_pdf` offer, rendered server-side.
   *
   * A SECOND request rather than a field on /view, and deliberately so: it
   * costs one of the ten tries per hour, which is correct — it is a second read
   * of the same protected offer — and it keeps a several-hundred-kilobyte
   * base64 payload out of the response every OTHER offer gets. The page asks
   * for it only after the code was accepted and only for the product kind that
   * has one.
   */
  document(token: string, code: string): Promise<ApiResult<DocumentResponse>>;
  sign(token: string, code: string, payload: SignPayload): Promise<ApiResult<SignResponse>>;
}

export const offerApi: OfferApi = {
  view(token, code) {
    return post<ViewResponse>('/view', { t: token, code });
  },
  document(token, code) {
    return post<DocumentResponse>('/document', { t: token, code });
  },
  sign(token, code, payload) {
    return post<SignResponse>('/sign', { t: token, code, ...payload });
  },
};
