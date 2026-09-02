import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { AbstractPowerSyncDatabase } from '@powersync/common';
import { radius, spacing, typography } from '../../design/tokens';
import { t } from '../../i18n';
import { useThemeColors } from '../settings/theme/useThemeColors';
import { getSupabase } from '../../lib/auth/supabase';
import { getDeviceIdDefault } from '../../lib/device/getDeviceId';
import { getSignatureLocationDefault } from '../../lib/location/getSignatureLocation';
import { createSignatureAttachmentQueue } from '../../lib/db/attachments/signatureAttachments';
import { FlowRunnerScreen } from './FlowRunnerScreen';
import { createContractsRepo } from './db/contractsRepo';
import { createProductDefinitionsRepo, type ProductDefinitionRow } from './db/productDefinitionsRepo';
import { createDirectSignTemplatesRepo } from './db/directSignTemplatesRepo';
import type { DirectSignFieldPlacement } from '@frontdoorsales/flow-schema';
import { DirectSignFlowScreen } from './direct-sign/DirectSignFlowScreen';
import { prefetchDirectSignPdf } from './direct-sign/prefetchDirectSignPdf';
import { createDirectSignPdfCache, cachedPdfUri } from './direct-sign/directSignPdfCache';
import { createDownloadDirectSignOriginal } from './direct-sign/downloadDirectSignOriginal';

/**
 * Routes a consultation to the flow the PRODUCT declares.
 *
 * Phase 10 built the whole direct_pdf path — DirectSignFlowScreen, the
 * belehrung gate, useDirectSignFlow, prefetchDirectSignPdf, hashPdfBytes,
 * completeDirectSign — and then nothing ever mounted it. StatusSheet went
 * straight to FlowRunnerScreen, so every product ran as the block-per-screen
 * wizard no matter what `contract_mode` said. This component is the missing
 * caller, and it is deliberately a thin router: neither downstream screen
 * changes.
 *
 * The direct_pdf branch prefetches the original PDF before rendering, because
 * `completeDirectSign` needs the verified ORIGINAL bytes (D-04's two-hash
 * model), not merely whatever file the viewer happens to be showing.
 */
export interface ConsultationFlowProps {
  db: AbstractPowerSyncDatabase;
  productSlug: string;
  houseId: string;
  /** The house's address, stamped onto the contract's Anschrift line. */
  houseAddress?: string | null;
  createdBy: string;
  teamId: string;
  territoryId?: string | null;
  draftVersion?: number;
  onExit: () => void;
  /** Passed straight through to whichever flow ends up rendering. */
  onContractSigned?: () => void;
  onViewContracts?: () => void;
  /**
   * §5.2: set when the rep opened this consultation by redeeming an offer
   * code. Forwarded unchanged to whichever flow the product declares — both
   * stamp it onto the resulting contract.
   */
  redeemedLeadId?: string | null;
  redeemedOfferCode?: string | null;
}

type Resolution =
  | { kind: 'loading' }
  | { kind: 'flow_form' }
  | {
      kind: 'direct_pdf';
      product: ProductDefinitionRow;
      templateId: string;
      templateSha256: string;
      /** 0085: variable anchors — shown to the customer before signing, and
       * used to render the finished document on the device at completion. */
      fieldPlacements: DirectSignFieldPlacement[];
      /**
       * Where the signature goes. Null when the template row has no anchor, in
       * which case the device cannot render and simply records no artifact
       * hash — never a blocked signature.
       */
      signatureAnchor: { page: number; xFrac: number; yFrac: number } | null;
      bytes: Uint8Array;
      localFileUri: string | null;
    }
  | { kind: 'error'; message: string };

export function ConsultationFlow({
  db,
  productSlug,
  houseId,
  houseAddress = null,
  createdBy,
  teamId,
  territoryId = null,
  draftVersion,
  onExit,
  onContractSigned,
  onViewContracts,
  redeemedLeadId = null,
  redeemedOfferCode = null,
}: ConsultationFlowProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [resolution, setResolution] = useState<Resolution>({ kind: 'loading' });

  const contractsRepo = useMemo(() => createContractsRepo({ db }), [db]);
  const signatureQueue = useMemo(
    () => createSignatureAttachmentQueue({ db, supabase: getSupabase() }),
    [db],
  );

  // THE §5.1 BLOCKER. startSync() is what runs the local storage adapter's
  // initialize() and creates `<documents>/attachments`. FlowRunnerScreen has
  // always called it; this component — which owns the queue for the
  // direct_pdf branch — never did. So saveFile() wrote into a directory that
  // did not exist and the very next read failed with
  //   UnexpectedException: Die Datei "<uuid>.png" existiert nicht
  //   (ExpoModulesCore/SyncFunctionDefinition.swift:96)
  // surfacing to the rep as "Der Abschluss konnte nicht gespeichert werden".
  // The wizard path was unaffected, which is why it only ever bit the PDF flow.
  useEffect(() => {
    void signatureQueue.startSync().catch(() => {
      // Offline/transient — saveFile still works once initialize() has run;
      // the periodic sync retries the upload when connectivity returns.
    });
    return () => {
      void signatureQueue.stopSync().catch(() => {});
    };
  }, [signatureQueue]);

  useEffect(() => {
    let cancelled = false;
    const resolve = async (): Promise<Resolution> => {
      const products = createProductDefinitionsRepo({ db });
      const product = await products.getLatestPublished(productSlug);
      if (!product) {
        throw new Error(`no product definition locally available for slug=${productSlug}`);
      }
      if (product.contract_mode !== 'direct_pdf') {
        return { kind: 'flow_form' };
      }
      if (!product.direct_sign_template_id) {
        throw new Error(`direct_pdf product ${productSlug} carries no direct_sign_template_id`);
      }
      const template = await createDirectSignTemplatesRepo({ db }).getById(
        product.direct_sign_template_id,
      );
      if (!template) {
        throw new Error(`direct-sign template ${product.direct_sign_template_id} is not synced`);
      }
      // Throws on a hash mismatch — a tampered or corrupt download must never
      // reach the signature step.
      const bytes = await prefetchDirectSignPdf(
        { id: template.id, storagePath: template.storage_path, sha256: template.sha256 },
        {
          downloadOriginal: createDownloadDirectSignOriginal(getSupabase()),
          cache: createDirectSignPdfCache(),
        },
      );
      return {
        kind: 'direct_pdf',
        product,
        templateId: template.id,
        templateSha256: template.sha256,
        fieldPlacements: template.field_placements,
        // All three or nothing: a half-specified anchor cannot place anything,
        // and guessing a default would stamp the signature somewhere plausible
        // and wrong on a legal document.
        signatureAnchor:
          template.signature_page !== null &&
          template.signature_x_frac !== null &&
          template.signature_y_frac !== null
            ? {
                page: template.signature_page,
                xFrac: template.signature_x_frac,
                yFrac: template.signature_y_frac,
              }
            : null,
        bytes,
        localFileUri: cachedPdfUri(template.id),
      };
    };

    void resolve()
      .then((next) => {
        if (!cancelled) setResolution(next);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setResolution({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [db, productSlug]);

  if (resolution.kind === 'loading') {
    return (
      <View style={styles.centre} testID="consultation-flow-loading">
        <ActivityIndicator color={colors.accent} />
        {/* Same reason as the error state: a download that never finishes is a
            dead screen too, and this one has no timeout. */}
        <Pressable
          style={styles.exitButton}
          accessibilityRole="button"
          onPress={onExit}
          testID="consultation-flow-loading-exit"
        >
          <Text style={styles.exitButtonText}>{t('common.back')}</Text>
        </Pressable>
      </View>
    );
  }

  if (resolution.kind === 'error') {
    return (
      <View style={styles.centre} testID="consultation-flow-error">
        <Text style={styles.errorText}>{t('errorState.consultationUnavailable')}</Text>
        <Text style={styles.errorDetail}>{resolution.message}</Text>
        {/*
          THE WAY OUT. This screen renders inside StatusSheet's fullScreen
          Modal, whose only dismissal is onRequestClose — the ANDROID hardware
          back button. On iOS a fullScreen modal has no swipe-to-dismiss, so
          without this button a failed product resolution stranded the rep on a
          dead screen in front of a customer, with force-quitting the app as the
          only escape. Every terminal state needs an exit; a spinner and an
          error text are terminal states.
        */}
        <Pressable
          style={styles.exitButton}
          accessibilityRole="button"
          onPress={onExit}
          testID="consultation-flow-error-exit"
        >
          <Text style={styles.exitButtonText}>{t('common.back')}</Text>
        </Pressable>
      </View>
    );
  }

  if (resolution.kind === 'flow_form') {
    return (
      <FlowRunnerScreen
        db={db}
        productSlug={productSlug}
        houseId={houseId}
        createdBy={createdBy}
        teamId={teamId}
        territoryId={territoryId}
        draftVersion={draftVersion}
        onExit={onExit}
        onContractSigned={onContractSigned}
        onViewContracts={onViewContracts}
        redeemedLeadId={redeemedLeadId}
        redeemedOfferCode={redeemedOfferCode}
      />
    );
  }

  return (
    <DirectSignFlowScreen
      blocks={resolution.product.blocks}
      fieldPlacements={resolution.fieldPlacements}
      signatureAnchor={resolution.signatureAnchor}
      houseAddress={houseAddress}
      // `prefetching`, `prefetchError` und `onRequestPrefetch` sind auf
      // DirectSignFlowScreenPdfProps deklariert, aber diese Aufloesung kennt
      // keinen laufenden Download: sie laedt die Vorlage einmal in `resolve()`
      // und liefert danach entweder eine Datei oder einen Fehler. Bis der
      // Download hier als Zustand gefuehrt wird, waere jedes durchgereichte
      // Feld erfunden — die Luecke steht im Handoff, nicht in einer Falschangabe.
      pdf={{ localFileUri: resolution.localFileUri }}
      signing={{
        companyId: resolution.product.company_id,
        repId: createdBy,
        teamId,
        productDefinitionId: resolution.product.id,
        productVersion: resolution.product.version,
        directSignTemplateId: resolution.templateId,
        originalPdfBytes: resolution.bytes,
        originalTemplateSha256: resolution.templateSha256,
        contractsRepo,
        attachmentQueue: signatureQueue,
        getDeviceId: getDeviceIdDefault,
        getSignatureLocation: getSignatureLocationDefault,
        generateUuid: () => Crypto.randomUUID(),
        // schema.ts has no product display-name column — the slug IS the name
        // (same honesty as FlowRunnerScreen's deriveSignatureSummary).
        productName: resolution.product.slug,
        // A direct_pdf product carries no discount block (D-04), so there is no
        // captured price to summarise. This was 0 with a comment saying 0 meant
        // "not captured, never free" — but the success screen formatted it and
        // printed "0,00 € mtl." under a signed contract. null is the value that
        // actually says nothing was captured, and the screen omits the segment.
        priceMonthly: null,
        redeemedLeadId,
        houseId,
      }}
      // §5.2: the offer exit in the PDF path. Without it a customer who does
      // not want to sign on the spot had no exit but Abbrechen, and the whole
      // consultation was lost.
      offer={{ db, productSlug, territoryId }}
      // The same PowerSync handle, for the success screen's transfer card:
      // it now asks the local upload queue whether this contract has actually
      // left the device instead of always claiming it has not.
      syncSource={db}
      digestFn={(data) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, data)}
      onExit={onExit}
      // Fehlte: ein per PDF unterschriebener Abschluss hat den Pin nie gruen
      // gefaerbt. Der Assistenten-Zweig reicht es seit jeher durch, dieser
      // nicht — der Vertrag lag in der Datenbank, die Karte zeigte das Haus
      // weiter als offen, und jede daraus abgeleitete Auswertung ebenso.
      onContractSigned={onContractSigned}
      onViewContracts={onViewContracts}
    />
  );
}

function makeStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    exitButton: {
      marginTop: spacing.lg,
      minHeight: spacing.touchTarget,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.button,
      borderWidth: 1.5,
      borderColor: colors.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    exitButtonText: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
    centre: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
      paddingHorizontal: spacing.xl,
      gap: spacing.sm,
    },
    errorText: { ...typography.heading, color: colors.textPrimary, textAlign: 'center' },
    errorDetail: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  });
}
