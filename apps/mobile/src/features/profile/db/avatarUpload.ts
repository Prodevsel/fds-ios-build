/**
 * avatarUpload.ts (SET-10/D-03, plan 12-14) — validated own-uid upload path
 * into the private `avatars` Storage bucket (0073_avatars_bucket.sql).
 *
 * The Supabase Storage client is injected through an options object (same DI
 * convention as profileRepo/prefetchDirectSignPdf) so this module is
 * unit-testable without a network.
 *
 * `buildAvatarPath` produces a STABLE `<userId>/avatar.<ext>` path — a
 * replacement always overwrites the same object (matching the bucket's
 * UPDATE policy, T-12-14-04) rather than accumulating orphaned objects. The
 * first path segment is exactly `userId`, because that segment is the ENTIRE
 * access-control decision the bucket's RLS makes
 * ((storage.foldername(name))[1] = auth.uid()::text) — `buildAvatarPath`
 * additionally rejects a `userId` containing path-traversal characters so a
 * crafted id can never construct a path into another rep's folder
 * (T-12-14-01, defence in depth alongside the RLS itself).
 *
 * `validateAvatarAsset` enforces a MIME allowlist and a maximum byte size.
 * The bucket itself does NOT enforce content type (12-RESEARCH.md § Security
 * Domain, V5) — this is therefore the ONLY content control before upload
 * (T-12-14-03).
 *
 * `uploadAvatar` returns the stored PATH, never a signed URL: the bucket is
 * private, signed URLs expire, and persisting one on `app_users.avatar_url`
 * would silently rot (T-12-14-05). Callers resolve a short-lived signed URL
 * at DISPLAY time only (see ProfileScreen.tsx), never persist it.
 */

/** MIME types accepted for a profile photo. */
export const AVATAR_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'] as const;

/** Maximum accepted avatar asset size, in bytes (5 MiB). */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

const PATH_TRAVERSAL_RE = /[/\\]|\.\./;

/**
 * Builds the stable, own-uid-prefixed Storage object path for `userId`'s
 * avatar. Throws if `userId` contains a path separator or `..` — that
 * segment is exactly what the bucket's RLS matches against
 * (`(storage.foldername(name))[1] = auth.uid()::text`), so a crafted id must
 * never be allowed to construct a path outside the caller's own folder.
 */
export function buildAvatarPath(userId: string, extension: string): string {
  if (!userId || PATH_TRAVERSAL_RE.test(userId)) {
    throw new Error(`buildAvatarPath: userId must not contain '/', '\\' or '..' (got '${userId}')`);
  }
  const cleanExtension = extension.replace(/^\./, '').toLowerCase();
  return `${userId}/avatar.${cleanExtension}`;
}

/** The subset of an expo-image-picker asset this module needs to validate. */
export interface AvatarAssetInput {
  mimeType?: string | null;
  fileSize?: number | null;
}

export type AvatarValidationResult =
  | { valid: true }
  | { valid: false; reason: 'unsupported-type' | 'too-large' | 'unknown-size' };

/**
 * Validates a picked asset's MIME type and byte size BEFORE upload — the
 * only content control the bucket itself provides none of (T-12-14-03).
 */
export function validateAvatarAsset(asset: AvatarAssetInput): AvatarValidationResult {
  const mimeType = asset.mimeType ?? '';
  if (!AVATAR_ALLOWED_MIME_TYPES.includes(mimeType as (typeof AVATAR_ALLOWED_MIME_TYPES)[number])) {
    return { valid: false, reason: 'unsupported-type' };
  }
  if (asset.fileSize == null) {
    return { valid: false, reason: 'unknown-size' };
  }
  if (asset.fileSize > AVATAR_MAX_BYTES) {
    return { valid: false, reason: 'too-large' };
  }
  return { valid: true };
}

/** Structural subset of the Supabase Storage client this module needs. */
export interface AvatarStorageLike {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        data: unknown,
        options?: { contentType?: string; upsert?: boolean },
      ): PromiseLike<{ data: { path: string } | null; error: { message: string } | null }>;
    };
  };
}

export const AVATARS_BUCKET = 'avatars';

export interface UploadAvatarInput {
  userId: string;
  /** File extension without a leading dot (e.g. 'jpg', 'png'). */
  extension: string;
  mimeType: string;
  /** Raw asset bytes/blob, whatever shape the injected Storage client's `upload` accepts. */
  data: unknown;
}

export interface UploadAvatarOptions {
  supabase: AvatarStorageLike;
}

/**
 * Uploads a validated asset to the rep's own-uid folder in the `avatars`
 * bucket with `upsert: true` (replace in place, matching the bucket's UPDATE
 * policy) and returns the stored PATH — never a signed URL (see module doc).
 * Callers are expected to have already run `validateAvatarAsset` themselves;
 * this function does not re-validate.
 */
export async function uploadAvatar(input: UploadAvatarInput, options: UploadAvatarOptions): Promise<string> {
  const { userId, extension, mimeType, data } = input;
  const path = buildAvatarPath(userId, extension);

  const { data: result, error } = await options.supabase.storage.from(AVATARS_BUCKET).upload(path, data, {
    contentType: mimeType,
    // Replace in place, not a new orphaned object — matches the bucket's
    // UPDATE policy and the stable-filename convention (T-12-14-04).
    upsert: true,
  });
  if (error || !result) {
    throw new Error(`avatarUpload: upload failed for path=${path}: ${error?.message ?? 'no data'}`);
  }
  return result.path;
}
