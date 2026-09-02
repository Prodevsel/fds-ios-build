import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import type { KundenStackParamList } from '../navigation';
import { DbBoundary } from '../DbBoundary';
import { KundenScreen } from '../../features/customers/KundenScreen';

const Stack = createNativeStackNavigator<KundenStackParamList>();

/**
 * Kunden tab root. Same shape as AbschluesseStack: DbBoundary opens the local
 * PowerSync database, and the header chevron returns to Karte because a tab
 * root has no parent to pop.
 *
 * One screen, no detail route. The customer projection is derived from
 * contracts and leads that already have their own screens — a second detail
 * view would be a third place showing the same deal.
 */
function KundenHome() {
  const navigation = useNavigation<NavigationProp<KundenStackParamList>>();
  return (
    <DbBoundary>
      {(db) => (
        <KundenScreen db={db} onClose={() => navigation.getParent()?.navigate('KarteTab')} />
      )}
    </DbBoundary>
  );
}

export function KundenStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Kunden" component={KundenHome} />
    </Stack.Navigator>
  );
}
