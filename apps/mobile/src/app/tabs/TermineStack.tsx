import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { TermineStackParamList } from '../navigation';
import { TermineScreen } from '../../features/termine/TermineScreen';

const Stack = createNativeStackNavigator<TermineStackParamList>();

/** Termine tab stack (design SSOT screen 12). Header hidden — the screen owns its own header chrome. */
export function TermineStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Termine" component={TermineScreen} />
    </Stack.Navigator>
  );
}
