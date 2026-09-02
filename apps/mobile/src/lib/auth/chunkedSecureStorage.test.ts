import { describe, expect, it } from 'vitest';
import {
  CHUNK_CHAR_LIMIT,
  type SecureStoreLike,
  createChunkedSecureStorage,
} from './chunkedSecureStorage';

/**
 * WR-03: expo-secure-store enforces a ~2048-byte per-value limit on Android;
 * the supabase-js session JSON (2-4 KB) must survive a round trip anyway.
 * The fake store below REJECTS any value over 2048 UTF-8 bytes, so these
 * tests fail loudly if the chunking bound is ever wrong.
 */

const ANDROID_SECURESTORE_BYTE_LIMIT = 2048;

function makeFakeSecureStore(): { store: SecureStoreLike; entries: Map<string, string> } {
  const entries = new Map<string, string>();
  const store: SecureStoreLike = {
    async getItemAsync(key) {
      return entries.get(key) ?? null;
    },
    async setItemAsync(key, value) {
      if (Buffer.byteLength(value, 'utf8') > ANDROID_SECURESTORE_BYTE_LIMIT) {
        throw new Error(
          `value for '${key}' exceeds the ${ANDROID_SECURESTORE_BYTE_LIMIT}-byte limit`,
        );
      }
      entries.set(key, value);
    },
    async deleteItemAsync(key) {
      entries.delete(key);
    },
  };
  return { store, entries };
}

/** Shaped like a real supabase-js persisted session: ~4 KB of ASCII JSON. */
function makeSessionPayload(size: number): string {
  return JSON.stringify({
    access_token: 'a'.repeat(size / 2),
    refresh_token: 'r'.repeat(size / 4),
    user: { id: '40000000-0000-0000-0000-000000000001', email: 'rep-x@fixture.test' },
  });
}

describe('createChunkedSecureStorage (WR-03)', () => {
  it('round-trips a session payload far above the 2048-byte SecureStore limit', async () => {
    const { store } = makeFakeSecureStore();
    const storage = createChunkedSecureStorage(store);
    const session = makeSessionPayload(4096);

    await storage.setItem('sb-session', session);

    expect(await storage.getItem('sb-session')).toBe(session);
  });

  it('stores small values directly (no chunk overhead) and reads legacy values back', async () => {
    const { store, entries } = makeFakeSecureStore();
    const storage = createChunkedSecureStorage(store);

    await storage.setItem('k', 'short-value');
    expect(entries.get('k')).toBe('short-value');
    expect(await storage.getItem('k')).toBe('short-value');

    // A value written by the pre-chunking implementation is still readable.
    entries.set('legacy', 'legacy-session');
    expect(await storage.getItem('legacy')).toBe('legacy-session');
  });

  it('removeItem deletes the marker and every chunk', async () => {
    const { store, entries } = makeFakeSecureStore();
    const storage = createChunkedSecureStorage(store);

    await storage.setItem('k', 'x'.repeat(CHUNK_CHAR_LIMIT * 3));
    expect(entries.size).toBeGreaterThan(1);

    await storage.removeItem('k');
    expect(entries.size).toBe(0);
    expect(await storage.getItem('k')).toBeNull();
  });

  it('shrinking a value cleans up stale chunks from the longer previous value', async () => {
    const { store, entries } = makeFakeSecureStore();
    const storage = createChunkedSecureStorage(store);

    await storage.setItem('k', 'x'.repeat(CHUNK_CHAR_LIMIT * 4));
    await storage.setItem('k', 'y'.repeat(CHUNK_CHAR_LIMIT + 1)); // 2 chunks

    expect(await storage.getItem('k')).toBe('y'.repeat(CHUNK_CHAR_LIMIT + 1));
    expect(entries.size).toBe(3); // marker + 2 chunks, stale chunks 2..3 removed

    await storage.setItem('k', 'plain');
    expect(entries.size).toBe(1); // back to a single direct value
  });

  it('returns null (explicit signed-out) when a chunk is missing, never a truncated value', async () => {
    const { store, entries } = makeFakeSecureStore();
    const storage = createChunkedSecureStorage(store);

    await storage.setItem('k', 'x'.repeat(CHUNK_CHAR_LIMIT * 2 + 10));
    entries.delete('k__chunk_0_1'); // first write lands in generation 0

    expect(await storage.getItem('k')).toBeNull();
  });

  it('reads values persisted in the legacy pre-generational chunk layout', async () => {
    const { store, entries } = makeFakeSecureStore();
    const storage = createChunkedSecureStorage(store);
    // Layout written before the WR-10 fix: `__chunked__:<count>` marker with
    // ungenerational `<key>__chunk_<i>` keys.
    entries.set('k', '__chunked__:2');
    entries.set('k__chunk_0', 'old-');
    entries.set('k__chunk_1', 'session');

    expect(await storage.getItem('k')).toBe('old-session');
  });

  it('WR-10: a crash mid-rewrite never yields a mixed old/new value — the read is the complete old value or null', async () => {
    const { store, entries } = makeFakeSecureStore();
    const oldValue = 'o'.repeat(CHUNK_CHAR_LIMIT * 3);
    const newValue = 'n'.repeat(CHUNK_CHAR_LIMIT * 3);

    await createChunkedSecureStorage(store).setItem('k', oldValue);

    // Simulate the interruption window: the rewrite dies after persisting the
    // first new chunk (before the marker flips) — the exact torn-write state
    // of the token-refresh crash scenario.
    let writesUntilCrash = 1;
    const crashing: SecureStoreLike = {
      ...store,
      async setItemAsync(key, value) {
        if (writesUntilCrash <= 0) {
          throw new Error('process died mid-rewrite');
        }
        writesUntilCrash -= 1;
        await store.setItemAsync(key, value);
      },
    };
    await expect(createChunkedSecureStorage(crashing).setItem('k', newValue)).rejects.toThrow(
      'process died mid-rewrite',
    );

    // A fresh reader (next app launch) must see the complete previous value
    // or an explicit signed-out — never a frankenstein old/new reassembly.
    const readBack = await createChunkedSecureStorage(store).getItem('k');
    expect([oldValue, null]).toContain(readBack);
    // The generational layout is strictly stronger: the old value survives.
    expect(readBack).toBe(oldValue);
    // And the interrupted new generation never leaked into the live chunk set.
    expect(entries.get('k')).toBe('__chunked__:3:0');
  });

  it('propagates write failures instead of swallowing them', async () => {
    const { store } = makeFakeSecureStore();
    const failing: SecureStoreLike = {
      ...store,
      async setItemAsync() {
        throw new Error('keystore unavailable');
      },
    };
    const storage = createChunkedSecureStorage(failing);

    await expect(storage.setItem('k', 'value')).rejects.toThrow('keystore unavailable');
  });

  it('never splits a surrogate pair across a chunk boundary', async () => {
    const { store } = makeFakeSecureStore();
    const storage = createChunkedSecureStorage(store);
    // Position an astral-plane character exactly across the default boundary.
    const value = `${'a'.repeat(CHUNK_CHAR_LIMIT - 1)}\u{1F600}${'b'.repeat(CHUNK_CHAR_LIMIT)}`;

    await storage.setItem('k', value);

    expect(await storage.getItem('k')).toBe(value);
  });
});
