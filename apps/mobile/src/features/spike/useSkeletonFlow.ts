import type { PowerSyncDatabase } from '@powersync/react-native';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getPowerSyncUrl, getSupabase } from '../../lib/auth/supabase';
import { SupabaseConnector, type SyncConflict } from '../../lib/db/connector';
import { openDatabase } from '../../lib/db/powersync';

/**
 * Walking Skeleton instrumentation harness (Plan 09, SYNC-01/02/03).
 *
 * Wires the pieces built in isolation by Plans 05-07 into the ONE flow the
 * whole product depends on:
 *   sign in (Supabase Auth) -> connect PowerSync (Plan 07 connector)
 *     -> local `sync_demo` insert (Iron Rule 1: PowerSync `execute`, never a
 *        direct Supabase network write) -> useQuery live list + sync status.
 *
 * OFFLINE RELAUNCH (SYNC-01 "record survives an app restart while offline"):
 * on mount the hook restores the persisted Supabase session via
 * `auth.getSession()` — a LOCAL read from expo-secure-store (supabase-js
 * persistSession), never a network round-trip (no `getUser()`), so a rep who
 * signed in once reaches 'ready' with the local encrypted DB fully offline.
 * `db.connect()` is fired in the background and simply stays disconnected
 * until network returns, when PowerSync drains the CRUD queue automatically.
 *
 * Dev-only / throwaway: this hook is NOT shipped UI, it exists to make the
 * airplane-mode -> reconnect transition observable on-screen for the Task 2
 * physical-device verification (SPIKE-RESULTS.md "Walking Skeleton E2E").
 *
 * Fixture credentials match `supabase/seed/test_fixtures.sql` ("Rep X",
 * company_id 10000000-0000-0000-0000-000000000001) — local/dev stack only.
 *
 * WR-02: the credentials are NOT source constants. They come from
 * EXPO_PUBLIC_FIXTURE_REP_EMAIL / EXPO_PUBLIC_FIXTURE_REP_PASSWORD, set only
 * in the developer's local .env (gitignored — see apps/mobile/.env.example),
 * so no credential literal exists in the source tree or in any JS bundle a
 * release build could ship. This whole module is additionally unreachable in
 * release: App.tsx loads the spike screens via a __DEV__-gated inline
 * require(), which Metro strips from production bundles.
 */

/** Fixture company id — a stable, non-secret fixture UUID (test_fixtures.sql). */
export const FIXTURE_COMPANY_ID = '10000000-0000-0000-0000-000000000001';

/** Dev-only fixture credentials from the local environment — never source literals (WR-02). */
export function getFixtureCredentials(): { email: string; password: string } {
  const email = process.env.EXPO_PUBLIC_FIXTURE_REP_EMAIL;
  const password = process.env.EXPO_PUBLIC_FIXTURE_REP_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'EXPO_PUBLIC_FIXTURE_REP_EMAIL / EXPO_PUBLIC_FIXTURE_REP_PASSWORD are not set. ' +
        'Add them to apps/mobile/.env (values from supabase/seed/test_fixtures.sql, dev stack only).',
    );
  }
  return { email, password };
}

export type SkeletonPhase =
  | 'restoring'
  | 'signed-out'
  | 'signing-in'
  | 'connecting'
  | 'ready'
  | 'error';

/**
 * Injectable boot dependencies — structural, so the unit test supplies plain
 * mocks and never loads native Expo/React Native modules (same pattern as
 * connector.ts's SupabaseLike).
 */
export interface SkeletonBootDeps<Db> {
  /** LOCAL session read (supabase-js persisted storage) — must not require network. */
  getSession(): Promise<{ data: { session: object | null } }>;
  /** Network sign-in with the fixture credentials. */
  signInWithPassword(): Promise<{ error: { message: string } | null }>;
  /** Opens the encrypted local DB and starts the background PowerSync connection. */
  openAndConnect(): Promise<Db>;
  setPhase(phase: SkeletonPhase): void;
}

/**
 * Shared boot path for both entry modes:
 * - 'restore' (mount): if a persisted session exists locally, proceed straight
 *   to the DB-init path (-> 'ready') with NO network call; otherwise
 *   -> 'signed-out' and wait for the user to tap sign-in.
 * - 'sign-in' (button): password grant, then the same DB-init path.
 *
 * Exported for unit tests (must never call signInWithPassword in restore mode).
 */
export async function bootSkeletonFlow<Db>(
  deps: SkeletonBootDeps<Db>,
  mode: 'restore' | 'sign-in',
): Promise<Db | null> {
  if (mode === 'restore') {
    // Offline-safe: getSession() only reads the locally persisted session.
    const { data } = await deps.getSession();
    if (!data.session) {
      deps.setPhase('signed-out');
      return null;
    }
  } else {
    deps.setPhase('signing-in');
    const { error } = await deps.signInWithPassword();
    if (error) {
      throw new Error(`sign-in failed: ${error.message}`);
    }
  }

  deps.setPhase('connecting');
  const db = await deps.openAndConnect();
  deps.setPhase('ready');
  return db;
}

export interface UseSkeletonFlowResult {
  phase: SkeletonPhase;
  error: string | null;
  db: PowerSyncDatabase | null;
  conflicts: SyncConflict[];
  signIn: () => Promise<void>;
}

/**
 * On mount, restores a persisted session (fully offline-capable); otherwise
 * exposes `signIn()` for the first-run fixture sign-in. Both paths open the
 * encrypted local database (Plan 07 `openDatabase()`) and connect it via the
 * SupabaseConnector — `db.connect()` is not awaited, exactly like the real
 * app: the UI stays responsive offline and PowerSync drains the CRUD upload
 * queue automatically once network returns.
 */
export function useSkeletonFlow(): UseSkeletonFlowResult {
  const [phase, setPhase] = useState<SkeletonPhase>('restoring');
  const [error, setError] = useState<string | null>(null);
  const [db, setDb] = useState<PowerSyncDatabase | null>(null);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const bootedRef = useRef(false);

  const makeDeps = useCallback(
    (): SkeletonBootDeps<PowerSyncDatabase> => ({
      getSession: () => getSupabase().auth.getSession(),
      signInWithPassword: () => getSupabase().auth.signInWithPassword(getFixtureCredentials()),
      openAndConnect: async () => {
        const database = await openDatabase();
        const connector = new SupabaseConnector({
          supabase: getSupabase(),
          powersyncUrl: getPowerSyncUrl(),
          onConflict: (conflict) => setConflicts((prev) => [...prev, conflict]),
        });
        // Iron Rule 1: this is the ONLY network path — connect() runs the
        // upload/download loop in the background. Never awaited so an
        // offline boot still reaches 'ready' (local DB is already open).
        // IN-02: catch instead of void — connect() retries network failures
        // internally, but configuration/auth errors reject; those must land
        // in the hook's error state, not as a global unhandled rejection.
        database.connect(connector).catch((err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
        });
        return database;
      },
      setPhase,
    }),
    [],
  );

  const boot = useCallback(
    async (mode: 'restore' | 'sign-in') => {
      setError(null);
      try {
        const database = await bootSkeletonFlow(makeDeps(), mode);
        if (database) {
          setDb(database);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
      }
    },
    [makeDeps],
  );

  // Session restore on mount — MUST work fully offline (Defect 1 root cause:
  // the initial version never called getSession(), so an offline relaunch
  // always showed 'signed-out' despite a validly persisted session).
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    void boot('restore');
  }, [boot]);

  const signIn = useCallback(() => boot('sign-in'), [boot]);

  return { phase, error, db, conflicts, signIn };
}

/**
 * Local-only insert (Iron Rule 1) — never a direct Supabase network write.
 * The row is picked up by the CRUD upload queue and drained by the
 * connector's `uploadData()` (LWW upsert for `sync_demo`) whenever the
 * PowerSync connection is up, with no manual trigger (SYNC-01/02).
 */
export async function insertDemoRow(db: PowerSyncDatabase, note: string): Promise<void> {
  const id = Crypto.randomUUID();
  await db.execute('INSERT INTO sync_demo (id, company_id, note, created_at) VALUES (?, ?, ?, ?)', [
    id,
    FIXTURE_COMPANY_ID,
    note,
    new Date().toISOString(),
  ]);
}
