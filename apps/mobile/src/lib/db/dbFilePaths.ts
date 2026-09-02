import { Platform } from 'react-native';
// The only native import in this file (see the header comment for why `expo-file-system` is NOT
// used here) — `resolveDatabaseFilePaths` below never touches it, so it stays unit-testable
// under vitest/node with a `vi.mock('@op-engineering/op-sqlite', ...)` double.
import * as OpSqlite from '@op-engineering/op-sqlite';

/**
 * Resolved SQLCipher database file paths for the local/remote wipe machinery (SEC-07/SEC-08,
 * D-01/D-04, Plan 15-01 Task 3 / T-15-01-03 / T-15-01-05).
 *
 * WHERE THIS EVIDENCE COMES FROM: `scripts/spike/opsqlite-db-path-probe.mjs`, run against the
 * installed `@op-engineering/op-sqlite@15.2.14` (repo pin `^15.2.14`) and
 * `@powersync/op-sqlite@0.9.15` source directly — never inferred from docs prose (per
 * 15-RESEARCH.md Open Question 2, neither package's docs state this explicitly). The probe
 * exited 0 with BOTH platforms resolved conclusively:
 *
 *   ios:     app-sandboxed Library directory (NSLibraryDirectory) — because
 *            `apps/mobile/src/lib/db/powersync.ts` opens the database with no `location`
 *            override AND this app configures no `OPSQLite_AppGroup` Info.plist key, op-sqlite's
 *            native `install()` (ios/OPSQLite.mm) falls back to
 *            `NSSearchPathForDirectoriesInDomains(NSLibraryDirectory, ...)[0]`. Exposed at
 *            runtime as `@op-engineering/op-sqlite`'s own `IOS_LIBRARY_PATH` constant.
 *   android: the app's internal SQLite databases directory returned by
 *            `context.getDatabasePath("").absolutePath` (typically
 *            `/data/{data,user/0}/<applicationId>/databases/`) — confirmed identical between
 *            `OPSQLiteBridge.install()` and the `ANDROID_DATABASE_PATH` constant exported to JS
 *            (same source expression, not a second independently-computed guess).
 *
 * DEVIATION FROM THE ORIGINAL PLAN TEXT (documented per Rule 1 — correctness fix, not a silent
 * reinterpretation): 15-01-PLAN.md's Task 3 action assumed `resolveDatabaseFilePathsDefault()`
 * would compose `expo-file-system`'s document directory. The probe's IOS-2 check disproves this
 * for iOS: `expo-file-system`'s `documentDirectory`/`Paths.document` maps to `NSDocumentDirectory`
 * (confirmed absent from `@op-engineering/op-sqlite`'s own default-open-path logic), while
 * op-sqlite's ACTUAL default install()/open() base path is `NSLibraryDirectory` — a DIFFERENT
 * search-path domain. op-sqlite itself also exports a same-named-sounding `IOS_DOCUMENT_PATH`
 * constant that is ALSO `NSDocumentDirectory` and therefore ALSO the wrong directory for the
 * default (no-AppGroup) case — a naming trap confirmed by reading `install()`'s two separate
 * path variables side by side (IOS-1/IOS-2 in the probe output). Using `expo-file-system` here
 * would have produced a coherent-looking but WRONG resolved path — precisely the failure mode
 * T-15-01-03/T-15-01-05 exist to prevent ("never guess a path"). This file therefore reads
 * `@op-engineering/op-sqlite`'s own `IOS_LIBRARY_PATH`/`ANDROID_DATABASE_PATH` constants directly
 * — the same native module that actually opens the database, not a second library's unrelated
 * directory guess.
 */

export const DB_FILENAME = 'frontdoorsales.sqlite';

export interface DatabaseFilePaths {
  /** The resolved app-sandbox directory containing the db file (no trailing slash). */
  directoryUri: string;
  /** `<directoryUri>/frontdoorsales.sqlite` */
  mainUri: string;
  /** `<directoryUri>/frontdoorsales.sqlite-wal` */
  walUri: string;
  /** `<directoryUri>/frontdoorsales.sqlite-shm` */
  shmUri: string;
}

/**
 * Pure function: builds the main/-wal/-shm URIs for a given base directory. No native import is
 * reachable from this function — it runs under vitest/node with no mocks required. Accepts a
 * directory WITH or WITHOUT a trailing slash and normalizes to exactly one separator.
 */
export function resolveDatabaseFilePaths(documentDirectory: string): DatabaseFilePaths {
  const directoryUri = documentDirectory.endsWith('/')
    ? documentDirectory.slice(0, -1)
    : documentDirectory;

  return {
    directoryUri,
    mainUri: `${directoryUri}/${DB_FILENAME}`,
    walUri: `${directoryUri}/${DB_FILENAME}-wal`,
    shmUri: `${directoryUri}/${DB_FILENAME}-shm`,
  };
}

/**
 * The only function in this file that imports a native module (`@op-engineering/op-sqlite`, for
 * its `IOS_LIBRARY_PATH`/`ANDROID_DATABASE_PATH` constants — see the header comment for why
 * `expo-file-system` is NOT used here). Reads the SAME native constant the installed op-sqlite
 * module itself resolves at runtime, so this stays correct even if a future change (e.g. adding
 * `OPSQLite_AppGroup`) alters the platform default — re-run the probe and this file's header
 * comment if that ever happens.
 */
export function resolveDatabaseFilePathsDefault(): DatabaseFilePaths {
  // @op-engineering/op-sqlite@15.2.14 types these constants as `any` (its own shipped .d.ts) —
  // narrow through `unknown` instead of trusting that (CLAUDE.md: no `any`, `unknown` + narrowing).
  const rawBasePath: unknown =
    Platform.OS === 'ios' ? OpSqlite.IOS_LIBRARY_PATH : OpSqlite.ANDROID_DATABASE_PATH;

  if (typeof rawBasePath !== 'string' || rawBasePath.length === 0) {
    throw new Error(
      `[dbFilePaths] @op-engineering/op-sqlite did not report a base path for platform "${Platform.OS}" — ` +
        'the native module may not be linked yet (dev-client rebuild pending, see 15-DEV-CLIENT-REBUILD.md).'
    );
  }

  return resolveDatabaseFilePaths(rawBasePath);
}

/**
 * TRUE only when `scripts/spike/opsqlite-db-path-probe.mjs` resolved the real default database
 * directory for BOTH platforms (its own printed `ios: PASS (...)` / `android: PASS (...)`
 * summary lines). FALSE when the probe recorded `COULD-NOT-VERIFY-IN-THIS-SANDBOX` for either.
 * Plan 15-10's wipe machinery consumes this and refuses to report a completed purge while it is
 * false. This is a literal, hand-set boolean — `dbFilePaths.test.ts` asserts it against a live
 * re-run of the probe's own output, so this constant cannot silently drift from what the probe
 * actually found.
 */
export const DB_PATH_VERIFIED: boolean = true;
