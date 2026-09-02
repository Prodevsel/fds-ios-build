import { Directory, File, Paths } from 'expo-file-system';
import type { DirectSignPdfCache } from './prefetchDirectSignPdf';

/**
 * App-sandboxed cache for direct-sign template PDFs, keyed by template id.
 *
 * `prefetchDirectSignPdf` was written against this interface in Phase 10 and no
 * implementation was ever supplied, which is one reason nothing could mount
 * DirectSignFlowScreen. Files live under the app's document directory, so they
 * go away with the app and never touch the photo album or a shared container.
 *
 * Bytes reaching `write` have ALREADY been hash-verified by the prefetch — this
 * module deliberately verifies nothing itself, so exactly one place in the
 * codebase decides whether a PDF may be signed against.
 *
 * Reads use `bytes()`, the native entry point declared on FileSystemFile,
 * rather than the Blob-shaped `arrayBuffer()` — same reasoning as
 * downloadDirectSignOriginal.ts: on React Native the Blob surface is a
 * polyfill and the native one is the path that actually works.
 */
const CACHE_DIR_NAME = 'direct-sign-pdfs';
const PDF_MIME = 'application/pdf';

/** Template ids are server UUIDs; the guard stops a caller turning one into a path. */
function fileName(templateId: string): string {
  return `${templateId.replace(/[^a-zA-Z0-9-]/g, '')}.pdf`;
}

function cacheDirectory(): Directory {
  const documents = new Directory(Paths.document);
  const dir = new Directory(documents, CACHE_DIR_NAME);
  if (!dir.exists) {
    documents.createDirectory(CACHE_DIR_NAME);
  }
  return dir;
}

/** `file://` uri of the cached original, or null when it is not on this device. */
export function cachedPdfUri(templateId: string): string | null {
  try {
    const file = new File(cacheDirectory(), fileName(templateId));
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

export function createDirectSignPdfCache(): DirectSignPdfCache {
  return {
    async read(templateId) {
      // A miss and a broken cache are the same answer to the caller: download it.
      // Only a hash mismatch is fatal, and that is the prefetch's decision.
      try {
        const file = new File(cacheDirectory(), fileName(templateId));
        if (!file.exists) return null;
        return new Uint8Array(await file.bytes());
      } catch {
        return null;
      }
    },
    async write(templateId, bytes) {
      const dir = cacheDirectory();
      const name = fileName(templateId);
      const existing = new File(dir, name);
      if (existing.exists) {
        existing.delete();
      }
      const created = dir.createFile(name, PDF_MIME);
      created.write(bytes);
    },
  };
}
