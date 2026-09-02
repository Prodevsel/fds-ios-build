import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import type { AbstractPowerSyncDatabase } from '@powersync/common';
import { radius, spacing, typography } from '../../design/tokens';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { t, type TranslationKey } from '../../i18n';
import { InfoSheet } from '../../ui/InfoSheet';
import { createAssignableRepsRepo, type AssignableRepRow } from './db/assignableRepsRepo';
import { createAssignTerritory, type AssignVerdict } from './db/assignTerritory';

/**
 * AssignRepSheet — the team lead's lead-only assignee picker (TASGN-01/02).
 * Styled entirely on top of InfoSheet's existing bottom-sheet shell (grabber,
 * title, swipe-to-dismiss) — no new visual language. MapScreen only renders
 * this component when `useRoleScope().isTeamLead(territory.team_id)` is true
 * (UX-only gate, ROLE-02) — the direct `assign_territory` RPC (Plan 01)
 * remains the sole authority regardless of what renders on-screen.
 *
 * The picker names come from Plan 02's narrow synced `app_users` stream (id +
 * full_name only, never a broader profile fetch); the current assignee reads
 * from the synced read-only `territory_assignments` table, which Plan 02's
 * row-filtered stream delivers only to the assignee + lead/org-admin — a
 * plain teammate's device never even has the row to show.
 */

/** Maps a discriminated assign_territory() verdict to its German copy key. */
export function verdictToastKey(verdict: AssignVerdict): TranslationKey {
  switch (verdict) {
    case 'assigned':
      return 'assignRep.successToast';
    case 'not_entitled':
      return 'assignRep.verdictNotEntitled';
    case 'not_team_member':
      return 'assignRep.verdictNotTeamMember';
    case 'not_activated':
      return 'assignRep.verdictNotActivated';
  }
}

export interface AssignRepSheetProps {
  visible: boolean;
  onClose: () => void;
  db: AbstractPowerSyncDatabase;
  territoryId: string;
  teamId: string;
  /** Surfaces the per-verdict/success/error toast (MapScreen owns the actual toast UI). */
  onToast?: (message: string) => void;
}

export function AssignRepSheet({
  visible,
  onClose,
  db,
  territoryId,
  teamId,
  onToast,
}: AssignRepSheetProps) {
  const repsRepo = useMemo(() => createAssignableRepsRepo({ db }), [db]);
  const assigner = useMemo(() => createAssignTerritory(), []);
  const [reps, setReps] = useState<AssignableRepRow[]>([]);
  const [currentAssigneeId, setCurrentAssigneeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  useEffect(() => {
    if (!visible) return;
    return repsRepo.watchAssignableReps(teamId, setReps);
  }, [visible, repsRepo, teamId]);

  // The current assignee (if visible on this device at all — Plan 02's
  // row-filtered stream only delivers it to the assignee + lead/org-admin).
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    db.watch(
      'SELECT assigned_rep_id FROM territory_assignments WHERE territory_id = ?',
      [territoryId],
      {
        onResult: (result) => {
          const rows = (result.rows?._array ?? []) as Array<{ assigned_rep_id: string }>;
          setCurrentAssigneeId(rows[0]?.assigned_rep_id ?? null);
        },
      },
      { signal: controller.signal },
    );
    return () => controller.abort();
  }, [visible, db, territoryId]);

  async function handleSelect(repId: string | null) {
    setSaving(true);
    try {
      const verdict = await assigner.assignTerritory(territoryId, repId);
      onToast?.(t(verdictToastKey(verdict)));
      if (verdict === 'assigned') onClose();
    } catch {
      onToast?.(t('assignRep.errorGeneric'));
    } finally {
      setSaving(false);
    }
  }

  const currentAssignee = reps.find((rep) => rep.id === currentAssigneeId) ?? null;

  return (
    <InfoSheet visible={visible} onClose={onClose} title={t('assignRep.title')} testID="assign-rep-sheet">
      <Text style={styles.currentLabel}>{t('assignRep.currentAssigneeLabel')}</Text>
      <Text style={styles.currentValue} testID="assign-rep-current-value">
        {currentAssignee ? currentAssignee.fullName : t('assignRep.noAssignee')}
      </Text>

      {currentAssigneeId ? (
        <Pressable
          style={styles.clearRow}
          accessibilityRole="button"
          onPress={() => void handleSelect(null)}
          disabled={saving}
          testID="assign-rep-clear"
        >
          <Text style={styles.clearText}>{t('assignRep.clearCta')}</Text>
        </Pressable>
      ) : null}

      <Text style={styles.pickerHeading}>{t('assignRep.pickerHeading')}</Text>
      {reps.length === 0 ? (
        <Text style={styles.emptyText}>{t('assignRep.emptyHeading')}</Text>
      ) : (
        reps.map((rep) => {
          const selected = rep.id === currentAssigneeId;
          return (
            <Pressable
              key={rep.id}
              style={[styles.repRow, selected ? styles.repRowSelected : null]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => void handleSelect(rep.id)}
              disabled={saving}
              testID={`assign-rep-option-${rep.id}`}
            >
              <Text style={[styles.repRowText, selected ? styles.repRowTextSelected : null]}>
                {rep.fullName}
              </Text>
            </Pressable>
          );
        })
      )}
    </InfoSheet>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    currentLabel: { ...typography.label, color: colors.textSecondary, marginBottom: 2 },
    currentValue: { ...typography.heading, color: colors.textPrimary, marginBottom: spacing.md },
    clearRow: {
      minHeight: spacing.touchTarget,
      justifyContent: 'center',
      marginBottom: spacing.lg,
    },
    clearText: { ...typography.body, fontWeight: '600', color: colors.brick },
    pickerHeading: {
      ...typography.label,
      fontWeight: '600',
      color: colors.textSecondary,
      marginBottom: spacing.sm,
    },
    emptyText: { ...typography.body, color: colors.textSecondary },
    repRow: {
      minHeight: spacing.touchTarget,
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
      borderRadius: radius.input,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      marginBottom: spacing.sm,
    },
    repRowSelected: { borderColor: colors.accent, backgroundColor: colors.subtleFill },
    repRowText: { ...typography.body, color: colors.textPrimary },
    repRowTextSelected: { fontWeight: '600' },
  });
}
