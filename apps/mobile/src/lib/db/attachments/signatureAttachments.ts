import type { AbstractPowerSyncDatabase, AttachmentQueue, WatchedAttachmentItem } from '@powersync/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAttachmentQueue } from './queue';

/**
 * Signature-PNG attachment queue wiring (SIGN-02/SIGN-03, D-07, D-09,
 * threat T-04-17). The signature PNG is the ONLY binary this phase
 * produces — it MUST reach Supabase Storage exclusively through the
 * app-sandboxed/signed-URL attachment queue (queue.ts), never a direct
 * Supabase Storage upload call and never the OS photo album/media library.
 */

const CONTRACTS_SIGNATURE_ATTACHMENT_QUERY = `
  SELECT signature_attachment_id
  FROM contracts
  WHERE signature_attachment_id IS NOT NULL
`;

interface RawContractSignatureRow {
  signature_attachment_id: string;
}

/**
 * D-09: the watched set for this queue is exactly contracts whose
 * signature_attachment_id is non-null — the local-only `attachments`
 * bookkeeping table (schema.ts) is fed FROM this reference, never the
 * other way around. Exported standalone (not inlined in
 * createSignatureAttachmentQueue) so the watch-query shape/target table is
 * directly unit-testable against a fake db.
 */
export function watchContractSignatureAttachments(
  db: AbstractPowerSyncDatabase,
  onUpdate: (attachments: WatchedAttachmentItem[]) => Promise<void>,
  signal: AbortSignal,
): void {
  db.watch(
    CONTRACTS_SIGNATURE_ATTACHMENT_QUERY,
    [],
    {
      onResult: (result) => {
        const rows = (result.rows?._array ?? []) as RawContractSignatureRow[];
        void onUpdate(
          rows.map((row) => ({
            id: row.signature_attachment_id,
            fileExtension: 'png',
            mediaType: 'image/png',
          })),
        );
      },
    },
    { signal },
  );
}

export interface CreateSignatureAttachmentQueueOptions {
  db: AbstractPowerSyncDatabase;
  supabase: SupabaseClient;
}

/** Builds the attachment queue instance signature capture saves through (never a raw storage/media call). */
export function createSignatureAttachmentQueue(
  options: CreateSignatureAttachmentQueueOptions,
): AttachmentQueue {
  return createAttachmentQueue({
    db: options.db,
    supabase: options.supabase,
    watchAttachments: (onUpdate, signal) =>
      watchContractSignatureAttachments(options.db, onUpdate, signal),
  });
}

/** Structural slice of AttachmentQueue that saveSignaturePng depends on (injectable for tests). */
export type SignatureAttachmentQueue = Pick<AttachmentQueue, 'generateAttachmentId' | 'saveFile'>;

/**
 * Persists a captured signature PNG through the sandbox/signed-URL
 * attachment queue and returns the fresh attachment UUID — SignatureBlock
 * forwards this id to FlowRunnerScreen (and, in 04-08, to the contract
 * insert as signature_attachment_id, D-09). `pngBase64` is passed straight
 * through to the queue's local storage adapter, which decodes base64
 * strings to bytes itself (ExpoFileSystemStorageAdapter.saveFile).
 *
 * WR-02 (Phase 10 review): `presetId`, when supplied, is used verbatim
 * instead of calling `queue.generateAttachmentId()` — this lets a caller
 * that retries a failed completion (e.g. DirectSignFlowScreen.runCompletion)
 * reuse the SAME attachment id across attempts within one signing session,
 * so `queue.saveFile` overwrites the same local record instead of creating
 * a distinct orphaned attachment for every retry.
 */
export async function saveSignaturePng(
  queue: SignatureAttachmentQueue,
  pngBase64: string,
  presetId?: string,
): Promise<string> {
  const id = presetId ?? (await queue.generateAttachmentId());
  const record = await queue.saveFile({
    id,
    data: pngBase64,
    fileExtension: 'png',
    mediaType: 'image/png',
  });
  return record.id;
}
