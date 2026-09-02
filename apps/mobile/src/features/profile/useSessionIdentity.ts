import { useEffect, useState } from 'react';
import { getSupabase } from '../../lib/auth/supabase';

/**
 * The signed-in rep's display identity, resolved from the Supabase Auth session
 * (the only identity available on-device — `app_users` is deliberately NOT in
 * the sync stream, and there is no Berater-ID/VPKN column anywhere in the schema
 * yet; those stay honest placeholders, see the Profil/Berater-Ausweis screens).
 *
 * `fullName` comes from `user_metadata.full_name` when present, else null so the
 * caller can fall back to the email. Pure read — no writes, no PowerSync.
 */
export interface SessionIdentity {
  fullName: string | null;
  email: string | null;
  /** Two-letter uppercase initials (from the name, else the email), or ''. */
  initials: string;
  ready: boolean;
}

/** Derive up-to-two uppercase initials from a name, falling back to an email. */
export function deriveInitials(fullName: string | null, email: string | null): string {
  const source = (fullName ?? '').trim();
  if (source) {
    const parts = source.split(/\s+/).filter(Boolean);
    const letters = parts.slice(0, 2).map((p) => p[0] ?? '');
    return letters.join('').toUpperCase();
  }
  const local = (email ?? '').split('@')[0] ?? '';
  return local.slice(0, 2).toUpperCase();
}

export function useSessionIdentity(): SessionIdentity {
  const [state, setState] = useState<SessionIdentity>({
    fullName: null,
    email: null,
    initials: '',
    ready: false,
  });

  useEffect(() => {
    let cancelled = false;
    void getSupabase()
      .auth.getSession()
      .then(({ data }) => {
        if (cancelled) return;
        const user = data.session?.user;
        const metadata = (user?.user_metadata ?? {}) as Record<string, unknown>;
        const fullName = typeof metadata.full_name === 'string' ? metadata.full_name : null;
        const email = user?.email ?? null;
        setState({ fullName, email, initials: deriveInitials(fullName, email), ready: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
