import { useMemo, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { AbstractPowerSyncDatabase } from '@powersync/common';
import { useThemeColors } from '../features/settings/theme/useThemeColors';
import { useSessionDb } from './useSessionDb';

/**
 * Render-prop boundary for tab screens that read the local PowerSync database
 * (ContractList, Wallet). Opens the singleton DB + resolves the signed-in
 * rep's id via `useSessionDb`, showing a brief centred spinner until both are
 * ready, then hands them to `children`. Keeps every consumer from repeating the
 * same open-and-await dance.
 */
export interface DbBoundaryProps {
  children: (db: AbstractPowerSyncDatabase, userId: string | null) => ReactNode;
}

export function DbBoundary({ children }: DbBoundaryProps) {
  const { db, userId, ready } = useSessionDb();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (!ready || !db) {
    return (
      <View style={styles.loading} testID="db-boundary-loading">
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  return <>{children(db, userId)}</>;
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  });
}
