import { describe, expect, it, vi } from 'vitest';
import { buildAvatarPath, uploadAvatar, validateAvatarAsset } from './avatarUpload';

const UID = '40000000-0000-0000-0000-000000000001';

describe('buildAvatarPath', () => {
  it('produces a path whose first segment is exactly the userId', () => {
    const path = buildAvatarPath(UID, 'jpg');
    expect(path.split('/')[0]).toBe(UID);
  });

  it('produces a stable <userId>/avatar.<ext> shape', () => {
    expect(buildAvatarPath(UID, 'jpg')).toBe(`${UID}/avatar.jpg`);
  });

  it('strips a leading dot from the extension and lowercases it', () => {
    expect(buildAvatarPath(UID, '.PNG')).toBe(`${UID}/avatar.png`);
  });

  it('throws when userId contains a path-traversal sequence', () => {
    expect(() => buildAvatarPath('../etc/passwd', 'jpg')).toThrow();
  });

  it('throws when userId contains a forward slash', () => {
    expect(() => buildAvatarPath(`${UID}/../other`, 'jpg')).toThrow();
  });

  it('throws for an empty userId', () => {
    expect(() => buildAvatarPath('', 'jpg')).toThrow();
  });
});

describe('validateAvatarAsset', () => {
  it('accepts a well-formed image/jpeg asset', () => {
    expect(validateAvatarAsset({ mimeType: 'image/jpeg', fileSize: 1024 })).toEqual({ valid: true });
  });

  it('accepts a well-formed image/png asset', () => {
    expect(validateAvatarAsset({ mimeType: 'image/png', fileSize: 1024 })).toEqual({ valid: true });
  });

  it('rejects an image/gif asset with reason unsupported-type', () => {
    expect(validateAvatarAsset({ mimeType: 'image/gif', fileSize: 1024 })).toEqual({
      valid: false,
      reason: 'unsupported-type',
    });
  });

  it('rejects an asset above the maximum byte size with reason too-large', () => {
    expect(validateAvatarAsset({ mimeType: 'image/jpeg', fileSize: 6 * 1024 * 1024 })).toEqual({
      valid: false,
      reason: 'too-large',
    });
  });

  it('rejects an asset with an unknown size', () => {
    expect(validateAvatarAsset({ mimeType: 'image/jpeg', fileSize: null })).toEqual({
      valid: false,
      reason: 'unknown-size',
    });
  });
});

describe('uploadAvatar', () => {
  function fakeSupabase(uploadImpl: (path: string) => Promise<{ data: { path: string } | null; error: { message: string } | null }>) {
    return {
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn((path: string) => uploadImpl(path)),
        })),
      },
    };
  }

  it('calls Storage upload with upsert: true and returns the stored path', async () => {
    let calledPath = '';
    let calledOptions: { contentType?: string; upsert?: boolean } | undefined;
    const supabase = {
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(async (path: string, _data: unknown, options?: { contentType?: string; upsert?: boolean }) => {
            calledPath = path;
            calledOptions = options;
            return { data: { path }, error: null };
          }),
        })),
      },
    };

    const result = await uploadAvatar(
      { userId: UID, extension: 'jpg', mimeType: 'image/jpeg', data: new Uint8Array([1, 2, 3]) },
      { supabase },
    );

    expect(result).toBe(`${UID}/avatar.jpg`);
    expect(calledPath).toBe(`${UID}/avatar.jpg`);
    expect(calledOptions?.upsert).toBe(true);
  });

  it('throws (never returns a value) when Storage upload errors', async () => {
    const supabase = fakeSupabase(async () => ({ data: null, error: { message: 'network error' } }));

    await expect(
      uploadAvatar({ userId: UID, extension: 'jpg', mimeType: 'image/jpeg', data: new Uint8Array() }, { supabase }),
    ).rejects.toThrow(/upload failed/);
  });
});
