import type { SupabaseClient } from '@supabase/supabase-js';
import { hashPdfBytes } from '../flow-runner/direct-sign/hashPdfBytes';

/**
 * QUICK-F99: the app's read path to the rendered white-label contract PDF.
 *
 * Authorization is NOT rebuilt here. `contract_pdf_artifact` (0089) is a
 * SECURITY DEFINER function whose only rule is `visible_contracts(auth.uid())`
 * (MAND-02), and the `contract-pdfs` bucket enforces the same rule
 * independently when the signed URL is minted. This module decides nothing
 * about who may read what — it only turns the RPC's answer into a state the UI
 * can be honest about.
 */

/** Bucket the render dispatcher writes finished contract PDFs to (0041). */
export const CONTRACT_PDF_BUCKET = 'contract-pdfs';

/**
 * Short-lived, exactly like DIRECT_SIGN_BUCKET's constant
 * (downloadDirectSignOriginal.ts): the URL only has to survive this one fetch,
 * and a leaked signed URL is a bearer credential for that object (T-f99-04).
 */
const SIGNED_URL_TTL_SECONDS = 60;

/**
 * `idle`/`loading` are UI-only. The other five are the honest outcomes, and
 * they are deliberately five and not one: "wird gerade erstellt", "hat nicht
 * geklappt" and "kein Netz" are three different truths and the user is told
 * which one applies.
 */
export type ContractPdfState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'pending'
  | 'failed'
  | 'offline'
  | 'unavailable';

/** One row of `contract_pdf_artifact` (0089). */
export interface ContractPdfArtifact {
  /** Closed set from 0089: 'pending' | 'ready' | 'failed'. */
  artifact_status: string;
  /** Non-null in the 'ready' state only. */
  pdf_path: string | null;
  pdf_sha256: string | null;
  rendered_at: string | null;
}

/** What the RPC came back with: rows, or a transport failure. */
export interface ContractPdfRpcOutcome {
  rows: ContractPdfArtifact[] | null;
  /** Any thrown/returned transport error — a network failure, not a verdict. */
  error?: unknown;
}

/** App-sandboxed PDF cache, keyed by `contractPdfFileName` — never the photo album. */
export interface ContractPdfCache {
  /** `file://` uri of the cached artifact, or null when it is not on this device. */
  uri(key: string): string | null;
  read(key: string): Promise<Uint8Array | null>;
  write(key: string, bytes: Uint8Array): Promise<void>;
}

/**
 * Pure. Every branch of 0089's closed `artifact_status` set is handled
 * explicitly — there is no default-to-ready, so a value this app does not know
 * degrades to `failed` rather than to a broken viewer.
 *
 * Zero rows is `unavailable`: 0089 deliberately makes "not visible" and "does
 * not exist" indistinguishable, so this client cannot claim to know which one
 * it is either.
 */
export function deriveContractPdfState(outcome: ContractPdfRpcOutcome): ContractPdfState {
  if (outcome.error) return 'offline';
  const rows = outcome.rows;
  if (!rows || rows.length === 0) return 'unavailable';
  const row = rows[0];
  if (!row) return 'unavailable';
  switch (row.artifact_status) {
    case 'ready':
      // Defensive: 0089 never returns a null path in the ready state, but a
      // null path must never reach the downloader if it ever did.
      return row.pdf_path ? 'ready' : 'failed';
    case 'pending':
      return 'pending';
    case 'failed':
      return 'failed';
    default:
      return 'failed';
  }
}

/**
 * Pure cache key. Mirrors `directSignPdfCache.ts:fileName`'s guard — the
 * contract id is stripped of everything outside `[A-Za-z0-9-]` so a hostile id
 * cannot escape the cache directory (T-f99-06).
 *
 * The sha is part of the name on purpose: D-19 regeneration produces a NEW
 * artifact at a NEW path with a NEW hash, so a regenerated PDF can never be
 * served out of the stale cache entry for the same contract.
 */
export function contractPdfFileName(contractId: string, sha256: string): string {
  const safeId = contractId.replace(/[^a-zA-Z0-9-]/g, '');
  const safeSha = sha256.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
  return `${safeId}-${safeSha}.pdf`;
}

export interface FetchContractPdfResult {
  state: ContractPdfState;
  localFileUri: string | null;
}

/**
 * RPC -> state -> (cache hit | signed URL + fetch + hash check) -> local uri.
 *
 * WHY A SIGNED URL AND NOT `storage.download()`: verbatim the reason
 * `downloadDirectSignOriginal.ts` documents — `storage.download()` returns a
 * Blob, and React Native's Blob is a polyfill around a native file handle with
 * NO `arrayBuffer()`. The call type-checks cleanly and then throws "undefined
 * is not a function" at runtime. RN's `fetch` Response implements
 * `arrayBuffer()` properly, so the bytes are routed through a short-lived
 * signed URL, the one path this runtime actually supports.
 *
 * Bytes are hash-verified against `render_jobs.pdf_sha256` BEFORE the cache
 * write (T-f99-05) — tamper-evidence is the entire reason that column exists.
 * A mismatch yields `failed` and writes nothing.
 *
 * Transport errors map to `offline` and are never swallowed into `failed`: the
 * three non-ready outcomes have to stay distinguishable for the UI.
 */
export function createFetchContractPdf(supabase: SupabaseClient, cache: ContractPdfCache) {
  return async function fetchContractPdf(contractId: string): Promise<FetchContractPdfResult> {
    let outcome: ContractPdfRpcOutcome;
    try {
      const { data, error } = await supabase.rpc('contract_pdf_artifact', {
        p_contract_id: contractId,
      });
      // A returned PostgREST error is a transport/permission failure, not a
      // verdict about the artifact — 0089 answers "no" with zero rows.
      outcome = { rows: (data as ContractPdfArtifact[] | null) ?? null, error: error ?? undefined };
    } catch (thrown) {
      outcome = { rows: null, error: thrown };
    }

    const state = deriveContractPdfState(outcome);
    if (state !== 'ready') return { state, localFileUri: null };

    const artifact = (outcome.rows ?? [])[0];
    const storagePath = artifact?.pdf_path;
    const sha256 = artifact?.pdf_sha256;
    if (!storagePath || !sha256) return { state: 'failed', localFileUri: null };

    const key = contractPdfFileName(contractId, sha256);
    const cached = cache.uri(key);
    if (cached) return { state: 'ready', localFileUri: cached };

    try {
      const { data, error } = await supabase.storage
        .from(CONTRACT_PDF_BUCKET)
        .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
      if (error || !data?.signedUrl) return { state: 'offline', localFileUri: null };

      const response = await fetch(data.signedUrl);
      if (!response.ok) return { state: 'offline', localFileUri: null };
      const bytes = new Uint8Array(await response.arrayBuffer());

      if ((await hashPdfBytes(bytes)) !== sha256) {
        // A legal artifact whose bytes do not match the hash the renderer
        // recorded is not shown and not kept. Nothing is written to the cache.
        return { state: 'failed', localFileUri: null };
      }

      await cache.write(key, bytes);
      return { state: 'ready', localFileUri: cache.uri(key) };
    } catch {
      return { state: 'offline', localFileUri: null };
    }
  };
}
