import { File, Directory, Paths } from 'expo-file-system';
import { closeDatabase as closePowerSyncDatabase, openDatabase } from '../../../lib/db/powersync';
import {
  DB_PATH_VERIFIED,
  resolveDatabaseFilePathsDefault,
  type DatabaseFilePaths,
} from '../../../lib/db/dbFilePaths';
import { regenerateEncryptionKey } from '../../../lib/db/encryption';

/**
 * wipeMachinery.ts — the ONE drain-then-purge implementation this phase
 * ships (D-04: local wipe, PIN-lockout wipe, remote wipe are three ENTRY
 * POINTS into this SAME machinery, never three separate implementations).
 *
 * THE § 257 HGB / § 147 AO ANCHOR (15-CONTEXT.md): no wipe path — local,
 * remote, or PIN-lockout — may destroy a signed contract artifact that has
 * not reached the server. `readWipeReadiness`/`runDrainThenPurge` read the
 * REAL PowerSync pending-upload queue via `getUploadQueueStats()` — the
 * existing queue, never a parallel hand-rolled counter (15-RESEARCH.md's
 * Don't Hand-Roll table) — and refuse to purge while it is non-zero, for
 * EVERY entry point including the PIN-lockout wipe at attempt 10 (D-12
 * inherits D-01 without exception).
 *
 * `disconnectAndClear()` ALONE is NOT a compliance-grade wipe
 * (15-RESEARCH.md Pitfall 1): it empties every synced/local table in place,
 * but the underlying SQLCipher `.sqlite`/`-wal`/`-shm` files stay on disk
 * with the deleted rows' bytes potentially recoverable from SQLite's
 * free-list pages until the file is actually removed. That is why this
 * module ALSO closes the database, deletes the three files, clears the
 * attachment store, and — last, after every file is gone — regenerates the
 * SQLCipher key, so even a surviving fragment becomes permanently unreadable.
 *
 * THE UNVERIFIED-PATH GATE (T-15-10-09, plan 15-01): `deps.dbPathVerified`
 * (bound to `DB_PATH_VERIFIED` from `dbFilePaths.ts`, plan 15-01's probe —
 * NEVER a literal `true` at any call site) gates the ENTIRE purge, checked
 * BEFORE the queue check. Plan 15-01's probe is permitted to conclude
 * `COULD-NOT-VERIFY-IN-THIS-SANDBOX`, and on that outcome the resolved file
 * paths are an unconfirmed assumption — deleting a guessed path would leave
 * the real SQLCipher file on disk while this module reported either
 * `complete` or a `failed` state that looks like an ordinary I/O problem,
 * neither of which would surface that the path assumption was never
 * confirmed. That is precisely the dishonesty D-02 forbids for the queue,
 * applied to the file location, and it sits on SEC-07's core guarantee that
 * the wipe actually deletes the file. `{kind:'blocked-unverified-path'}` is
 * therefore its own terminal phase — no destructive call, for any entry
 * point, can ever run while this flag is false.
 */

export type WipeEntryPoint = 'local' | 'pin-lockout' | 'remote';

export type WipePhase =
  | { kind: 'blocked'; pendingCount: number }
  | { kind: 'blocked-unverified-path' } // DB_PATH_VERIFIED false — see plan 15-01
  | { kind: 'ready' }
  | { kind: 'purging' }
  | { kind: 'complete' }
  | { kind: 'failed'; message: string };

export interface WipeDeps {
  getUploadQueueStats(): Promise<{ count: number; size: number | null }>;
  disconnectAndClear(): Promise<void>;
  closeDatabase(): Promise<void>;
  deleteFile(uri: string): Promise<void>;
  regenerateEncryptionKey(): Promise<void>;
  clearAttachmentStore(): Promise<void>;
  filePaths: { mainUri: string; walUri: string; shmUri: string };
  /** DB_PATH_VERIFIED from plan 15-01's probe — never hardcoded true. */
  dbPathVerified: boolean;
  onPhase?(phase: WipePhase): void;
}

/**
 * Reads the REAL PowerSync pending-upload queue depth and derives the
 * readiness verdict. The count is surfaced VERBATIM (D-02) — never coerced
 * to a boolean, so a consumer can render "3 Verträge" rather than a generic
 * "some data may be lost".
 */
export async function readWipeReadiness(
  deps: Pick<WipeDeps, 'getUploadQueueStats'>,
): Promise<WipePhase> {
  const stats = await deps.getUploadQueueStats();
  if (stats.count > 0) {
    return { kind: 'blocked', pendingCount: stats.count };
  }
  return { kind: 'ready' };
}

/**
 * Audit-visible, order-pinned purge sequence — a reviewable, tested fact
 * rather than something implicit in the code. `wipeMachinery.test.ts`
 * asserts the recorded call order equals this array exactly.
 */
export const PURGE_STEP_ORDER = [
  'disconnectAndClear',
  'closeDatabase',
  'deleteFile:main',
  'deleteFile:wal',
  'deleteFile:shm',
  'clearAttachmentStore',
  'regenerateEncryptionKey',
] as const;

/**
 * The ONE exported purge routine (D-04). `entry` is a label used only for
 * reporting/logging — it is NEVER a branch that changes what gets destroyed
 * or whether the queue/path checks apply. `wipeMachinery.test.ts` proves the
 * `'local'` and `'pin-lockout'` paths produce byte-identical recorded call
 * sequences, structurally, not merely by claim.
 */
export async function runDrainThenPurge(
  _entry: WipeEntryPoint,
  deps: WipeDeps,
): Promise<WipePhase> {
  // Gate 1 (T-15-10-09) — checked BEFORE the queue check, so a device with
  // BOTH problems reports the more fundamental one instead of a misleading
  // "sync first" instruction. See header comment for the full reasoning.
  if (!deps.dbPathVerified) {
    const phase: WipePhase = { kind: 'blocked-unverified-path' };
    deps.onPhase?.(phase);
    return phase;
  }

  // Gate 2 (D-01/D-02/D-04/D-12) — the § 257 HGB / § 147 AO anchor.
  const readiness = await readWipeReadiness(deps);
  if (readiness.kind === 'blocked') {
    deps.onPhase?.(readiness);
    return readiness;
  }

  deps.onPhase?.({ kind: 'purging' });

  let keyRegenerated = false;
  try {
    // disconnectAndClear() alone is NOT a compliance-grade wipe — see header
    // comment (15-RESEARCH.md Pitfall 1) — which is why file deletion and key
    // regeneration follow it.
    await deps.disconnectAndClear();
    await deps.closeDatabase();

    try {
      await deps.deleteFile(deps.filePaths.mainUri);
    } catch (err) {
      // The main file is the one the purge cannot tolerate losing (unlike
      // WAL/SHM below) — still regenerate the key so any surviving fragment
      // is unreadable, then report the failure honestly.
      await deps.regenerateEncryptionKey();
      keyRegenerated = true;
      throw err;
    }

    // WAL/SHM may legitimately not exist (SQLite may never have created
    // them) — a missing-file rejection here does NOT fail the purge.
    await deps.deleteFile(deps.filePaths.walUri).catch(() => undefined);
    await deps.deleteFile(deps.filePaths.shmUri).catch(() => undefined);

    await deps.clearAttachmentStore();
    // Runs LAST, after every file is gone — always a fresh key, never reused.
    await deps.regenerateEncryptionKey();
    keyRegenerated = true;

    const phase: WipePhase = { kind: 'complete' };
    deps.onPhase?.(phase);
    return phase;
  } catch (err) {
    if (!keyRegenerated) {
      await deps.regenerateEncryptionKey().catch(() => undefined);
    }
    const phase: WipePhase = {
      kind: 'failed',
      message: err instanceof Error ? err.message : String(err),
    };
    deps.onPhase?.(phase);
    return phase;
  }
}

// ---------------------------------------------------------------------------
// Production wiring — the only place this file touches a real native path.
// Deliberately a FACTORY (not a module-scope constant) so resolving the
// native db-file paths never runs at import time (would crash any
// environment where the native module isn't linked yet, including tests
// that don't mock it) — it runs only when a rep actually starts a wipe.
// ---------------------------------------------------------------------------

function toFileUri(pathOrUri: string): string {
  return pathOrUri.startsWith('file://') ? pathOrUri : `file://${pathOrUri}`;
}

async function productionDeleteFile(uri: string): Promise<void> {
  new File(toFileUri(uri)).delete();
}

/**
 * Deletes the local attachment store (`ExpoFileSystemStorageAdapter`'s
 * default `<documents>/attachments` directory, per `attachments/queue.ts`'s
 * own header comment) directly at the filesystem level. Deliberately NOT
 * routed through a live `AttachmentQueue` instance: that class needs a
 * signed-in Supabase client + a `watchAttachments` closure, neither of which
 * should be assumed to exist mid-wipe (a PIN-lockout wipe in particular may
 * run with no usable session at all) — deleting the directory the queue
 * itself writes into is the root-level action, not a workaround.
 */
async function productionClearAttachmentStore(): Promise<void> {
  const dir = new Directory(Paths.document, 'attachments');
  if (dir.exists) {
    dir.delete();
  }
}

/**
 * Resolves the real db file paths + verification flag defensively: if
 * `resolveDatabaseFilePathsDefault()` itself throws (native module not yet
 * linked — see `dbFilePaths.ts`'s own thrown-error case), that is EVIDENCE
 * the path was never actually confirmed on this build, so this falls back to
 * `dbPathVerified: false` rather than letting the wipe flow crash outright.
 * `DB_PATH_VERIFIED` itself is still read from `dbFilePaths.ts`, never
 * hardcoded `true` here.
 */
function resolveWipeFilePaths(): { filePaths: DatabaseFilePaths; dbPathVerified: boolean } {
  try {
    return { filePaths: resolveDatabaseFilePathsDefault(), dbPathVerified: DB_PATH_VERIFIED };
  } catch {
    return {
      filePaths: { directoryUri: '', mainUri: '', walUri: '', shmUri: '' },
      dbPathVerified: false,
    };
  }
}

/**
 * Real dependency wiring for `runDrainThenPurge` — binds `getUploadQueueStats`/
 * `disconnectAndClear` to the SAME already-open PowerSync database instance
 * `powersync.ts` manages (never a second, independently-opened handle), and
 * `closeDatabase` to that module's own `closeDatabase()` (never reimplemented
 * here) per 15-RESEARCH.md/15-PATTERNS.md's explicit instruction.
 */
export function createDefaultWipeDeps(onPhase?: (phase: WipePhase) => void): WipeDeps {
  const { filePaths, dbPathVerified } = resolveWipeFilePaths();
  return {
    async getUploadQueueStats() {
      const db = await openDatabase();
      return db.getUploadQueueStats();
    },
    async disconnectAndClear() {
      const db = await openDatabase();
      await db.disconnectAndClear({ clearLocal: true });
    },
    closeDatabase: closePowerSyncDatabase,
    deleteFile: productionDeleteFile,
    regenerateEncryptionKey: async () => {
      await regenerateEncryptionKey();
    },
    clearAttachmentStore: productionClearAttachmentStore,
    filePaths,
    dbPathVerified,
    onPhase,
  };
}
