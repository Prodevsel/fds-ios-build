import { useEffect } from 'react';
import * as ExpoLinking from 'expo-linking';
import { getSupabase } from '../../lib/auth/supabase';

/**
 * useDeepLinkRecovery — the app's first deep-link handler (SEC-01). Catches
 * the `frontdoorsales://reset-password?...` link emailed by the password-
 * reset flow and turns it into either a recovery session (`onRecovery`) or an
 * honest expiry error (`onExpired`). `apps/mobile/src/lib/auth/supabase.ts`
 * sets `detectSessionInUrl: false` (no window/URL auto-parse on React
 * Native), so this hook is the ONLY thing that ever hands a recovery URL to
 * supabase-js.
 *
 * STEP A verification (14-RESEARCH.md Assumption A2, marked UNVERIFIED):
 * `apps/mobile/node_modules` is hoisted to the workspace root
 * (`node_modules/@supabase/auth-js@2.110.6`, matching `apps/mobile`'s
 * `"@supabase/supabase-js": "^2.110.6"` pin). Its typings
 * (`node_modules/@supabase/auth-js/dist/module/GoTrueClient.d.ts`) do export
 * `exchangeCodeForSession(authCode: string): Promise<AuthTokenResponse>` —
 * but that method is PKCE-flow-only (`GoTrueClient.js`'s
 * `_exchangeCodeForSession` reads a `${storageKey}-code-verifier` entry this
 * app never writes, since `getSupabase()` never sets `flowType: 'pkce'`, and
 * changing that is out of this plan's scope). The actual recovery link this
 * app will receive does NOT carry a PKCE `code` at all: plan 14-03's
 * `send-auth-email` hook builds the email from the Auth Hook's own
 * `email_data.redirect_to` + `email_data.token_hash` payload fields (see
 * `14-03-PLAN.md` Task 2, "the recovery link is built from the payload's own
 * `redirect_to` and `token_hash` values"), which is the standard Supabase
 * custom-email pattern: `${redirectTo}?token_hash={token_hash}&type=recovery`.
 * The correct consumption method for a `token_hash`-shaped link is therefore
 * `verifyOtp({ token_hash, type: 'recovery' })` — also present in the
 * installed typings (`node_modules/@supabase/auth-js/dist/module/lib/types.d.ts`:
 * `interface VerifyTokenHashParams { token_hash: string; type: EmailOtpType }`,
 * `GoTrueClient.d.ts`: `verifyOtp(params: VerifyOtpParams): Promise<AuthResponse>`).
 * `verifyOtp` posts directly to `/verify` with no PKCE code-verifier
 * dependency, matching this app's actual link shape exactly.
 */

/** The single source of the recovery route string — the screen, the
 * `redirectTo` built in ForgotPasswordScreen and this handler all import
 * this constant rather than re-typing the literal. */
export const RECOVERY_PATH = 'reset-password';

/** The full redirect target handed to `resetPasswordForEmail`, matching the
 * `scheme: "frontdoorsales"` already declared in `apps/mobile/app.config.ts`. */
export const RECOVERY_REDIRECT_URL = `frontdoorsales://${RECOVERY_PATH}`;

/** Structural slice of `expo-linking` this hook depends on (injectable for tests). */
export interface DeepLinkingClient {
  getInitialURL: () => Promise<string | null>;
  addEventListener: (
    type: 'url',
    handler: (event: { url: string }) => void,
  ) => { remove: () => void };
  parse: (url: string) => { path: string | null; queryParams: Record<string, undefined | string | string[]> | null };
}

/** Structural slice of `supabase.auth` this hook depends on (injectable for tests). */
export interface DeepLinkAuthClient {
  verifyOtp: (params: {
    token_hash: string;
    type: 'recovery';
  }) => Promise<{ data: unknown; error: { message?: string } | null }>;
}

export interface AttachDeepLinkRecoveryDeps {
  linking: DeepLinkingClient;
  auth: DeepLinkAuthClient;
  /** Fired exactly once, after supabase-js confirms the recovery link and
   * establishes a session. */
  onRecovery: () => void;
  /** Fired when a matching URL is missing its `token_hash`, or supabase-js
   * rejects it (already used / genuinely expired). */
  onExpired: () => void;
}

/**
 * DI'd core (no component mounting — mirrors `attachMarkFirstSync`'s
 * standalone-`attachX` convention). Registers BOTH the cold-start
 * (`getInitialURL`) and warm-app (`addEventListener('url', ...)`) entry
 * paths.
 *
 * DE-DUPLICATION IS PER TOKEN, NOT PER LIFETIME (14-REVIEW CR-04). The guard
 * exists only so a duplicate delivery of the SAME link across both entry paths
 * never calls `verifyOtp` twice; a lifetime-wide "have I ever seen a recovery
 * URL" latch dead-ended the flow's own documented failure path — link expires,
 * rep requests a new one from `ForgotPasswordScreen`, taps it, and in a still
 * warm app nothing happens at all: no verify, no navigation, no error, no
 * feedback, until the app is force-quit. So:
 *
 *   - `inFlightToken` blocks a concurrent second delivery of the token whose
 *     verification is still pending (the actual cold-start/warm-app race).
 *   - `verifiedTokens` blocks re-verifying a token that ALREADY succeeded —
 *     it is single-use, so a second `verifyOtp` would fail and wrongly tell a
 *     rep holding a live recovery session that their link expired.
 *   - A token that FAILED is deliberately NOT remembered: re-tapping such a
 *     link fires `onExpired` again, which is honest feedback rather than
 *     silence.
 *   - A NEW token is always processed, however many links came before it.
 *
 * Never logs the URL or its `token_hash` — the recovery link is a bearer
 * credential.
 */
export function attachDeepLinkRecovery({
  linking,
  auth,
  onRecovery,
  onExpired,
}: AttachDeepLinkRecoveryDeps): () => void {
  let inFlightToken: string | null = null;
  const verifiedTokens = new Set<string>();

  const handleUrl = (url: string | null) => {
    if (!url) return;
    const { path, queryParams } = linking.parse(url);
    if (path !== RECOVERY_PATH) return;

    const rawTokenHash = queryParams?.token_hash;
    const tokenHash = Array.isArray(rawTokenHash) ? rawTokenHash[0] : rawTokenHash;
    if (!tokenHash) {
      onExpired();
      return;
    }
    if (tokenHash === inFlightToken || verifiedTokens.has(tokenHash)) return;

    inFlightToken = tokenHash;
    void auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' }).then(({ error }) => {
      inFlightToken = null;
      if (error) {
        onExpired();
      } else {
        verifiedTokens.add(tokenHash);
        onRecovery();
      }
    });
  };

  void linking.getInitialURL().then(handleUrl);
  const subscription = linking.addEventListener('url', (event) => handleUrl(event.url));

  return () => {
    subscription.remove();
  };
}

/** Reactive shell: attaches the real `expo-linking` client and the real
 * `getSupabase().auth` on mount, tearing down on unmount. Callers should pass
 * stable (`useCallback`'d) `onRecovery`/`onExpired` so this effect attaches
 * exactly once for the app's lifetime rather than re-subscribing. */
export function useDeepLinkRecovery(onRecovery: () => void, onExpired: () => void): void {
  useEffect(() => {
    return attachDeepLinkRecovery({
      linking: ExpoLinking,
      auth: getSupabase().auth,
      onRecovery,
      onExpired,
    });
  }, [onRecovery, onExpired]);
}
