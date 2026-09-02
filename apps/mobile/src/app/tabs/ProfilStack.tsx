import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import type { ProfilStackParamList } from '../navigation';
import { DbBoundary } from '../DbBoundary';
import { ProfileScreen } from '../../features/profile/ProfileScreen';
import { ProfileEditScreen } from '../../features/profile/ProfileEditScreen';
import { BeraterAusweisScreen } from '../../features/profile/BeraterAusweisScreen';
import { EinstellungenScreen } from '../../features/settings/EinstellungenScreen';
import { AktuellesScreen } from '../../features/notifications/AktuellesScreen';
import { SucheScreen } from '../../features/search/SucheScreen';
import { WalletScreen } from '../../features/wallet/WalletScreen';
import { LeaderboardScreen } from '../../features/leaderboard/LeaderboardScreen';
import { ChangePasswordScreen } from '../../features/auth/ChangePasswordScreen';
import { SessionsScreen } from '../../features/settings/SessionsScreen';
import { AppLockSetupScreen } from '../../features/app-lock/AppLockSetupScreen';
import { LocalWipeScreen } from '../../features/app-lock/wipe/LocalWipeScreen';
import { AccountDeletionRequestScreen } from '../../features/app-lock/AccountDeletionRequestScreen';

const Stack = createNativeStackNavigator<ProfilStackParamList>();

/**
 * Wallet ("Meine Provisionen", WALT-01) reached from the Profil tab (design
 * SSOT: the wallet lives under Profil). Wires the existing WalletScreen with
 * the local DB + rep id via DbBoundary; its close chevron pops back to Profil.
 */
function WalletRoute() {
  const navigation = useNavigation();
  return (
    <DbBoundary>
      {(db, userId) =>
        // Guard against an empty rep id like the other rep-scoped screens: the
        // wallet is rep-scoped (watchWallet(repId)), so mounting it with '' would
        // query a nonexistent rep and render a misleading empty wallet. By the
        // time Profil is reachable a session exists; this is the defensive floor.
        userId ? (
          <WalletScreen db={db} repId={userId} onClose={() => navigation.goBack()} />
        ) : null
      }
    </DbBoundary>
  );
}

/**
 * Leaderboard ("Bestenliste", GAMI-01/03) reached from the Profil tab. Wires
 * the rep's own id (for the "my rank" highlight only — never sent to the
 * RPC as a filter) via DbBoundary, mirroring WalletRoute; its close chevron
 * pops back to Profil. LeaderboardScreen itself never touches `db` — it is
 * explicitly NOT a PowerSync-backed screen (D-05) — so only `userId` is
 * threaded through here.
 */
function LeaderboardRoute() {
  const navigation = useNavigation();
  return (
    <DbBoundary>
      {(_db, userId) => <LeaderboardScreen repId={userId} onClose={() => navigation.goBack()} />}
    </DbBoundary>
  );
}

/**
 * "Gerät zurücksetzen" (SEC-07, plan 15-10) — the local drain-then-purge
 * wipe. `LocalWipeScreen` deliberately does NOT call `useNavigation()` itself
 * (see its own header comment: `AppLockGate.tsx` mounts the SAME component
 * OUTSIDE `NavigationContainer` for the pin-lockout entry point, where that
 * hook would throw) — this route wrapper resolves navigation HERE, where a
 * `NavigationContainer` genuinely exists, and passes it down as `onDismiss`,
 * mirroring `WalletRoute`/`LeaderboardRoute`'s own "resolve at the route
 * level, pass down as a prop" shape.
 */
function GeraetZuruecksetzenRoute() {
  const navigation = useNavigation();
  return <LocalWipeScreen onDismiss={() => navigation.goBack()} />;
}

/**
 * Profil tab stack (design SSOT screen 13) + every screen reachable from it:
 * Berater-Ausweis (customer-facing ID), Einstellungen, ProfilEdit (D-01/D-02,
 * plan 12-13), Wallet, Aktuelles, Suche, Leaderboard, PasswortAendern
 * (SEC-02) and Sitzungen (SEC-06, plan 14-08). Header hidden — each screen
 * owns its own header chrome (ScreenHeader / the reused screens' built-in
 * headers).
 *
 * `ChangePasswordScreen` and `SessionsScreen` are registered directly
 * (no `DbBoundary` wrapper, unlike `WalletRoute`/`LeaderboardRoute`'s `db`
 * threading) — both read/write exclusively through direct Supabase
 * auth/RPC calls, never the local PowerSync database, mirroring the
 * `LeaderboardScreen` precedent of a screen deliberately outside the
 * PowerSync path (09-04 decision, STATE.md).
 */
export function ProfilStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Profil" component={ProfileScreen} />
      <Stack.Screen name="BeraterAusweis" component={BeraterAusweisScreen} />
      <Stack.Screen name="Einstellungen" component={EinstellungenScreen} />
      <Stack.Screen name="ProfilEdit" component={ProfileEditScreen} />
      <Stack.Screen name="Wallet" component={WalletRoute} />
      <Stack.Screen name="Aktuelles" component={AktuellesScreen} />
      <Stack.Screen name="Suche" component={SucheScreen} />
      <Stack.Screen name="Leaderboard" component={LeaderboardRoute} />
      <Stack.Screen name="PasswortAendern" component={ChangePasswordScreen} />
      <Stack.Screen name="Sitzungen" component={SessionsScreen} />
      <Stack.Screen name="AppSperre" component={AppLockSetupScreen} />
      <Stack.Screen name="GeraetZuruecksetzen" component={GeraetZuruecksetzenRoute} />
      <Stack.Screen name="KontoLoeschenAnfrage" component={AccountDeletionRequestScreen} />
    </Stack.Navigator>
  );
}
