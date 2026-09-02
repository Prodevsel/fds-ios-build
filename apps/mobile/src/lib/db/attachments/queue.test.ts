import { beforeEach, describe, expect, it, vi } from 'vitest';

// Node test environment: never load native Expo/RN modules (see
// vitest.config.ts). queue.ts imports the Expo file-system storage adapter at
// module level; only the pure remote-adapter logic is under test here.
vi.mock('@powersync/attachments-storage-react-native', () => ({
  ExpoFileSystemStorageAdapter: class {},
}));

import type { AttachmentRecord } from '@powersync/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseRemoteStorageAdapter, remoteAttachmentFilename } from './queue';

/**
 * CR-04: storage object paths must be server-verifiable, user-namespaced and
 * never client-named — `<auth user id>/<attachment uuid>[.<ext>]`, enforced
 * server-side by the storage.objects policies in migration 0009. Uploads must
 * never upsert (audit binaries are immutable).
 */

const USER_ID = '40000000-0000-0000-0000-000000000001';
const ATTACHMENT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function makeAttachment(overrides: Partial<AttachmentRecord> = {}): AttachmentRecord {
  return {
    id: ATTACHMENT_ID,
    filename: 'signature.png',
    state: 0,
    timestamp: 0,
    mediaType: 'image/png',
    ...overrides,
  } as AttachmentRecord;
}

interface MockStorage {
  client: SupabaseClient;
  createSignedUploadUrl: ReturnType<typeof vi.fn>;
  uploadToSignedUrl: ReturnType<typeof vi.fn>;
  download: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  getSession: ReturnType<typeof vi.fn>;
}

function makeSupabase(): MockStorage {
  const createSignedUploadUrl = vi.fn(async (path: string) => ({
    data: { path, token: 'signed-token' },
    error: null,
  }));
  const uploadToSignedUrl = vi.fn(async () => ({ error: null }));
  const download = vi.fn(async () => ({
    data: { arrayBuffer: async () => new ArrayBuffer(1) },
    error: null,
  }));
  const remove = vi.fn(async () => ({ error: null }));
  const getSession = vi.fn(async () => ({
    data: { session: { user: { id: USER_ID } } },
    error: null,
  }));
  const client = {
    storage: {
      from: vi.fn(() => ({ createSignedUploadUrl, uploadToSignedUrl, download, remove })),
    },
    auth: { getSession },
  } as unknown as SupabaseClient;
  return { client, createSignedUploadUrl, uploadToSignedUrl, download, remove, getSession };
}

describe('remoteAttachmentFilename (CR-04)', () => {
  it('uses the attachment UUID plus a sanitized extension, never the raw filename', () => {
    expect(remoteAttachmentFilename({ id: ATTACHMENT_ID, filename: 'id-scan.JPG' })).toBe(
      `${ATTACHMENT_ID}.jpg`,
    );
  });

  it('drops a path-traversal / crafted filename entirely (extension only, or nothing)', () => {
    expect(
      remoteAttachmentFilename({ id: ATTACHMENT_ID, filename: '../../other-user/steal' }),
    ).toBe(ATTACHMENT_ID);
    expect(remoteAttachmentFilename({ id: ATTACHMENT_ID, filename: 'a/b/../c.png' })).toBe(
      `${ATTACHMENT_ID}.png`,
    );
  });

  it('rejects a non-UUID attachment id (object paths are never client-named)', () => {
    expect(() => remoteAttachmentFilename({ id: '../evil', filename: 'x.png' })).toThrow(/UUID/);
  });
});

describe('SupabaseRemoteStorageAdapter (CR-04)', () => {
  let supabase: MockStorage;
  let adapter: SupabaseRemoteStorageAdapter;

  beforeEach(() => {
    supabase = makeSupabase();
    adapter = new SupabaseRemoteStorageAdapter(supabase.client);
  });

  it('uploads to the user-namespaced path with upsert disabled', async () => {
    await adapter.uploadFile(new ArrayBuffer(4), makeAttachment());

    expect(supabase.createSignedUploadUrl).toHaveBeenCalledExactlyOnceWith(
      `${USER_ID}/${ATTACHMENT_ID}.png`,
    );
    expect(supabase.uploadToSignedUrl).toHaveBeenCalledExactlyOnceWith(
      `${USER_ID}/${ATTACHMENT_ID}.png`,
      'signed-token',
      expect.any(ArrayBuffer),
      expect.objectContaining({ upsert: false }),
    );
  });

  it('downloads and deletes via the same user-namespaced path', async () => {
    await adapter.downloadFile(makeAttachment());
    expect(supabase.download).toHaveBeenCalledExactlyOnceWith(`${USER_ID}/${ATTACHMENT_ID}.png`);

    await adapter.deleteFile(makeAttachment());
    expect(supabase.remove).toHaveBeenCalledExactlyOnceWith([`${USER_ID}/${ATTACHMENT_ID}.png`]);
  });

  it('refuses any storage operation without an authenticated session', async () => {
    supabase.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });

    await expect(adapter.uploadFile(new ArrayBuffer(1), makeAttachment())).rejects.toThrow(
      /no authenticated session/i,
    );
    expect(supabase.createSignedUploadUrl).not.toHaveBeenCalled();
  });
});
