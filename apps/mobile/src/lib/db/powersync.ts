import { OPSqliteOpenFactory } from '@powersync/op-sqlite';
import { PowerSyncDatabase } from '@powersync/react-native';
import { DB_FILENAME } from './dbFilePaths';
import { getOrCreateEncryptionKey } from './encryption';
import { AppSchema } from './schema';

/**
 * PowerSync database construction (SYNC-01/SYNC-03).
 *
 * Iron Rule 1: the app reads/writes ONLY this local database. PowerSync is
 * the only network data path (connected via the backend connector in
 * connector.ts); attachments go through the separate queue.
 *
 * SQLCipher: `@powersync/op-sqlite` enables encryption when the key is
 * passed via `sqliteOptions.encryptionKey` (verified against the installed
 * 0.9.15 typings — `OPSQLiteOpenFactoryOptions.sqliteOptions.encryptionKey`,
 * NOT a top-level `encryptionKey` as 01-RESEARCH.md Pattern 2 assumed) and
 * apps/mobile/package.json sets `"op-sqlite": { "sqlcipher": true }`.
 *
 * `DB_FILENAME` is imported from `dbFilePaths.ts` (plan 15-01) rather than
 * declared here — that file is the SSOT for the filename so `wipeMachinery.ts`
 * (plan 15-10) can resolve the exact same `.sqlite`/`-wal`/`-shm` paths this
 * module opens, with no second, independently-drifting literal.
 */

let database: PowerSyncDatabase | null = null;

/**
 * Opens (or returns the already-open) SQLCipher-encrypted PowerSync database.
 * The encryption key is retrieved from the OS keychain/keystore BEFORE the
 * database is opened — never hardcoded, never synced.
 */
export async function openDatabase(): Promise<PowerSyncDatabase> {
  if (database) {
    return database;
  }

  const encryptionKey = await getOrCreateEncryptionKey();

  const factory = new OPSqliteOpenFactory({
    dbFilename: DB_FILENAME,
    sqliteOptions: {
      encryptionKey,
    },
  });

  database = new PowerSyncDatabase({
    schema: AppSchema,
    database: factory,
  });

  await database.init();
  return database;
}

/**
 * Closes the database (used by tests/teardown flows; the app normally keeps
 * it open for its whole lifecycle).
 */
export async function closeDatabase(): Promise<void> {
  if (database) {
    await database.close();
    database = null;
  }
}
