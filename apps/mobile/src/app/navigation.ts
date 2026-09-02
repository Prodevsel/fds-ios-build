import type { NavigatorScreenParams } from '@react-navigation/native';

/**
 * Central route registry (SSOT for the navigator tree). Every screen the app
 * navigates to is named here so Wave-2 feature work can fill a stub without
 * touching the navigator wiring — add the screen's real content, keep its
 * route name + params.
 *
 * Tree:
 *   Root (native-stack, auth-gated)
 *   ├─ Login                     (unauthenticated)
 *   ├─ ForgotPassword            (unauthenticated — SEC-01 reset request,
 *   │                             optional `expired` param set by the deep-
 *   │                             link handler when the link was already
 *   │                             used/expired)
 *   ├─ ResetPassword             (reachable mid-recovery — SEC-01 reset
 *   │                             completion, reached via
 *   │                             `useDeepLinkRecovery`'s `onRecovery`)
 *   └─ Main  →  MainTabs (bottom-tab, authenticated)
 *        ├─ KarteTab       → KarteStack       (Karte = MapScreen + its flow)
 *        ├─ TermineTab     → TermineStack     (Termine)
 *        ├─ AbschluesseTab → AbschluesseStack (Abschluesse, AbschlussDetail)
 *        └─ ProfilTab      → ProfilStack       (Profil, BeraterAusweis,
 *                                               Einstellungen, ProfilEdit,
 *                                               Wallet, Aktuelles, Suche,
 *                                               Leaderboard, PasswortAendern,
 *                                               Sitzungen)
 *
 * `PasswortAendern` (SEC-02, ChangePasswordScreen) and `Sitzungen` (SEC-06,
 * SessionsScreen, plan 14-07) are reached from Einstellungen's Sicherheit
 * card (plan 14-08). Neither needs a PowerSync `db` — both read/write
 * through direct Supabase auth/RPC calls, never local SQLite — so neither
 * is registered behind `DbBoundary` (mirrors the `LeaderboardScreen`
 * precedent above).
 */

export type RootStackParamList = {
  Login: undefined;
  ForgotPassword: { expired?: boolean } | undefined;
  ResetPassword: undefined;
  /** First-run app-lock enrolment, mounted before Main while no PIN exists. */
  AppSperreEinrichten: undefined;
  Main: NavigatorScreenParams<MainTabsParamList> | undefined;
};

export type MainTabsParamList = {
  KarteTab: NavigatorScreenParams<KarteStackParamList> | undefined;
  TermineTab: NavigatorScreenParams<TermineStackParamList> | undefined;
  KundenTab: NavigatorScreenParams<KundenStackParamList> | undefined;
  AbschluesseTab: NavigatorScreenParams<AbschluesseStackParamList> | undefined;
  ProfilTab: NavigatorScreenParams<ProfilStackParamList> | undefined;
};

/**
 * "Meine Kunden" — one screen, no detail route. The list is a PROJECTION over
 * contracts and leads that already live on the device (features/customers/
 * customerSearch.ts), so there is no new record to open.
 */
export type KundenStackParamList = {
  Kunden: undefined;
};

export type KarteStackParamList = {
  /**
   * `focusHouseId` (optional): when navigated from the Termine tab, the map
   * opens that house's StatusSheet on arrival instead of only switching tabs
   * (mockup promise — a Termine card jumps to its house). Absent for a plain
   * tab switch.
   */
  Karte: { focusHouseId?: string } | undefined;
};

export type TermineStackParamList = {
  Termine: undefined;
};

export type AbschluesseStackParamList = {
  Abschluesse: undefined;
  AbschlussDetail: { contractId?: string } | undefined;
};

export type ProfilStackParamList = {
  Profil: undefined;
  BeraterAusweis: undefined;
  Einstellungen: undefined;
  ProfilEdit: undefined;
  Wallet: undefined;
  Aktuelles: undefined;
  Suche: undefined;
  Leaderboard: undefined;
  /** SEC-02 (plan 14-08) — in-app password change, reached from
   * Einstellungen's Sicherheit card. */
  PasswortAendern: undefined;
  /** SEC-06 (plan 14-07, wired 14-08) — rep-facing session list. */
  Sitzungen: undefined;
  /** SEC-03 (plan 15-06) — App-Sperre PIN setup + biometric enrollment,
   * reached from Einstellungen's Sicherheit card. Like `PasswortAendern`,
   * needs no PowerSync `db` — not registered behind `DbBoundary`. */
  AppSperre: undefined;
  /** SEC-07 (plan 15-10, D-01/D-04) — the local drain-then-purge wipe,
   * reached from Einstellungen's Sicherheit card ("Gerät zurücksetzen").
   * `LocalWipeScreen` reads the PowerSync upload-queue itself via
   * `wipeMachinery.ts`'s own production wiring — not registered behind
   * `DbBoundary`, mirroring `PasswortAendern`/`Sitzungen`/`AppSperre`. */
  GeraetZuruecksetzen: undefined;
  /** SEC-09 (plan 15-13) — account-deletion REQUEST, reached from
   * Einstellungen's Sicherheit card ("Konto löschen beantragen") — the
   * last row in that card. `AccountDeletionRequestScreen` writes
   * exclusively through the `request_account_deletion()` RPC
   * (`deletionRequestRepo.ts`, plan 15-04's migration 0081), never the
   * local PowerSync database, so like `PasswortAendern`/`Sitzungen`/
   * `AppSperre`/`GeraetZuruecksetzen` it is NOT registered behind
   * `DbBoundary`. */
  KontoLoeschenAnfrage: undefined;
};

/** Enables typed `useNavigation()` without per-call generics across the app. */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
