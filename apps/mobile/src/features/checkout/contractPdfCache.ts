import { Directory, File, Paths } from 'expo-file-system';
import type { ContractPdfCache } from './contractPdfAccess';

/**
 * QUICK-F99: app-sandboxed cache for rendered contract PDFs, modelled
 * directly on `directSignPdfCache.ts` — same `Directory`/`File`/`Paths`
 * surface, same `Paths.document` sandbox, same `bytes()` (native) rather than
 * `arrayBuffer()` (Blob polyfill) read path.
 *
 * Same guarantee as the direct-sign cache: files live under the app's document
 * directory, go away with the app, and never touch the photo album or any
 * shared container.
 *
 * Keys are produced by `contractPdfFileName` (contractPdfAccess.ts), which
 * carries both the path-traversal guard and the sha suffix — this module
 * derives no key of its own and verifies no hash of its own, so exactly one
 * place decides whether an artifact may be shown.
 */
const CACHE_DIR_NAME = 'contract-pdfs';
const PDF_MIME = 'application/pdf';

export type { ContractPdfCache };

function cacheDirectory(): Directory {
  const documents = new Directory(Paths.document);
  const dir = new Directory(documents, CACHE_DIR_NAME);
  if (!dir.exists) {
    documents.createDirectory(CACHE_DIR_NAME);
  }
  return dir;
}

export function createContractPdfCache(): ContractPdfCache {
  return {
    uri(key) {
      try {
        const file = new File(cacheDirectory(), key);
        return file.exists ? file.uri : null;
      } catch {
        return null;
      }
    },
    async read(key) {
      // A miss and a broken cache are the same answer to the caller:
      // re-download it. Only a hash mismatch is fatal, and that decision
      // belongs to createFetchContractPdf.
      try {
        const file = new File(cacheDirectory(), key);
        if (!file.exists) return null;
        return new Uint8Array(await file.bytes());
      } catch {
        return null;
      }
    },
    async write(key, bytes) {
      const dir = cacheDirectory();
      const existing = new File(dir, key);
      if (existing.exists) {
        existing.delete();
      }
      const created = dir.createFile(key, PDF_MIME);
      created.write(bytes);
    },
  };
}
