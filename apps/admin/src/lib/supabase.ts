import { type SupabaseClient, createClient } from '@supabase/supabase-js';

/**
 * Supabase client for apps/admin.
 *
 * Unlike apps/mobile (which routes reads/writes through a local PowerSync DB),
 * this client IS the primary data path for the admin dashboard — a pure
 * client-side Vite build talking to Supabase directly (05-RESEARCH
 * Architectural Responsibility Map). Only the ANON key ships in this SPA
 * bundle (T-05-02); the service-role key is NEVER referenced here — privileged
 * operations (rep invite, etc.) go through Edge Functions.
 *
 * Web session persistence uses supabase-js's default localStorage storage, and
 * `detectSessionInUrl` is enabled for the browser OAuth/invite-redirect flow
 * (the RN app has neither).
 */

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set. Define it in apps/admin/.env`);
  }
  return value;
}

let client: SupabaseClient | null = null;

/** Lazily-constructed singleton (env validated on first use, not at import). */
export function getSupabase(): SupabaseClient {
  if (client) {
    return client;
  }
  client = createClient(
    requireEnv('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL),
    requireEnv('VITE_SUPABASE_ANON_KEY', import.meta.env.VITE_SUPABASE_ANON_KEY),
    {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    },
  );
  return client;
}
