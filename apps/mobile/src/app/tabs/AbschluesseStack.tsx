import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import type { AbschluesseStackParamList } from '../navigation';
import { DbBoundary } from '../DbBoundary';
import { ContractListScreen } from '../../features/checkout/ContractListScreen';
import { AbschlussDetailScreen } from '../../features/checkout/AbschlussDetailScreen';

const Stack = createNativeStackNavigator<AbschluesseStackParamList>();

/**
 * Abschluesse tab root (design SSOT screen 10, "Meine Abschlüsse"). Wires the
 * ContractListScreen into its tab slot, sourcing the local DB via DbBoundary.
 * Its header chevron returns to the Karte home tab (there is no parent to pop
 * on a tab root); a row tap pushes the Abschluss-Detail (10b) with the
 * contract id.
 */
function AbschluesseHome() {
  const navigation = useNavigation<NavigationProp<AbschluesseStackParamList>>();
  return (
    <DbBoundary>
      {(db) => (
        <ContractListScreen
          db={db}
          onClose={() => navigation.getParent()?.navigate('KarteTab')}
          onOpenDetail={(contractId) => navigation.navigate('AbschlussDetail', { contractId })}
        />
      )}
    </DbBoundary>
  );
}

export function AbschluesseStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Abschluesse" component={AbschluesseHome} />
      <Stack.Screen name="AbschlussDetail" component={AbschlussDetailScreen} />
    </Stack.Navigator>
  );
}
