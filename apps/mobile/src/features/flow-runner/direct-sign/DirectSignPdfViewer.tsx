import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Pdf from 'react-native-pdf';
import { radius, spacing, typography } from '../../../design/tokens';
import { t } from '../../../i18n';
import { useThemeColors } from '../../settings/theme/useThemeColors';

/**
 * DSGN-01/T-10-22: renders the prefetched, integrity-verified ORIGINAL PDF
 * (Plan 10-05's prefetchDirectSignPdf.ts cache) strictly VIEW-ONLY —
 * `react-native-pdf` exposes no annotation/edit affordance at all (grep-
 * verified: its props are read-only render/navigation controls only, see
 * node_modules/react-native-pdf/index.d.ts), and this wrapper adds none.
 * The original bytes on disk are never touched — this component only reads
 * a local file:// uri, it never writes to it.
 *
 * Purely presentational (local file uri in, render out) — no react-test-
 * renderer needed for this component (kept out of the unit-test surface per
 * the plan; typecheck is this file's verification).
 *
 * Deliberately NOT wrapped in `ForceLightTheme` (unlike the SET-05 signature/
 * scanner surfaces, 12-12 Task 1): the SET-05 hard exception exists because
 * the CAPTURE process itself (a signature stroke, an OCR camera frame) is
 * degraded by a dark surface. This component only VIEWS the tenant's own
 * already-rendered PDF page content — the app's theme chrome around the
 * viewer is cosmetic, the PDF's own pixels never change, so it gets the
 * normal `useThemeColors()` treatment like any other screen.
 */
export interface DirectSignPdfViewerProps {
  /**
   * Local file:// uri of the already-prefetched, sha256-verified original
   * PDF (prefetchDirectSignPdf.ts's cache, written by the injected
   * DirectSignPdfCache). Null when the template has not been prefetched on
   * this device yet — renders the "download while online" prompt instead of
   * a broken PDF load.
   */
  localFileUri: string | null;
  /** Wired to a prefetchDirectSignPdf(...) call by the screen (Task 3) — kept out of this presentational component. */
  onRequestPrefetch?: () => void;
  prefetching?: boolean;
  prefetchError?: string | null;
}

export function DirectSignPdfViewer({
  localFileUri,
  onRequestPrefetch,
  prefetching = false,
  prefetchError = null,
}: DirectSignPdfViewerProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (!localFileUri) {
    return (
      <View style={styles.promptContainer} testID="direct-sign-pdf-prefetch-prompt">
        <Text style={styles.promptText}>{prefetchError ?? t('directSign.prefetchPrompt')}</Text>
        {onRequestPrefetch ? (
          <Pressable
            style={styles.prefetchButton}
            accessibilityRole="button"
            disabled={prefetching}
            onPress={onRequestPrefetch}
            testID="direct-sign-pdf-prefetch-cta"
          >
            {prefetching ? (
              <ActivityIndicator size="small" color={colors.onAccent} />
            ) : (
              <Text style={styles.prefetchButtonText}>{t('directSign.prefetchCta')}</Text>
            )}
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    // react-native-pdf's PdfProps has no testID prop of its own (unlike a
    // plain RN component) — wrap in a plain View so the rendered PDF area
    // is still addressable in a future device-pass/manual test.
    <View style={styles.pdf} testID="direct-sign-pdf-view">
      <Pdf
        // cache:false — the bytes are already integrity-verified and cached
        // by prefetchDirectSignPdf's own sandboxed adapter; react-native-pdf
        // must not run a second, separate caching layer over the same file.
        source={{ uri: localFileUri, cache: false }}
        style={styles.pdf}
        // No annotation rendering — a purely display-time visual toggle for
        // any embedded PDF annotation OBJECTS (unrelated to user editing,
        // which this library never supports); left explicitly false so a
        // future template with stray annotation objects never renders as if
        // editable.
        enableAnnotationRendering={false}
        trustAllCerts={false}
      />
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    pdf: { flex: 1, backgroundColor: colors.background },
    promptContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.md,
      padding: spacing.lg,
    },
    promptText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
    prefetchButton: {
      minHeight: spacing.touchTarget,
      paddingHorizontal: spacing.lg,
      backgroundColor: colors.accent,
      borderRadius: radius.button,
      alignItems: 'center',
      justifyContent: 'center',
    },
    prefetchButtonText: { ...typography.body, fontWeight: '600', color: colors.onAccent },
  });
}
