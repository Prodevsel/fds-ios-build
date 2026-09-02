import * as Crypto from 'expo-crypto';

/**
 * DSGN-01/D-04: SHA-256 over the RAW bytes of a PDF, via the SAME
 * expo-crypto module the rest of the audit pipeline uses (canonicalize.ts /
 * contractsRepo.ts — D-26 single hashing path) — no second hashing utility.
 *
 * The rest of the audit pipeline hashes canonicalized JSON STRINGS via
 * `Crypto.digestStringAsync`, which is unusable here: a PDF's bytes are
 * binary, and coercing them to a JS string would corrupt/lose data before
 * hashing. `Crypto.digest(algorithm, BufferSource)` is expo-crypto's own
 * raw-bytes digest entry point (still expo-crypto, still zero new crypto
 * dependency) and is the correct primitive for hashing bytes directly.
 *
 * Deterministic for identical bytes — same input always yields the same
 * lowercase-hex digest, which is what the prefetch integrity check
 * (prefetchDirectSignPdf.ts) and the two-hash audit model (D-04) depend on.
 */
export async function hashPdfBytes(bytes: Uint8Array): Promise<string> {
  // TS's BufferSource type requires an ArrayBuffer-backed view specifically
  // (not the wider ArrayBufferLike a Uint8Array's `.buffer` is typed as) —
  // re-wrap into a plain ArrayBuffer-backed Uint8Array. This is a type-level
  // coercion only (a straight byte copy), not a semantic change.
  const arrayBufferBacked = new Uint8Array(bytes);
  const digestBuffer = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, arrayBufferBacked);
  return bytesToHex(new Uint8Array(digestBuffer));
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}
