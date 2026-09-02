import { describe, expect, it, vi } from 'vitest';

// Node test environment (queue.test.ts precedent): signatureAttachments.ts
// transitively imports queue.ts, which imports the Expo file-system storage
// adapter at module level — never load native Expo/RN modules in tests.
vi.mock('@powersync/attachments-storage-react-native', () => ({
  ExpoFileSystemStorageAdapter: class {},
}));

import type { AbstractPowerSyncDatabase } from '@powersync/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createSignatureAttachmentQueue,
  saveSignaturePng,
  watchContractSignatureAttachments,
  type SignatureAttachmentQueue,
} from './signatureAttachments';

const FAKE_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function fakeQueue(): SignatureAttachmentQueue & {
  saveFile: ReturnType<typeof vi.fn>;
  generateAttachmentId: ReturnType<typeof vi.fn>;
} {
  return {
    generateAttachmentId: vi.fn(async () => FAKE_UUID),
    saveFile: vi.fn(async (opts: { id?: string }) => ({
      id: opts.id ?? FAKE_UUID,
      filename: `${opts.id ?? FAKE_UUID}.png`,
      state: 0,
      hasSynced: false,
      timestamp: 0,
      mediaType: 'image/png',
    })),
  };
}

describe('saveSignaturePng (SIGN-02/SIGN-03, T-04-17: sandbox/signed-URL queue only)', () => {
  it('returns the fresh attachment UUID and requests mediaType image/png through the queue', async () => {
    const queue = fakeQueue();
    const id = await saveSignaturePng(queue, 'base64-png-data');

    expect(id).toBe(FAKE_UUID);
    expect(queue.generateAttachmentId).toHaveBeenCalledTimes(1);
    expect(queue.saveFile).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        id: FAKE_UUID,
        data: 'base64-png-data',
        fileExtension: 'png',
        mediaType: 'image/png',
      }),
    );
  });

  it('WR-02: a supplied presetId is used verbatim and generateAttachmentId is never called, so a retry reuses the SAME attachment id instead of orphaning a fresh one', async () => {
    const queue = fakeQueue();
    const PRESET_ID = 'preset-attachment-uuid';

    const firstId = await saveSignaturePng(queue, 'base64-png-data', PRESET_ID);
    const secondId = await saveSignaturePng(queue, 'base64-png-data', PRESET_ID);

    expect(firstId).toBe(PRESET_ID);
    expect(secondId).toBe(PRESET_ID);
    expect(queue.generateAttachmentId).not.toHaveBeenCalled();
    expect(queue.saveFile).toHaveBeenCalledTimes(2);
    expect(queue.saveFile.mock.calls[0]![0]).toMatchObject({ id: PRESET_ID });
    expect(queue.saveFile.mock.calls[1]![0]).toMatchObject({ id: PRESET_ID });
  });

  it('the structural queue type exposes only saveFile/generateAttachmentId — no direct storage/media surface is reachable', async () => {
    const queue = fakeQueue();
    await saveSignaturePng(queue, 'base64-png-data');

    expect(Object.keys(queue).sort()).toEqual(['generateAttachmentId', 'saveFile']);
  });
});

describe('source assertion (T-04-17: no direct storage/media API in this file)', () => {
  it('never references storage.upload / MediaLibrary / CameraRoll', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const sourcePath = fileURLToPath(new URL('./signatureAttachments.ts', import.meta.url));
    const source = readFileSync(sourcePath, 'utf-8');
    expect(source).not.toMatch(/storage\s*\.\s*upload|MediaLibrary|CameraRoll/);
  });
});

describe('watchContractSignatureAttachments (D-09: watches contracts.signature_attachment_id)', () => {
  it('watches contracts for non-null signature_attachment_id and maps rows to WatchedAttachmentItems', () => {
    let capturedOnResult: ((result: unknown) => void) | undefined;
    const fakeDb = {
      watch: vi.fn((sql: string, _params: unknown[], handler: { onResult: (result: unknown) => void }) => {
        expect(sql).toMatch(/contracts/);
        expect(sql).toMatch(/signature_attachment_id/);
        capturedOnResult = handler.onResult;
      }),
    } as unknown as AbstractPowerSyncDatabase;

    const onUpdate = vi.fn(async () => {});
    const controller = new AbortController();
    watchContractSignatureAttachments(fakeDb, onUpdate, controller.signal);

    expect(fakeDb.watch).toHaveBeenCalledTimes(1);

    capturedOnResult?.({ rows: { _array: [{ signature_attachment_id: FAKE_UUID }] } });

    expect(onUpdate).toHaveBeenCalledWith([
      { id: FAKE_UUID, fileExtension: 'png', mediaType: 'image/png' },
    ]);
  });
});

describe('createSignatureAttachmentQueue', () => {
  it('constructs an AttachmentQueue wired to the contracts watcher (D-09) without throwing', () => {
    const fakeDb = { watch: vi.fn() } as unknown as AbstractPowerSyncDatabase;
    const fakeSupabase = {} as SupabaseClient;

    expect(() => createSignatureAttachmentQueue({ db: fakeDb, supabase: fakeSupabase })).not.toThrow();
  });
});
