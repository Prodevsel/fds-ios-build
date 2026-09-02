import { StyleSheet, Text, View } from 'react-native';
import { typography } from '../../design/tokens';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { t } from '../../i18n';

/**
 * TenantBadge — SEC-10/D-16: the always-visible chrome telling the rep which
 * company or sales organisation they are logged into (14-UI-SPEC.md's
 * "Tenant identity chrome" row). Purely informational: `typography.label` /
 * `colors.textSecondary`, never accent, never a card, never a button — this
 * mirrors `MapScreen.tsx`'s existing `syncPill` treatment so the two sit
 * naturally in the same overlay row.
 *
 * While the identity has not resolved yet (cold start, pre-RPC) it renders
 * `sessions.tenantNameLoading` — never a blank space and never a hardcoded
 * placeholder company name (T-14-09-03).
 */

export interface DeriveTenantBadgeLabelOptions {
  ready: boolean;
  tenantName: string | null;
}

/** Pure: the loading-copy key when not ready OR the name is empty/missing —
 * an empty string is never treated as a valid name (T-14-09-03). */
export function deriveTenantBadgeLabel({
  ready,
  tenantName,
}: DeriveTenantBadgeLabelOptions): Parameters<typeof t>[0] | string {
  if (!ready || !tenantName) return 'sessions.tenantNameLoading';
  return tenantName;
}

export interface TenantBadgeProps {
  ready: boolean;
  tenantName: string | null;
}

export function TenantBadge({ ready, tenantName }: TenantBadgeProps) {
  const colors = useThemeColors();
  const styles = makeStyles(colors);
  const label = deriveTenantBadgeLabel({ ready, tenantName });
  const displayText = label === 'sessions.tenantNameLoading' ? t(label) : label;

  // No new i18n key is introduced here deliberately (plan verification
  // requires an EMPTY diff over apps/mobile/src/i18n) — the accessibility
  // label mirrors the rendered text itself rather than a bespoke prefixed
  // sentence, same treatment `syncPillText` gets today.
  return (
    <View style={styles.tenantBadge}>
      <Text style={styles.tenantBadgeText} accessibilityLabel={displayText}>
        {displayText}
      </Text>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    tenantBadge: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    tenantBadgeText: { ...typography.label, color: colors.textSecondary },
  });
}
