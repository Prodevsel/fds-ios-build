import { useEffect, useState } from 'react';
import type { AbstractPowerSyncDatabase } from '@powersync/common';
import { openDatabase } from '../lib/db/powersync';
import { getSupabase } from '../lib/auth/supabase';

/**
 * Shared accessor for the (singleton) local PowerSync database + the signed-in
 * rep's user id, for tab screens that read synced data but do NOT own the
 * sync connection (ContractList under Abschlüsse, Wallet under Profil).
 *
 * The database is a process-wide singleton (`openDatabase()` in powersync.ts);
 * the PowerSync connection itself is established once by the Karte tab's
 * MapScreen (the app's initial, always-mounted tab). These consumers therefore
 * only need a handle to the already-open database, never a second connector.
 */
export interface SessionDbState {
  db: AbstractPowerSyncDatabase | null;
  userId: string | null;
  ready: boolean;
}

export function useSessionDb(): SessionDbState {
  const [db, setDb] = useState<AbstractPowerSyncDatabase | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await getSupabase().auth.getSession();
      const opened = await openDatabase();
      if (cancelled) return;
      setUserId(data.session?.user.id ?? null);
      setDb(opened);
      setReady(true);
    };
    void load();

    // The effect above runs ONCE, and three consumers of this hook —
    // AppLockProvider, ThemeProvider, AccessibilityProvider — are mounted at the
    // app root, ABOVE the auth gate. At that moment there is no session, so
    // every one of them latched userId = null and never learned otherwise: the
    // first sign-in of a launch left them pointing at nobody, and only a restart
    // (which re-runs the effect with a session already restored) fixed it. That
    // is the "first login needs an app restart" behaviour.
    //
    // Subscribing here fixes it for every consumer at once, regardless of where
    // it sits relative to the gate.
    const { data: sub } = getSupabase().auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setUserId(session?.user.id ?? null);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { db, userId, ready };
}
