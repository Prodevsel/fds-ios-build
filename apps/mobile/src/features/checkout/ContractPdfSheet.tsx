import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, typography } from '../../design/tokens';
import { t } from '../../i18n';
import { getSupabase } from '../../lib/auth/supabase';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../components/EmptyState';
import { DirectSignPdfViewer } from '../flow-runner/direct-sign/DirectSignPdfViewer';
import { createFetchContractPdf, type ContractPdfState } from './contractPdfAccess';
import { createContractPdfCache } from './contractPdfCache';

/**
 * QUICK-F99: the whole contract-PDF surface, in one modal.
 *
 * `DirectSignPdfViewer` is reused UNMODIFIED and is mounted ONLY in the ready
 * state. It renders its own prefetch prompt with `directSign.*` copy when its
 * `localFileUri` is null — copy that is about signing a template and is simply
 * wrong for a finished contract. So this sheet owns every non-ready state
 * itself and never hands the viewer a null uri (D-4).
 *
 * The four non-ready outcomes get four visibly different surfaces. "Wird noch
 * erstellt" is a wait, not a failure — the document appears roughly a minute
 * after signing, once the cron dispatcher has run — and it must never be
 * dressed up as an error, nor as being offline.
 */
export interface ContractPdfSheetProps {
  contractId: string;
  visible: boolean;
  onRequestClose: () => void;
}

type MciName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/** Copy + glyph per non-ready state. Pure lookup, no branching in the render. */
function nonReadySurface(state: Exclude<ContractPdfState, 'idle' | 'loading' | 'ready'>): {
  icon: MciName;
  title: string;
  description: string;
  retryable: boolean;
} {
  switch (state) {
    case 'pending':
      return {
        icon: 'clock-outline',
        title: t('abschlussDetail.pdfNotReady'),
        description: t('abschlussDetail.pdfNotReadyRetry'),
        retryable: true,
      };
    case 'offline':
      return {
        icon: 'cloud-off-outline',
        title: t('abschlussDetail.pdfOffline'),
        description: t('abschlussDetail.pdfOfflineHint'),
        retryable: true,
      };
    case 'unavailable':
      return {
        icon: 'file-remove-outline',
        title: t('abschlussDetail.pdfUnavailable'),
        description: t('abschlussDetail.pdfUnavailableDetail'),
        retryable: false,
      };
    default:
      return {
        icon: 'alert-circle-outline',
        title: t('abschlussDetail.pdfFailed'),
        description: t('abschlussDetail.pdfFailedHint'),
        retryable: true,
      };
  }
}

export function ContractPdfSheet({ contractId, visible, onRequestClose }: ContractPdfSheetProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<ContractPdfState>('idle');
  const [localFileUri, setLocalFileUri] = useState<string | null>(null);

  // One cache + one fetcher per mounted sheet; both are stateless beyond the
  // file system, so the identity only matters for referential stability.
  const fetchContractPdf = useMemo(
    () => createFetchContractPdf(getSupabase(), createContractPdfCache()),
    [],
  );

  const load = useCallback(async () => {
    setState('loading');
    const result = await fetchContractPdf(contractId);
    setLocalFileUri(result.localFileUri);
    setState(result.state);
  }, [contractId, fetchContractPdf]);

  useEffect(() => {
    if (!visible) {
      // Reset on close so re-opening never flashes a stale verdict.
      setState('idle');
      setLocalFileUri(null);
      return;
    }
    void load();
  }, [visible, load]);

  const body = () => {
    if (state === 'ready' && localFileUri) {
      // The ONLY place the viewer is mounted, and always with a real uri.
      return <DirectSignPdfViewer localFileUri={localFileUri} />;
    }
    if (state === 'idle' || state === 'loading') {
      return (
        <View style={styles.centred} testID="contract-pdf-loading">
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.loadingText}>{t('abschlussDetail.pdfLoading')}</Text>
        </View>
      );
    }
    // `ready` without a uri cannot happen (createFetchContractPdf returns one
    // or the other), but the type does not know that — and a viewer with no
    // file is exactly the broken surface D-4 exists to avoid, so it degrades
    // to the failure copy rather than to an empty PDF frame.
    const surface = nonReadySurface(state === 'ready' ? 'failed' : state);
    return (
      <EmptyState
        testID={`contract-pdf-${state}`}
        icon={surface.icon}
        title={surface.title}
        description={surface.description}
        action={
          surface.retryable ? (
            <Button
              title={t('abschlussDetail.pdfRetryCta')}
              onPress={() => void load()}
              fullWidth={false}
            />
          ) : undefined
        }
      />
    );
  };

  return (
    <Modal visible={visible} onRequestClose={onRequestClose} animationType="slide">
      <View style={[styles.container, { paddingTop: insets.top }]} testID="contract-pdf-sheet">
        <View style={styles.header}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {t('abschlussDetail.pdfSheetTitle')}
          </Text>
          <Button
            title={t('abschlussDetail.pdfCloseCta')}
            variant="secondary"
            fullWidth={false}
            onPress={onRequestClose}
            testID="contract-pdf-close"
            leadingIcon={
              <MaterialCommunityIcons name="close" size={20} color={colors.textPrimary} />
            }
          />
        </View>
        <View style={styles.body}>{body()}</View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: { ...typography.heading, color: colors.textPrimary, flexShrink: 1 },
    body: { flex: 1 },
    centred: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
    loadingText: { ...typography.body, color: colors.textSecondary },
  });
}
