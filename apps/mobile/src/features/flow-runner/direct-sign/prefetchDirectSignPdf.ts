import { hashPdfBytes } from './hashPdfBytes';

/**
 * DSGN-01/D-04/T-10-11/T-10-12: pre-fetches the original PDF template into
 * an app-sandboxed, encrypted cache so signing works FULLY OFFLINE (no
 * network call on the signing path, Pitfall 5) — and verifies the cached
 * bytes' integrity against the template row's own sha256 BEFORE they are
 * ever handed to the viewer/signer or hashed as `originalTemplateSha256`.
 *
 * NEVER writes to the OS photo album — this module never imports a
 * MediaLibrary-style API at all; `cache` is entirely injected (options-
 * object DI, same convention as the repos), the same discipline as
 * attachments/queue.ts's app-sandboxed `ExpoFileSystemStorageAdapter`
 * default. This is the FIRST attachment-bearing feature carrying the
 * photo-album-exclusion device obligation recorded in STATE.md (01-09) —
 * see the "Next Phase Readiness" note in 10-05-SUMMARY.md: to be exercised
 * on the device pass (Plan 10-10), not provable by a unit test alone.
 */

/** The subset of a synced direct_sign_templates row this module needs. */
export interface DirectSignTemplateForPrefetch {
  id: string;
  /** Path inside the `direct-sign-templates` Storage bucket (0067). */
  storagePath: string;
  /** The operator-published template's own SHA-256, mirrored down via sync. */
  sha256: string;
}

/** App-sandboxed cache, keyed by template id — never the photo album. */
export interface DirectSignPdfCache {
  /** Returns previously-cached, already-integrity-verified bytes, or null. */
  read(templateId: string): Promise<Uint8Array | null>;
  /** Persists newly-downloaded, already-verified bytes into the sandbox. */
  write(templateId: string, bytes: Uint8Array): Promise<void>;
}

export interface PrefetchDirectSignPdfOptions {
  /** Downloads the original PDF bytes from the direct-sign-templates bucket. */
  downloadOriginal: (storagePath: string) => Promise<Uint8Array>;
  cache: DirectSignPdfCache;
  /** Injectable for tests — defaults to the real hashPdfBytes. */
  hashBytes?: (bytes: Uint8Array) => Promise<string>;
}

/**
 * Downloads (once) and integrity-verifies the original PDF for `template`,
 * returning the cached bytes. A second call for an already-cached template
 * is a no-op read (idempotent) — no re-download, no re-verification, no
 * network call.
 *
 * Throws (never caches, never returns unverified bytes) when the freshly
 * downloaded bytes' hash does not match `template.sha256` — a corrupt or
 * tampered download must never be signed against (root-cause the download,
 * T-10-11), not silently accepted.
 */
export async function prefetchDirectSignPdf(
  template: DirectSignTemplateForPrefetch,
  options: PrefetchDirectSignPdfOptions,
): Promise<Uint8Array> {
  const { downloadOriginal, cache, hashBytes = hashPdfBytes } = options;

  const cached = await cache.read(template.id);
  if (cached) {
    return cached;
  }

  const bytes = await downloadOriginal(template.storagePath);
  const actualSha256 = await hashBytes(bytes);
  if (actualSha256 !== template.sha256) {
    throw new Error(
      `prefetchDirectSignPdf: downloaded bytes for template ${template.id} do not match the ` +
        `expected sha256 (got ${actualSha256}, expected ${template.sha256}) — corrupt or ` +
        `tampered download, refusing to cache or sign against it`,
    );
  }

  await cache.write(template.id, bytes);
  return bytes;
}
