import { Directory, File, Paths } from 'expo-file-system';

/**
 * Writes a rendered PDF to a local file so `DirectSignPdfViewer` can display it.
 *
 * Why this exists. The viewer takes a `file://` uri, and until now the only uri
 * it ever got was the CACHED ORIGINAL — so the customer read through a blank
 * form, agreed to it, and signed. The values were stamped afterwards, on the
 * server, on a document nobody in the room had seen. That is both a trust
 * problem ("what are they going to write in there?") and the reason the audit
 * package froze the hash of an empty page.
 *
 * The device renderer (renderDirectSignPdf.ts) removed the obstacle: the phone
 * can produce the finished document offline, byte-identically to the server
 * (proven in renderDirectSignPdf.drift.test.ts). All that was missing was
 * somewhere to put it.
 *
 * ── Separate directory from the template cache, on purpose ──────────────────
 *
 * `direct-sign-pdfs/` holds ORIGINALS whose bytes were verified against
 * `direct_sign_templates.sha256`. A preview is a derived artifact that matches
 * no such hash. Writing one into that directory would make the next prefetch
 * integrity check fail against a file it was never meant to check — so
 * previews live in their own directory and are disposable by definition.
 *
 * Names are keyed by CONTENT, not by contract or template: the same answers
 * produce the same file, and a changed answer produces a different one, so a
 * stale preview can never be shown for edited values.
 */

const PREVIEW_DIR_NAME = 'direct-sign-previews';

function previewDirectory(): Directory {
  const documents = new Directory(Paths.document);
  const dir = new Directory(documents, PREVIEW_DIR_NAME);
  if (!dir.exists) {
    documents.createDirectory(PREVIEW_DIR_NAME);
  }
  return dir;
}

/** The sha256 of the rendered bytes IS the file name — same bytes, same file. */
function fileName(contentHash: string): string {
  return `${contentHash.replace(/[^a-f0-9]/gi, '').slice(0, 64)}.pdf`;
}

/**
 * Returns a `file://` uri for these bytes, writing them only if that exact
 * content is not already on disk.
 *
 * Never throws. A preview is a courtesy, and a full disk or a sandbox quirk
 * must not take down the signing screen at a customer's door — the caller
 * falls back to the original template, which is exactly what it showed before.
 */
export async function writePreviewPdf(
  bytes: Uint8Array,
  contentHash: string,
): Promise<string | null> {
  try {
    const file = new File(previewDirectory(), fileName(contentHash));
    if (!file.exists) {
      file.create();
      await file.write(bytes);
    }
    return file.uri;
  } catch {
    return null;
  }
}

/**
 * Drops every preview. Called when a consultation ends, so a customer's
 * answers do not sit in the sandbox after the rep has walked away — the same
 * data-minimisation posture the rest of this feature follows.
 */
export function clearPreviewPdfs(): void {
  try {
    const dir = previewDirectory();
    if (dir.exists) dir.delete();
  } catch {
    // Nothing to do: a preview that cannot be deleted is not worth a crash.
  }
}
