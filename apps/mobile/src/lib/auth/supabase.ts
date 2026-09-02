import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { createMMKV } from 'react-native-mmkv';
import { createChunkedSecureStorage } from './chunkedSecureStorage';
import { buildDemoUrl } from './demoBackendUrl';

/**
 * Supabase client for the mobile app (auth + storage + RPC).
 *
 * Iron Rule 1: this client is NEVER used for reads/writes of synced data in
 * the sales rep's happy path — those go through the local PowerSync database
 * exclusively. Its only jobs here:
 * - Supabase Auth session (the JWT feeding PowerSync's fetchCredentials),
 * - the connector's server-side conflict RPCs + append-only inserts,
 * - Supabase Storage uploads via the attachment queue.
 *
 * Session persistence uses expo-secure-store (OS keychain/keystore) so the
 * refresh token never lands in plain AsyncStorage.
 */

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Define it in the app environment (.env / eas.json) — see powersync/.env.example for the server-side counterparts.`,
    );
  }
  return value;
}

/**
 * expo-secure-store-backed storage for supabase-js session persistence.
 *
 * WR-03: the session JSON (2-4 KB) exceeds Android's documented ~2048-byte
 * per-SecureStore-value limit, which would make persistence fail silently and
 * break the SYNC-01 offline relaunch. The chunked wrapper splits oversized
 * values across multiple keystore entries and reassembles them on read; every
 * byte still lives in the OS keychain/keystore, never plain AsyncStorage.
 */
const secureStorage = createChunkedSecureStorage(SecureStore);

/**
 * Demo-only runtime backend override.
 *
 * EXPO_PUBLIC_* values are compiled into the JS bundle, so the backend address
 * is fixed at build time. For a demo that means the laptop's address has to be
 * known before the build, and any change of network invalidates the .ipa — a
 * 13-minute CI round trip plus a re-sideload, on site, with a customer waiting.
 *
 * When EXPO_PUBLIC_DEMO_BACKEND_OVERRIDE=1 the login screen offers a host field
 * whose value is stored here and wins over the compiled-in URLs. Ports are the
 * fixed local-stack ones (supabase/config.toml, docker-compose.powersync.yml),
 * so the operator types an address and nothing else.
 *
 * The flag is set by the demo workflow only. In a release build the getters
 * below short-circuit to null on the first line and the compiled URLs stand.
 */
const DEMO_SUPABASE_PORT = 54321;
const DEMO_POWERSYNC_PORT = 8080;
const DEMO_HOST_KEY = 'backendHost';

/** MMKV, not SecureStore: this is read synchronously on the path that builds the
 * client, so an async store would need a hydration gate in the app bootstrap. */
interface DemoHostStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove?(key: string): void;
}

let demoStorage: DemoHostStorage | null = null;
function getDemoStorage(): DemoHostStorage {
  if (!demoStorage) {
    demoStorage = createMMKV({ id: 'demo-backend' });
  }
  return demoStorage;
}

/** True only in a demo build; gates both the storage access and the login-screen field. */
export function isDemoBackendOverrideEnabled(): boolean {
  return process.env.EXPO_PUBLIC_DEMO_BACKEND_OVERRIDE === '1';
}

/** The operator-entered host, or null when unset or not a demo build. */
export function getDemoBackendHost(): string | null {
  if (!isDemoBackendOverrideEnabled()) {
    return null;
  }
  try {
    const stored = getDemoStorage().getString(DEMO_HOST_KEY)?.trim();
    return stored ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Stores the host and drops the cached client so the next getSupabase() builds
 * against the new address. PowerSync reads its URL when it connects, which
 * happens after login, so no separate reset is needed there.
 */
export function setDemoBackendHost(host: string | null): void {
  if (!isDemoBackendOverrideEnabled()) {
    return;
  }
  const trimmed = host?.trim() ?? '';
  try {
    if (trimmed) {
      getDemoStorage().set(DEMO_HOST_KEY, trimmed);
    } else {
      getDemoStorage().remove?.(DEMO_HOST_KEY);
    }
  } catch {
    // A failed write must not block the demo: the value still applies in memory
    // for this launch via the client reset below.
  }
  client = null;
}

function demoUrl(port: number, path = ''): string | null {
  const host = getDemoBackendHost();
  return host ? buildDemoUrl(host, port, path) : null;
}

let client: SupabaseClient | null = null;

/**
 * Lazily-constructed singleton (env vars are validated on first use, not at
 * import time, so infrastructure modules stay importable in tests).
 */
export function getSupabase(): SupabaseClient {
  if (client) {
    return client;
  }
  client = createClient(
    demoUrl(DEMO_SUPABASE_PORT) ??
      requireEnv('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL),
    requireEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
    {
      auth: {
        storage: secureStorage,
        autoRefreshToken: true,
        persistSession: true,
        // React Native has no URL-based auth redirect flow.
        detectSessionInUrl: false,
      },
    },
  );
  return client;
}

/** PowerSync service endpoint (self-hosted Open Edition from Plan 06). */
export function getPowerSyncUrl(): string {
  return (
    demoUrl(DEMO_POWERSYNC_PORT) ??
    requireEnv('EXPO_PUBLIC_POWERSYNC_URL', process.env.EXPO_PUBLIC_POWERSYNC_URL)
  );
}

/** Supabase Edge Functions base URL; same override, same fallback. */
export function getSupabaseFunctionsUrl(): string | null {
  return demoUrl(DEMO_SUPABASE_PORT, '/functions/v1') ?? process.env.EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL ?? null;
}
