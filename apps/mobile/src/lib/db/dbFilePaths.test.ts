import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

/**
 * SEC-07/SEC-08 (D-01/D-04, Plan 15-01 Task 3): the resolved SQLCipher database file path the
 * local/remote wipe machinery deletes. `resolveDatabaseFilePaths` is pure (no native import
 * reachable) and runs under plain vitest/node. `resolveDatabaseFilePathsDefault` reads
 * `@op-engineering/op-sqlite`'s own `IOS_LIBRARY_PATH`/`ANDROID_DATABASE_PATH` constants — a
 * native module, mocked below the same way `encryption.test.ts` mocks `expo-secure-store`.
 */

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

const MOCK_IOS_LIBRARY_PATH = '/var/mobile/Containers/Data/Application/FAKE-UUID/Library';

vi.mock('@op-engineering/op-sqlite', () => ({
  IOS_LIBRARY_PATH: '/var/mobile/Containers/Data/Application/FAKE-UUID/Library',
  ANDROID_DATABASE_PATH: '/data/user/0/dev.fds.app/databases/',
}));

import { DB_FILENAME, DB_PATH_VERIFIED, resolveDatabaseFilePaths, resolveDatabaseFilePathsDefault } from './dbFilePaths';

describe('resolveDatabaseFilePaths (pure resolver)', () => {
  it('returns mainUri/walUri/shmUri built from DB_FILENAME', () => {
    const result = resolveDatabaseFilePaths('file:///data/user/0/dev.fds.app/files/');
    expect(result.mainUri.endsWith('frontdoorsales.sqlite')).toBe(true);
    expect(result.walUri.endsWith('frontdoorsales.sqlite-wal')).toBe(true);
    expect(result.shmUri.endsWith('frontdoorsales.sqlite-shm')).toBe(true);
  });

  it('produces byte-identical URIs whether the input has a trailing slash or not', () => {
    const withSlash = resolveDatabaseFilePaths('file:///data/user/0/dev.fds.app/files/');
    const withoutSlash = resolveDatabaseFilePaths('file:///data/user/0/dev.fds.app/files');
    expect(withSlash).toEqual(withoutSlash);
  });

  it('does not double or drop the separator between directory and filename', () => {
    const result = resolveDatabaseFilePaths('/some/dir');
    expect(result.mainUri).toBe('/some/dir/frontdoorsales.sqlite');
    expect(result.directoryUri).toBe('/some/dir');
  });
});

describe('DB_FILENAME (single-SSOT drift guard, autoLockOptions.ts header convention)', () => {
  // Plan 15-10 re-pointed powersync.ts to IMPORT DB_FILENAME from this file
  // instead of declaring its own literal (so wipeMachinery.ts's file-deletion
  // path and powersync.ts's open path can never independently drift) — this
  // test now asserts the import wiring itself, not a second literal to compare.
  it('powersync.ts imports DB_FILENAME from ./dbFilePaths (no local literal)', () => {
    const powersyncSource = readFileSync(
      new URL('./powersync.ts', import.meta.url),
      'utf8'
    );
    expect(powersyncSource).toMatch(/import\s*\{[^}]*\bDB_FILENAME\b[^}]*\}\s*from\s*'\.\/dbFilePaths'/);
    expect(powersyncSource).not.toMatch(/const DB_FILENAME = /);
  });

  it('is the literal "frontdoorsales.sqlite"', () => {
    expect(DB_FILENAME).toBe('frontdoorsales.sqlite');
  });
});

describe('resolveDatabaseFilePathsDefault (native-constant wiring)', () => {
  it('reads IOS_LIBRARY_PATH on iOS (not IOS_DOCUMENT_PATH — see header comment/probe IOS-2)', () => {
    const result = resolveDatabaseFilePathsDefault();
    expect(result.directoryUri).toBe(MOCK_IOS_LIBRARY_PATH);
    expect(result.mainUri).toBe(`${MOCK_IOS_LIBRARY_PATH}/frontdoorsales.sqlite`);
  });
});

describe('DB_PATH_VERIFIED (derived independently from the probe\'s own recorded output, never hand-trusted)', () => {
  it('matches a live re-run of scripts/spike/opsqlite-db-path-probe.mjs', () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
    const probePath = path.join(repoRoot, 'scripts', 'spike', 'opsqlite-db-path-probe.mjs');

    let stdout: string;
    let exitCode = 0;
    try {
      stdout = execFileSync('node', [probePath], { encoding: 'utf8', cwd: repoRoot });
    } catch (err) {
      // The probe exits non-zero only on a FAIL (a config/callsite assumption changed) — still
      // capture stdout so the derived verdict below reflects reality rather than throwing blind.
      const execErr = err as { stdout?: string; status?: number };
      stdout = execErr.stdout ?? '';
      exitCode = execErr.status ?? 1;
    }

    const iosResolved = /^ios: PASS/m.test(stdout);
    const androidResolved = /^android: PASS/m.test(stdout);
    const derivedVerified = iosResolved && androidResolved;

    expect(
      DB_PATH_VERIFIED,
      `DB_PATH_VERIFIED (${DB_PATH_VERIFIED}) must match the probe's own live-derived verdict ` +
        `(ios resolved=${iosResolved}, android resolved=${androidResolved}, probe exit=${exitCode}). ` +
        'If the probe now reports COULD-NOT-VERIFY-IN-THIS-SANDBOX for either platform, update the ' +
        'DB_PATH_VERIFIED literal in dbFilePaths.ts to false and update its header comment — never ' +
        'leave this constant true while the probe disagrees.'
    ).toBe(derivedVerified);
  });
});
