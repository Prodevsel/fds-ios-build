import { useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { spacing, typography } from '../design/tokens';
import { useThemeColors } from '../features/settings/theme/useThemeColors';
import { EmptyState } from '../components/EmptyState';
import { t } from '../i18n';

type MciName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/**
 * Shared screen chrome for the navigation shell. `ScreenHeader` renders the
 * paper-toned top bar (safe-area aware) with the design's Space-Grotesk-600
 * title and an optional back chevron; `StubScreen` composes it with the shared
 * `EmptyState` "in Arbeit" placeholder — the honest scaffold every not-yet-built
 * design screen ships as until its Wave-2 owner fills in real content.
 */

export interface ScreenHeaderProps {
  title: string;
  onBack?: () => void;
  /** Optional trailing action node (e.g. an icon button). */
  right?: ReactNode;
}

export function ScreenHeader({ title, onBack, right }: ScreenHeaderProps) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          style={styles.backButton}
          hitSlop={8}
        >
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.textPrimary} />
        </Pressable>
      ) : null}
      <Text style={styles.headerTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.headerRight}>{right}</View>
    </View>
  );
}

export interface StubScreenProps {
  title: string;
  onBack?: () => void;
  /** Placeholder icon inside the EmptyState tile. */
  icon?: MciName;
  /** Overrides the default "in Arbeit" copy when a screen wants a hint of its own. */
  description?: string;
  /** Optional action slot below the placeholder (e.g. navigation buttons). */
  children?: ReactNode;
}

export function StubScreen({
  title,
  onBack,
  icon = 'progress-wrench',
  description,
  children,
}: StubScreenProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.container} testID={`stub-${title}`}>
      <ScreenHeader title={title} onBack={onBack} />
      <EmptyState
        icon={icon}
        title={t('stub.inProgressTitle')}
        description={description ?? t('stub.inProgressBody')}
        action={children}
      />
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
      backgroundColor: colors.background,
    },
    backButton: {
      width: spacing.touchTarget,
      height: spacing.touchTarget,
      marginLeft: -spacing.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: { ...typography.heading, color: colors.textPrimary, flex: 1 },
    headerRight: { minWidth: spacing.touchTarget, alignItems: 'flex-end' },
  });
}
