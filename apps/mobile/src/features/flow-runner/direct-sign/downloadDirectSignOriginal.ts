import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Downloads the ORIGINAL template PDF from the `direct-sign-templates` bucket.
 *
 * The half `prefetchDirectSignPdf` declared and nobody supplied. Access is
 * governed by the bucket's own RLS policy (0067) — no authorization logic is
 * rebuilt here; a rep who cannot see the template's company gets the same
 * denial Postgres would give any other client.
 *
 * Returns raw bytes and nothing else: the caller hashes them against the
 * template's published sha256 before they go anywhere near a signature.
 *
 * WHY A SIGNED URL AND NOT `storage.download()`: that returns a Blob, and React
 * Native's Blob is a thin polyfill around a native file handle with NO
 * `arrayBuffer()` method. Calling it is "undefined is not a function" — which is
 * exactly how the PDF consultation failed, at the last step before the viewer.
 * The type-checker cannot see this: `@supabase/supabase-js` types the return as
 * the DOM Blob, which does have the method. RN's `fetch` Response, by contrast,
 * implements `arrayBuffer()` properly, so routing the bytes through a signed URL
 * uses the one path this runtime actually supports.
 *
 * `lib/db/attachments/queue.ts:105` still calls `data.arrayBuffer()` on a
 * storage download. It is on the restore path, which no device has exercised
 * yet, so it has never had the chance to fail — same defect, not yet triggered.
 */
export const DIRECT_SIGN_BUCKET = 'direct-sign-templates';

/** Short-lived: the URL only has to survive this one fetch. */
const SIGNED_URL_TTL_SECONDS = 60;

export function createDownloadDirectSignOriginal(supabase: SupabaseClient) {
  return async function downloadOriginal(storagePath: string): Promise<Uint8Array> {
    const { data, error } = await supabase.storage
      .from(DIRECT_SIGN_BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      throw new Error(
        `direct-sign template URL failed for ${storagePath}: ${error?.message ?? 'no signed url returned'}`,
      );
    }

    const response = await fetch(data.signedUrl);
    if (!response.ok) {
      throw new Error(
        `direct-sign template download failed for ${storagePath}: HTTP ${response.status}`,
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  };
}
