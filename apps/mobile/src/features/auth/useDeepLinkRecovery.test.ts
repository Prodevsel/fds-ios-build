import { describe, expect, it, vi } from 'vitest';

// Node test environment: useDeepLinkRecovery.ts transitively imports
// `expo-linking` and `getSupabase` (lib/auth/supabase), both of which reach
// into native/react-native modules — mock them so these tests (which only
// exercise the DI'd `attachDeepLinkRecovery`) never load that chain (mirrors
// useMarkFirstSync.test.ts / useRoleScope.test.ts's mocking pattern).
vi.mock('expo-linking', () => ({
  getInitialURL: vi.fn(async () => null),
  addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  parse: vi.fn(),
}));
vi.mock('../../lib/auth/supabase', () => ({ getSupabase: vi.fn() }));

import {
  attachDeepLinkRecovery,
  type DeepLinkAuthClient,
  type DeepLinkingClient,
} from './useDeepLinkRecovery';

const RECOVERY_URL = 'frontdoorsales://reset-password?token_hash=abc123&type=recovery';
/** A SECOND, freshly requested recovery link — a different token_hash. */
const SECOND_RECOVERY_URL = 'frontdoorsales://reset-password?token_hash=def456&type=recovery';
const OTHER_URL = 'frontdoorsales://karte';

/** A fake `expo-linking` client: cold-start URL is fixed at construction,
 * `addEventListener` records its handler so tests can fire warm-app events
 * manually, `parse` does a minimal real parse of our test URLs. */
function fakeLinking(initialUrl: string | null): {
  linking: DeepLinkingClient;
  fireUrl: (url: string) => void;
  removeCount: () => number;
} {
  let handler: ((event: { url: string }) => void) | null = null;
  let removeCount = 0;
  const linking: DeepLinkingClient = {
    getInitialURL: async () => initialUrl,
    addEventListener: (_type, h) => {
      handler = h;
      return {
        remove: () => {
          removeCount += 1;
        },
      };
    },
    parse: (url) => {
      const [withoutScheme] = url.split('://').slice(1);
      const [path, query] = (withoutScheme ?? '').split('?');
      const queryParams: Record<string, string> = {};
      if (query) {
        for (const pair of query.split('&')) {
          const [key, value] = pair.split('=');
          if (key) queryParams[key] = value ?? '';
        }
      }
      return { path: path || null, queryParams };
    },
  };
  return {
    linking,
    fireUrl: (url) => handler?.({ url }),
    removeCount: () => removeCount,
  };
}

function fakeAuth(result: { error: { message?: string } | null }): {
  auth: DeepLinkAuthClient;
  verifyOtp: ReturnType<typeof vi.fn>;
} {
  const verifyOtp = vi.fn(async () => ({ data: {}, error: result.error }));
  return { auth: { verifyOtp }, verifyOtp };
}

/** Like `fakeAuth`, but answers each successive `verifyOtp` call with the next
 * queued result — needed to model the realistic "this link expired → request a
 * new one → tap it" sequence within one warm app session. */
function fakeAuthSequence(results: ReadonlyArray<{ message?: string } | null>): {
  auth: DeepLinkAuthClient;
  verifyOtp: ReturnType<typeof vi.fn>;
} {
  let call = 0;
  const verifyOtp = vi.fn(async () => {
    const error = results[call] ?? null;
    call += 1;
    return { data: {}, error };
  });
  return { auth: { verifyOtp }, verifyOtp };
}

describe('attachDeepLinkRecovery', () => {
  it('ignores a URL that does not match the recovery route: no supabase-js call', async () => {
    const { linking, fireUrl } = fakeLinking(null);
    const { auth, verifyOtp } = fakeAuth({ error: null });
    const onRecovery = vi.fn();
    const onExpired = vi.fn();
    attachDeepLinkRecovery({ linking, auth, onRecovery, onExpired });

    fireUrl(OTHER_URL);
    await Promise.resolve();

    expect(verifyOtp).not.toHaveBeenCalled();
    expect(onRecovery).not.toHaveBeenCalled();
    expect(onExpired).not.toHaveBeenCalled();
  });

  it('hands a matching URL to supabase-js exactly once and fires onRecovery on success', async () => {
    const { linking, fireUrl } = fakeLinking(null);
    const { auth, verifyOtp } = fakeAuth({ error: null });
    const onRecovery = vi.fn();
    const onExpired = vi.fn();
    attachDeepLinkRecovery({ linking, auth, onRecovery, onExpired });

    fireUrl(RECOVERY_URL);
    await Promise.resolve();
    await Promise.resolve();

    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc123', type: 'recovery' });
    expect(onRecovery).toHaveBeenCalledTimes(1);
    expect(onExpired).not.toHaveBeenCalled();
  });

  it('calls onExpired (not onRecovery) when supabase-js rejects the code (expired/already-used)', async () => {
    const { linking, fireUrl } = fakeLinking(null);
    const { auth } = fakeAuth({ error: { message: 'Token has expired or is invalid' } });
    const onRecovery = vi.fn();
    const onExpired = vi.fn();
    attachDeepLinkRecovery({ linking, auth, onRecovery, onExpired });

    fireUrl(RECOVERY_URL);
    await Promise.resolve();
    await Promise.resolve();

    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(onRecovery).not.toHaveBeenCalled();
  });

  it('calls onExpired with no supabase-js call when a matching URL is missing token_hash', async () => {
    const { linking, fireUrl } = fakeLinking(null);
    const { auth, verifyOtp } = fakeAuth({ error: null });
    const onRecovery = vi.fn();
    const onExpired = vi.fn();
    attachDeepLinkRecovery({ linking, auth, onRecovery, onExpired });

    fireUrl('frontdoorsales://reset-password');
    await Promise.resolve();

    expect(verifyOtp).not.toHaveBeenCalled();
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(onRecovery).not.toHaveBeenCalled();
  });

  it('consumes a cold-start URL via getInitialURL', async () => {
    const { linking } = fakeLinking(RECOVERY_URL);
    const { auth, verifyOtp } = fakeAuth({ error: null });
    const onRecovery = vi.fn();
    attachDeepLinkRecovery({ linking, auth, onRecovery, onExpired: vi.fn() });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(onRecovery).toHaveBeenCalledTimes(1);
  });

  it('processes the same URL arriving on both cold-start and warm paths exactly once', async () => {
    const { linking, fireUrl } = fakeLinking(RECOVERY_URL);
    const { auth, verifyOtp } = fakeAuth({ error: null });
    const onRecovery = vi.fn();
    attachDeepLinkRecovery({ linking, auth, onRecovery, onExpired: vi.fn() });

    // Cold-start path resolves asynchronously; fire the warm-app event
    // "simultaneously" before it settles.
    fireUrl(RECOVERY_URL);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(onRecovery).toHaveBeenCalledTimes(1);
  });

  // REGRESSION (14-REVIEW CR-04): the guard used to latch for the app's
  // lifetime on the first recovery-path URL, so the flow's OWN documented
  // recovery path — "this link expired, request a new one" — dead-ended
  // silently in a still-warm app.
  it('processes a SECOND, freshly requested recovery link after the first one expired', async () => {
    const { linking, fireUrl } = fakeLinking(null);
    const { auth, verifyOtp } = fakeAuthSequence([{ message: 'Token has expired or is invalid' }, null]);
    const onRecovery = vi.fn();
    const onExpired = vi.fn();
    attachDeepLinkRecovery({ linking, auth, onRecovery, onExpired });

    fireUrl(RECOVERY_URL);
    await Promise.resolve();
    await Promise.resolve();
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(onRecovery).not.toHaveBeenCalled();

    // The rep requests a new link and taps it — the app is still warm.
    fireUrl(SECOND_RECOVERY_URL);
    await Promise.resolve();
    await Promise.resolve();

    expect(verifyOtp).toHaveBeenCalledTimes(2);
    expect(verifyOtp).toHaveBeenLastCalledWith({ token_hash: 'def456', type: 'recovery' });
    expect(onRecovery).toHaveBeenCalledTimes(1);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('never re-verifies an already-consumed token, even when the same URL is delivered again later', async () => {
    const { linking, fireUrl } = fakeLinking(null);
    const { auth, verifyOtp } = fakeAuth({ error: null });
    const onRecovery = vi.fn();
    const onExpired = vi.fn();
    attachDeepLinkRecovery({ linking, auth, onRecovery, onExpired });

    fireUrl(RECOVERY_URL);
    await Promise.resolve();
    await Promise.resolve();
    // Same single-use link again: re-verifying it would fail server-side and
    // wrongly tell a rep holding a live recovery session that it expired.
    fireUrl(RECOVERY_URL);
    await Promise.resolve();
    await Promise.resolve();

    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(onRecovery).toHaveBeenCalledTimes(1);
    expect(onExpired).not.toHaveBeenCalled();
  });

  it('re-reports expiry when a link that already failed is tapped again, rather than going silent', async () => {
    const { linking, fireUrl } = fakeLinking(null);
    const { auth } = fakeAuth({ error: { message: 'Token has expired or is invalid' } });
    const onExpired = vi.fn();
    attachDeepLinkRecovery({ linking, auth, onRecovery: vi.fn(), onExpired });

    fireUrl(RECOVERY_URL);
    await Promise.resolve();
    await Promise.resolve();
    fireUrl(RECOVERY_URL);
    await Promise.resolve();
    await Promise.resolve();

    expect(onExpired).toHaveBeenCalledTimes(2);
  });

  it('reports expiry for every tokenless recovery URL, not only the first', async () => {
    const { linking, fireUrl } = fakeLinking(null);
    const { auth, verifyOtp } = fakeAuth({ error: null });
    const onExpired = vi.fn();
    attachDeepLinkRecovery({ linking, auth, onRecovery: vi.fn(), onExpired });

    fireUrl('frontdoorsales://reset-password');
    fireUrl('frontdoorsales://reset-password');
    await Promise.resolve();

    expect(verifyOtp).not.toHaveBeenCalled();
    expect(onExpired).toHaveBeenCalledTimes(2);
  });

  it('returns a teardown that removes the listener, and calling it twice is safe', () => {
    const { linking, removeCount } = fakeLinking(null);
    const { auth } = fakeAuth({ error: null });
    const teardown = attachDeepLinkRecovery({
      linking,
      auth,
      onRecovery: vi.fn(),
      onExpired: vi.fn(),
    });

    expect(() => {
      teardown();
      teardown();
    }).not.toThrow();
    expect(removeCount()).toBe(2);
  });
});
