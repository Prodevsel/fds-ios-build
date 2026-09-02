/**
 * Chunked expo-secure-store storage (WR-03, SYNC-01).
 *
 * ROOT CAUSE this exists for: expo-secure-store documents a ~2048-byte
 * per-value limit on Android (Keystore-backed SharedPreferences). The
 * supabase-js session JSON (access token + refresh token + user object) is
 * typically 2-4 KB, so persisting it as ONE SecureStore value can silently
 * fail — and a failed write means getSession() returns no session on the next
 * launch, regressing the offline-relaunch path (the exact SYNC-01 scenario
 * Defect 1 was about) to 'signed-out' with no error anywhere.
 *
 * FIX: values longer than one chunk are split across multiple SecureStore
 * entries (`<key>__chunk_<gen>_<i>`), each safely under the 2048-byte limit
 * even in the UTF-8 worst case, with a marker value under the primary key
 * recording the chunk count and generation. Every byte still lives in the OS
 * keychain/keystore — this is chunking, not a downgrade to plain
 * AsyncStorage. Reads reassemble the chunks; a missing/corrupt chunk yields
 * `null` (explicit signed-out, never a silently truncated session). Write
 * failures propagate — persistence problems must surface, not vanish.
 *
 * CRASH ATOMICITY (WR-10): rewrites (supabase-js rewrites the session on
 * every token refresh) write the new chunks under a DIFFERENT generation's
 * keys than the live value, then flip the marker, then delete the old
 * generation. The two generations never share keys, so an interruption at any
 * point leaves the marker pointing at a complete, untouched chunk set — a
 * reader sees either the whole old value or the whole new value, never a
 * mixed old/new reassembly. Generations alternate between 0 and 1, so stale
 * chunks from an interrupted write are overwritten or deleted by the next
 * successful write.
 */

export interface SecureStoreLike {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface ChunkedSecureStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const CHUNK_MARKER_PREFIX = '__chunked__:';

/**
 * 500 UTF-16 code units per chunk: worst-case UTF-8 expansion is 4 bytes per
 * code unit for a chunk of 500 -> 2000 bytes, safely under Android's
 * documented 2048-byte SecureStore value limit (session JSON is ASCII in
 * practice, but the bound must hold for arbitrary strings).
 */
export const CHUNK_CHAR_LIMIT = 500;

interface ChunkManifest {
  count: number;
  /**
   * `null` = legacy pre-generational layout (`<key>__chunk_<i>`, marker
   * `__chunked__:<count>`) written before the WR-10 fix — still readable; the
   * next write migrates to generation 0.
   */
  generation: number | null;
}

function chunkKey(key: string, generation: number | null, index: number): string {
  return generation === null ? `${key}__chunk_${index}` : `${key}__chunk_${generation}_${index}`;
}

/** Marker format: `__chunked__:<count>:<generation>` (legacy: `__chunked__:<count>`). */
function parseManifest(markerValue: string | null): ChunkManifest | null {
  if (markerValue === null || !markerValue.startsWith(CHUNK_MARKER_PREFIX)) {
    return null;
  }
  const parts = markerValue.slice(CHUNK_MARKER_PREFIX.length).split(':');
  const count = Number.parseInt(parts[0] ?? '', 10);
  if (!Number.isInteger(count) || count <= 0) {
    return null;
  }
  if (parts.length === 1) {
    return { count, generation: null };
  }
  const generation = Number.parseInt(parts[1] ?? '', 10);
  if (!Number.isInteger(generation) || generation < 0) {
    return null;
  }
  return { count, generation };
}

/** Splits without ever separating a surrogate pair across a chunk boundary. */
function splitIntoChunks(value: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(start + CHUNK_CHAR_LIMIT, value.length);
    const last = value.charCodeAt(end - 1);
    if (end < value.length && last >= 0xd800 && last <= 0xdbff) {
      end -= 1; // keep the high surrogate with its pair in the next chunk
    }
    chunks.push(value.slice(start, end));
    start = end;
  }
  return chunks;
}

export function createChunkedSecureStorage(store: SecureStoreLike): ChunkedSecureStorage {
  async function deleteChunks(key: string, manifest: ChunkManifest): Promise<void> {
    for (let i = 0; i < manifest.count; i += 1) {
      await store.deleteItemAsync(chunkKey(key, manifest.generation, i));
    }
  }

  return {
    async getItem(key: string): Promise<string | null> {
      const head = await store.getItemAsync(key);
      if (head === null) {
        return null;
      }
      if (!head.startsWith(CHUNK_MARKER_PREFIX)) {
        return head; // small (or legacy pre-chunking) value stored directly
      }
      const manifest = parseManifest(head);
      if (manifest === null) {
        return null;
      }
      const chunks: string[] = [];
      for (let i = 0; i < manifest.count; i += 1) {
        const chunk = await store.getItemAsync(chunkKey(key, manifest.generation, i));
        if (chunk === null) {
          // Corrupt/partial state: an explicit signed-out beats a truncated session.
          return null;
        }
        chunks.push(chunk);
      }
      return chunks.join('');
    },

    async setItem(key: string, value: string): Promise<void> {
      const previous = parseManifest(await store.getItemAsync(key));

      if (value.length <= CHUNK_CHAR_LIMIT && !value.startsWith(CHUNK_MARKER_PREFIX)) {
        await store.setItemAsync(key, value);
        if (previous) {
          await deleteChunks(key, previous);
        }
        return;
      }

      const chunks = splitIntoChunks(value);
      // WR-10 crash atomicity: write the new chunks under the OTHER
      // generation's keys (never shared with the live value's keys), THEN
      // flip the marker, THEN delete the old generation. An interruption at
      // any point leaves the marker pointing at a complete, untouched chunk
      // set — never a mixed old/new reassembly. Leftover chunks of an
      // interrupted write beyond the next successful write's count are
      // orphaned storage only: the marker's count bounds every read, so they
      // are never reassembled.
      const generation = previous?.generation === 0 ? 1 : 0;
      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i];
        if (chunk !== undefined) {
          await store.setItemAsync(chunkKey(key, generation, i), chunk);
        }
      }
      await store.setItemAsync(key, `${CHUNK_MARKER_PREFIX}${chunks.length}:${generation}`);
      if (previous) {
        await deleteChunks(key, previous);
      }
    },

    async removeItem(key: string): Promise<void> {
      const manifest = parseManifest(await store.getItemAsync(key));
      await store.deleteItemAsync(key);
      if (manifest) {
        await deleteChunks(key, manifest);
      }
    },
  };
}
