import { ExpoFileSystemStorageAdapter } from '@powersync/attachments-storage-react-native';
import type {
  AbstractPowerSyncDatabase,
  AttachmentQueueOptions,
  AttachmentRecord,
  RemoteStorageAdapter,
} from '@powersync/common';
import { AttachmentQueue } from '@powersync/common';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Attachment queue (SYNC-02/SYNC-03, threat T-01-21).
 *
 * Binary files (scans, signatures) NEVER pass through the PowerSync
 * replication stream — only their metadata rows sync (the local-only
 * `attachments` table in schema.ts). The binaries themselves are uploaded to
 * Supabase Storage via signed URLs by this queue, and live locally ONLY in
 * the app-sandboxed document directory (`<documents>/attachments`, the
 * ExpoFileSystemStorageAdapter default) — never the OS photo album.
 */

/** Supabase Storage bucket receiving attachment binaries. */
export const ATTACHMENT_BUCKET = 'attachments';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXTENSION_RE = /\.([a-z0-9]{1,8})$/i;

/**
 * CR-04: the storage OBJECT NAME is derived from the attachment record's UUID,
 * never the client-controlled filename — the filename contributes only a
 * sanitized extension (content-type hint for downloads). A non-UUID id is
 * rejected outright so no crafted value can ever influence the object path.
 */
export function remoteAttachmentFilename(
  attachment: Pick<AttachmentRecord, 'id' | 'filename'>,
): string {
  if (!UUID_RE.test(attachment.id)) {
    throw new Error(
      `attachment id must be a UUID (got '${attachment.id}') — object paths are never client-named`,
    );
  }
  const rawExtension = EXTENSION_RE.exec(attachment.filename ?? '')?.[1];
  const extension = rawExtension ? `.${rawExtension.toLowerCase()}` : '';
  return `${attachment.id.toLowerCase()}${extension}`;
}

/**
 * RemoteStorageAdapter uploading to Supabase Storage via signed URLs: a
 * short-lived signed upload URL is created per file, so the storage write
 * path is explicitly granted per object rather than an open bucket write.
 *
 * Object paths are `<auth user id>/<attachment uuid>[.<ext>]` (CR-04):
 * - the user-id prefix is ENFORCED server-side by the storage.objects RLS
 *   policies in supabase/migrations/0009_attachments_storage.sql — a client
 *   can never read or write outside its own prefix, so cross-user/cross-tenant
 *   overwrite is impossible by construction;
 * - uploads never use upsert: replays cannot silently clobber an existing
 *   audit binary (signatures/ID scans are evidence — overwrite is destruction).
 */
export class SupabaseRemoteStorageAdapter implements RemoteStorageAdapter {
  private readonly supabase: SupabaseClient;
  private readonly bucket: string;

  constructor(supabase: SupabaseClient, bucket: string = ATTACHMENT_BUCKET) {
    this.supabase = supabase;
    this.bucket = bucket;
  }

  async uploadFile(fileData: ArrayBuffer, attachment: AttachmentRecord): Promise<void> {
    const storage = this.supabase.storage.from(this.bucket);

    const { data, error } = await storage.createSignedUploadUrl(await this.pathFor(attachment));
    if (error || !data) {
      throw new Error(
        `createSignedUploadUrl failed for ${attachment.filename}: ${error?.message ?? 'no data'}`,
      );
    }

    const { error: uploadError } = await storage.uploadToSignedUrl(
      data.path,
      data.token,
      fileData,
      {
        contentType: attachment.mediaType ?? 'application/octet-stream',
        // CR-04: never upsert — an upload replay must not overwrite an
        // existing audit binary. A duplicate upload for an already-stored
        // object fails loudly instead of destroying evidence.
        upsert: false,
      },
    );
    if (uploadError) {
      throw new Error(
        `signed-URL upload failed for ${attachment.filename}: ${uploadError.message}`,
      );
    }
  }

  async downloadFile(attachment: AttachmentRecord): Promise<ArrayBuffer> {
    const { data, error } = await this.supabase.storage
      .from(this.bucket)
      .download(await this.pathFor(attachment));
    if (error || !data) {
      throw new Error(`download failed for ${attachment.filename}: ${error?.message ?? 'no data'}`);
    }
    return data.arrayBuffer();
  }

  async deleteFile(attachment: AttachmentRecord): Promise<void> {
    const { error } = await this.supabase.storage
      .from(this.bucket)
      .remove([await this.pathFor(attachment)]);
    if (error) {
      throw new Error(`delete failed for ${attachment.filename}: ${error.message}`);
    }
  }

  private async pathFor(attachment: AttachmentRecord): Promise<string> {
    const { data } = await this.supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) {
      throw new Error(
        `cannot resolve storage path for attachment ${attachment.id}: no authenticated session`,
      );
    }
    return `${userId}/${remoteAttachmentFilename(attachment)}`;
  }
}

export interface CreateAttachmentQueueOptions {
  db: AbstractPowerSyncDatabase;
  supabase: SupabaseClient;
  /**
   * Watches the app's data model for attachment references (e.g. a future
   * `contract_documents` table). Feature phases supply the watcher; the queue
   * itself is feature-agnostic infrastructure.
   */
  watchAttachments: AttachmentQueueOptions['watchAttachments'];
  bucket?: string;
  errorHandler?: AttachmentQueueOptions['errorHandler'];
}

/**
 * Builds the app's attachment queue: Supabase Storage (signed URLs) as remote
 * storage, the app-sandboxed Expo document directory as local storage.
 */
export function createAttachmentQueue(options: CreateAttachmentQueueOptions): AttachmentQueue {
  return new AttachmentQueue({
    db: options.db,
    remoteStorage: new SupabaseRemoteStorageAdapter(options.supabase, options.bucket),
    // Defaults to `<documents>/attachments` — app sandbox, never the photo
    // album (SYNC-03/T-01-21). Capture flows must write into this directory
    // via queue.saveFile(), never to media-library APIs.
    localStorage: new ExpoFileSystemStorageAdapter(),
    watchAttachments: options.watchAttachments,
    errorHandler: options.errorHandler,
  });
}
