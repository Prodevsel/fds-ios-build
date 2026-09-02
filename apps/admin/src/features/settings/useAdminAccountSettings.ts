import { useSession } from '@/lib/auth/useSession';
import { getSupabase } from '@/lib/supabase';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Admin account-settings data layer (SET-09, D-12). Reads/writes the
 * signed-in operator's OWN row of `app_users.full_name` and
 * `user_settings.language` — both already RLS-permitted own-row writes
 * (`app_users_update_self`/`app_users_update_own`, 0003/0072;
 * `user_settings_update_own`/`user_settings_insert_own`, 0070).
 *
 * Mirrors `useLeaderboardConfig.ts`'s `useSaveLeaderboardConfig` /
 * `useBranding.ts`'s `useSaveBranding` read-then-branch mutation idiom
 * verbatim: `user_settings` is written via `update().eq('id', ...)` when a
 * row already exists for this user, else a plain `insert()` — NEVER a
 * single merge-style write (the banned Postgres ON-CON-FLICT clause)
 * against this force-RLS table (the standing 02-08 42501 trap, restated in
 * 0070's own header comment). `app_users.full_name`
 * is a plain `update().eq('id', ...)` — that row always exists once a user is
 * provisioned (`handle_invited_user()`, 0046), so no branch is needed there.
 */

export interface AdminAccountSettings {
  fullName: string;
  language: string;
}

const QUERY_KEY_BASE = 'admin-account-settings';

async function fetchAdminAccountSettings(userId: string): Promise<AdminAccountSettings> {
  const supabase = getSupabase();

  const { data: userRow, error: userError } = await supabase
    .from('app_users')
    .select('full_name')
    .eq('id', userId)
    .maybeSingle();
  if (userError) {
    throw userError;
  }

  const { data: settingsRow, error: settingsError } = await supabase
    .from('user_settings')
    .select('language')
    .eq('id', userId)
    .maybeSingle();
  if (settingsError) {
    throw settingsError;
  }

  return {
    fullName: (userRow?.full_name as string | null) ?? '',
    language: (settingsRow?.language as string | null) ?? 'de',
  };
}

/** The signed-in operator's own account settings (name + language). */
export function useAdminAccountSettings() {
  const { session } = useSession();
  const userId = session?.user.id;
  return useQuery({
    queryKey: [QUERY_KEY_BASE, userId],
    enabled: Boolean(userId),
    queryFn: () => fetchAdminAccountSettings(userId as string),
  });
}

/**
 * Persist the signed-in operator's own account settings. `user_settings` is
 * read-then-branch (see file header); `app_users.full_name` is a plain
 * own-row UPDATE. `onSuccess` invalidates the read query so `lastLoadedState`
 * (SettingsPage.tsx) is re-captured from the freshly persisted values.
 */
export function useSaveAdminAccountSettings() {
  const { session } = useSession();
  const userId = session?.user.id;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: AdminAccountSettings): Promise<void> => {
      if (!userId) {
        throw new Error('useSaveAdminAccountSettings: no signed-in user');
      }
      const supabase = getSupabase();

      const { error: userError } = await supabase
        .from('app_users')
        .update({ full_name: input.fullName })
        .eq('id', userId);
      if (userError) {
        throw userError;
      }

      const { data: existing, error: readError } = await supabase
        .from('user_settings')
        .select('id')
        .eq('id', userId)
        .maybeSingle();
      if (readError) {
        throw readError;
      }

      if (existing?.id) {
        const { error } = await supabase
          .from('user_settings')
          .update({ language: input.language, updated_at: new Date().toISOString() })
          .eq('id', userId);
        if (error) {
          throw error;
        }
        return;
      }

      const { error } = await supabase
        .from('user_settings')
        .insert({ id: userId, language: input.language });
      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [QUERY_KEY_BASE, userId] });
    },
  });
}
