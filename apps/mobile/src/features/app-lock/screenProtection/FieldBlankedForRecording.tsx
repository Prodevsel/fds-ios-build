import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { radius, spacing, typography } from '../../../design/tokens';
import { t } from '../../../i18n';
import type { useThemeColors } from '../../settings/theme/useThemeColors';

/**
 * D-14b (SEC-05, 15-UI-SPEC.md §4, iOS-recording row; plan 15-09): the
 * deliberate-technical-state placeholder that REPLACES the ID document
 * preview / IBAN value while an active screen recording is detected. This
 * is a replacement, not an overlay — a caller renders this component IN
 * PLACE OF the real value, never on top of it, so the real value is never
 * mounted underneath (T-15-09-01).
 *
 * Reuses `SessionsScreen.tsx`'s `userAgentBlock` idiom (`colors.subtleFill`
 * inset block) — the established "this is a deliberate technical state, not
 * a bug" treatment in this codebase, per 15-UI-SPEC.md's explicit
 * instruction. MUST NOT read as a spinner or an empty/missing record: no
 * `ActivityIndicator`, no "Keine Daten"-style copy, no dismiss control —
 * the field returns to normal on its own the instant the recording stops
 * (`useRecordingDetection`'s own state transition), never via user action.
 *
 * `colors` is a PROP, not resolved via `useThemeColors()` internally — this
 * component has NO hooks, so it can be invoked directly as a plain function
 * in tests (no react-native-testing-library in this repo; mirrors this
 * module's own DI convention and `PinKeypad.tsx`'s presentational-component
 * split). The two callers (`IdScanBlock.tsx`/`IbanScanBlock.tsx`) already
 * hold a resolved `colors` object from their own `useThemeColors()` call.
 */
export interface FieldBlankedForRecordingProps {
  colors: ReturnType<typeof useThemeColors>;
  testID?: string;
}

export function FieldBlankedForRecording({ colors, testID }: FieldBlankedForRecordingProps) {
  const styles = makeStyles(colors);
  return (
    <View style={styles.container} testID={testID}>
      <MaterialCommunityIcons name="eye-off-outline" size={22} color={colors.textSecondary} />
      <Text style={styles.label}>{t('sec.fieldBlankedForRecording')}</Text>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: {
      minHeight: spacing.touchTarget * 2,
      backgroundColor: colors.subtleFill,
      borderRadius: radius.input,
      padding: spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
    },
    label: { ...typography.label, color: colors.textSecondary, textAlign: 'center' },
  });
}
