import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MainTabsParamList } from './navigation';
import { spacing, typography } from '../design/tokens';
import { useThemeColors } from '../features/settings/theme/useThemeColors';
import { t } from '../i18n';
import { KarteStack } from './tabs/KarteStack';
import { TermineStack } from './tabs/TermineStack';
import { KundenStack } from './tabs/KundenStack';
import { AbschluesseStack } from './tabs/AbschluesseStack';
import { ProfilStack } from './tabs/ProfilStack';

type MciName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const Tab = createBottomTabNavigator<MainTabsParamList>();

/** Per-tab icon glyph (Karte · Termine · Kunden · Abschlüsse · Profil). */
const TAB_ICON: Record<keyof MainTabsParamList, MciName> = {
  KarteTab: 'map-outline',
  TermineTab: 'calendar-blank-outline',
  KundenTab: 'account-multiple-outline',
  AbschluesseTab: 'file-check-outline',
  ProfilTab: 'account-outline',
};

/**
 * Main bottom tab navigator (authenticated) — the design SSOT tab bar plus
 * Kunden: Karte · Termine · Kunden · Abschlüsse · Profil, active tint = Ink Navy, inactive =
 * slate, on a white bar with a hairline top border. Each tab is its own native
 * stack (see ./tabs/*). Karte is the initial route and the tab that owns the
 * PowerSync connection for the app.
 */
export function MainTabs() {
  // Android edge-to-edge (Expo SDK 54+) draws behind the gesture bar. On this
  // fleet's gesture-nav config the system reports bottom inset = 0, so relying on
  // the inset alone leaves the labels touching the edge — clamp to a comfortable
  // minimum so the bar is clean whether or not the OS reports an inset.
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, spacing.sm);
  const colors = useThemeColors();
  return (
    <Tab.Navigator
      initialRouteName="KarteTab"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: { fontSize: typography.label.fontSize, fontWeight: '600' },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          paddingTop: spacing.sm,
          paddingBottom: bottomPad,
          height: 56 + bottomPad,
        },
        tabBarIcon: ({ color: tintColor, size }) => (
          <MaterialCommunityIcons
            name={TAB_ICON[route.name]}
            size={size ?? 24}
            color={tintColor}
          />
        ),
      })}
    >
      <Tab.Screen name="KarteTab" component={KarteStack} options={{ title: t('nav.karte') }} />
      <Tab.Screen name="TermineTab" component={TermineStack} options={{ title: t('nav.termine') }} />
      <Tab.Screen name="KundenTab" component={KundenStack} options={{ title: t('nav.kunden') }} />
      <Tab.Screen
        name="AbschluesseTab"
        component={AbschluesseStack}
        options={{ title: t('nav.abschluesse') }}
      />
      <Tab.Screen name="ProfilTab" component={ProfilStack} options={{ title: t('nav.profil') }} />
    </Tab.Navigator>
  );
}
