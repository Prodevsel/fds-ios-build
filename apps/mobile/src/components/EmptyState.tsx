import { useMemo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { radius, spacing, typography } from '../design/tokens';
import { useThemeColors } from '../features/settings/theme/useThemeColors';

type MciName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/**
 * Single source of truth for every mobile empty / no-results / first-run state
 * (mobile equivalent of admin's `EmptyState.tsx`). Renders the polished design
 * from `FrontDoorSales App.dc.html` screen 11: a soft rounded-square icon tile
 * (88dp, white, hairline border, muted glyph), a Space-Grotesk-600 title, muted
 * body copy and an optional centred action slot. Do NOT re-author per screen —
 * every empty state composes this so icon tile, typography and spacing stay
 * identical everywhere.
 */
export interface EmptyStateProps {
  /** MaterialCommunityIcons glyph rendered inside the soft rounded-square tile. */
  icon: MciName;
  title: string;
  description: string;
  /** Optional CTA / action slot rendered below the description (e.g. a Button). */
  action?: ReactNode;
  testID?: string;
}

export function EmptyState({ icon, title, description, action, testID }: EmptyStateProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.iconTile}>
        <MaterialCommunityIcons name={icon} size={40} color={colors.textMuted} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.xl + spacing.sm,
      textAlign: 'center',
    },
    iconTile: {
      width: 88,
      height: 88,
      borderRadius: radius.card + 6,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.lg,
    },
    title: {
      ...typography.heading,
      color: colors.textPrimary,
      textAlign: 'center',
      marginBottom: spacing.sm,
    },
    description: {
      ...typography.body,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    action: { marginTop: spacing.lg + 2, alignItems: 'center' },
  });
}
