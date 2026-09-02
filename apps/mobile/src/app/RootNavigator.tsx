import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { Session } from '@supabase/supabase-js';
import type { RootStackParamList } from './navigation';
import { getColors } from '../design/tokens';
import { getSupabase } from '../lib/auth/supabase';
import { LoginScreen } from '../features/auth/LoginScreen';
import { ForgotPasswordScreen } from '../features/auth/ForgotPasswordScreen';
import { ResetPasswordScreen } from '../features/auth/ResetPasswordScreen';
import { useDeepLinkRecovery } from '../features/auth/useDeepLinkRecovery';
import { AccessibilityProvider } from '../features/settings/theme/AccessibilityProvider';
import { ThemeProvider, useColorSchemeResolved } from '../features/settings/theme/ThemeProvider';
import { AppLockGate } from '../features/app-lock/AppLockGate';
import { AppLockSetupScreen } from '../features/app-lock/AppLockSetupScreen';
import { AppLockProvider, useAppLock } from '../features/app-lock/AppLockProvider';
import { useScreenCapture } from '../features/app-lock/screenProtection/useScreenCapture';
import {
  defaultScreenshotHandlerDeps,
  handleScreenshotDetected,
} from '../features/app-lock/screenProtection/screenshotTelemetry';
import { MainTabs } from './MainTabs';

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Module-scope ref so `useDeepLinkRecovery`'s callbacks (mounted here, at
 * RootNavigator level — OUTSIDE any Stack.Screen) can navigate without a
 * `useNavigation()` hook, which is only available inside the container. */
const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** Extracted so `StatusBar style` can read the resolved scheme from inside `ThemeProvider`. */
function ThemedStatusBar() {
  const resolvedScheme = useColorSchemeResolved();
  // Dark icons read on the light background, light icons read on the dark one.
  return <StatusBar style={resolvedScheme === 'dark' ? 'light' : 'dark'} />;
}

/**
 * SEC-03 (15-06): reads `useAppLock()` — which is why this is a separate
 * component rendered INSIDE `AppLockProvider` rather than inline in
 * `RootNavigator` (hooks cannot read a context their own component provides).
 * `AppLockGate` REPLACES the `NavigationContainer` subtree when a session
 * exists and the app is locked (T-15-06-02) — it is never layered on top of
 * it, so nothing behind the gate is mounted or reachable by a back gesture.
 * The pre-session splash (rendered by the caller, outside this component)
 * and the Login/ForgotPassword/ResetPassword screens are never gated — there
 * is nothing to protect before a session exists.
 */
function AuthGatedNavigationTree({
  session,
  recoveryActive,
  onRecoveryComplete,
}: {
  session: Session | null;
  recoveryActive: boolean;
  onRecoveryComplete: () => void;
}) {
  const { isLocked, hasPin } = useAppLock();

  if (session && isLocked) {
    return <AppLockGate userId={session.user.id} />;
  }

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {session && !recoveryActive ? (
          // First-run app-lock enrolment. The setup screen used to live only
          // under Profil > Sicherheit, so a rep who never went looking carried
          // customer data behind no lock at all — and had no way to reach the
          // screen from the lock surface if one ever appeared. Mounting it as
          // the first authenticated screen closes both.
          //
          // No flash risk before hasPin resolves: the provider's pre-resolution
          // default is isLocked:true, so the branch above renders until the
          // keychain lookup settles.
          !hasPin ? (
            <Stack.Group>
              <Stack.Screen name="AppSperreEinrichten" component={AppLockSetupScreen} />
              <Stack.Screen name="Main" component={MainTabs} />
            </Stack.Group>
          ) : (
            <Stack.Screen name="Main" component={MainTabs} />
          )
        ) : (
          <Stack.Group>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
            <Stack.Screen name="ResetPassword">
              {() => <ResetPasswordScreen onSuccess={onRecoveryComplete} />}
            </Stack.Screen>
          </Stack.Group>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

/**
 * Root navigator + auth gate (SafeAreaProvider → NavigationContainer). Gates on
 * the Supabase auth session: while the initial `getSession()` resolves a splash
 * spinner shows; then a native-stack renders EXACTLY ONE of two screens —
 * `Login` (no session) or `Main` (the bottom tabs). `onAuthStateChange` keeps
 * it live, so a successful `signInWithPassword` in LoginScreen (or a sign-out)
 * swaps the tree with no manual navigation, and an existing persisted session
 * (offline relaunch) lands straight on the tabs.
 */
export function RootNavigator() {
  // undefined = initial session still resolving; null = signed out.
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  // SEC-01: a recovery link's `verifyOtp` call establishes a REAL session
  // (GoTrue fires 'PASSWORD_RECOVERY' with a session attached, same as
  // 'SIGNED_IN') — without this flag the auth gate below would swap
  // straight to the authenticated tabs the instant the deep link resolves,
  // skipping the new-password screen entirely.
  const [recoveryActive, setRecoveryActive] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryActive(true);
      }
      setSession(nextSession);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleRecovery = useCallback(() => {
    if (navigationRef.isReady()) {
      navigationRef.navigate('ResetPassword');
    }
  }, []);
  const handleExpired = useCallback(() => {
    if (navigationRef.isReady()) {
      navigationRef.navigate('ForgotPassword', { expired: true });
    }
  }, []);
  // Mounted exactly once, here at RootNavigator level, so a recovery link
  // works from a cold start OR a warm app regardless of which screen is
  // currently showing.
  useDeepLinkRecovery(handleRecovery, handleExpired);

  const handleRecoveryComplete = useCallback(() => setRecoveryActive(false), []);

  // D-13/D-14a/D-14c (SEC-05, 15-08): app-wide capture protection + the
  // silent screenshot listener. Called unconditionally at the top of this
  // component — i.e. BEFORE the `session === undefined` splash check and the
  // auth gate below ever run — so protection is active on the Login screen
  // too, not only once a session exists. `handleScreenshotDetected` is a
  // no-op unless an ID/IBAN surface (`useSensitiveScreen`) is currently
  // mounted; it renders nothing and never throws (screenshotTelemetry.ts).
  const handleScreenshot = useCallback(() => {
    void handleScreenshotDetected(defaultScreenshotHandlerDeps);
  }, []);
  useScreenCapture(handleScreenshot);

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      {/* ThemeProvider wraps the ENTIRE tree, same as AccessibilityProvider
          below, so the status bar and every screen resolve the rep's theme
          preference (D-13) before/independent of being signed in. */}
      <ThemeProvider>
        <ThemedStatusBar />
        {/* AccessibilityProvider wraps the ENTIRE tree, including the
            pre-session splash and the Login screen — a rep's text-size/
            contrast preference must never depend on being signed in (SET-06).
            Before a session/db resolves it renders the documented defaults
            rather than blocking on a spinner of its own. */}
        <AccessibilityProvider>
          {/* AppLockProvider wraps the tree IMMEDIATELY inside
              AccessibilityProvider (15-06, SEC-03) — mounted here so its one
              async dependency (the SecureStore credential check) starts
              resolving as early as possible, before the session/nav tree is
              even known. It does not itself decide what renders; only
              `AuthGatedNavigationTree` (below, inside it) reads `isLocked`. */}
          <AppLockProvider>
            {session === undefined ? (
              <View style={styles.splash} testID="auth-splash">
                <ActivityIndicator color={splashColors.accent} />
              </View>
            ) : (
              <AuthGatedNavigationTree
                session={session}
                recoveryActive={recoveryActive}
                onRecoveryComplete={handleRecoveryComplete}
              />
            )}
          </AppLockProvider>
        </AccessibilityProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/**
 * The pre-session splash (below) renders BEFORE `ThemeProvider` can resolve
 * the rep's `theme` preference — `useThemeColors()` is not callable this
 * early. Deliberately reads `getColors('light')` statically instead of the
 * deprecated `color` alias, so this is a visible, intentional line of code
 * (not an accident of import order) and the alias can be deleted once every
 * other importer is migrated (12-15).
 */
const splashColors = getColors('light');

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: splashColors.background },
});
