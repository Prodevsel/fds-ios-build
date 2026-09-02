import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { KarteStackParamList } from '../navigation';
import { MapScreen } from '../../features/map/MapScreen';

const Stack = createNativeStackNavigator<KarteStackParamList>();

/**
 * Karte tab stack (design SSOT screen 02, the home screen). The full door-to-
 * door flow — FlowRunner, ID/IBAN scan blocks and the Success screen, plus the
 * StatusSheet/Sperre sheets — is already composed inside MapScreen (launched
 * from its StatusSheet), so the flow lives on this tab as the map's own
 * overlays rather than as separate pushed routes. Header hidden: the map is
 * full-bleed with its own floating chrome.
 */
export function KarteStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Karte" component={MapScreen} />
    </Stack.Navigator>
  );
}
