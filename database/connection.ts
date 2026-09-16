/**
 * 基本設計 v0.11 §6/§7 — opens the encrypted database and applies
 * connection-level PRAGMAs before anything else runs.
 *
 * Two rules from the design docs land here specifically:
 *  - §6.1 "鍵を SQL 文字列へ埋め込まない": the key is passed through
 *    op-sqlite's `encryptionKey` option, never concatenated into SQL.
 *  - §6: `PRAGMA foreign_keys = ON` is a *per-connection* setting (SQLite's
 *    default is off) — forgetting it silently disables `ON DELETE
 *    RESTRICT` on `health_sync`, so it's applied unconditionally on every
 *    open, before any query runs.
 */
import { open, type DB } from '@op-engineering/op-sqlite';
import { Directory, File, Paths } from 'expo-file-system';
import { generateNewDatabaseKey, getOrCreateDatabaseKey } from './key';
import { migration001Initial } from './migrations/001_initial';
import { runMigrations, type Migration } from './migrations';

const DB_FILE_NAME = 'solo-plus-us.sqlite';
const DB_DIR_NAME = 'solo-plus-us-db';
const BACKUP_FILE_NAME = 'solo-plus-us.migration-backup.sqlite';

const MIGRATIONS: readonly Migration[] = [migration001Initial];

/**
 * The DB lives in its own subdirectory of Documents (not the app's default
 * SQLite location) so `database/connection.ts` — not op-sqlite's default —
 * is the one place that knows the exact file path. That path is what the
 * §7.2 migration backup and the (not yet implemented, see README) iOS
 * backup-exclusion step both need.
 */
function getDbDirectory(): Directory {
  return new Directory(Paths.document, DB_DIR_NAME);
}

function getDbFile(): File {
  return new File(getDbDirectory(), DB_FILE_NAME);
}

function getBackupFile(): File {
  return new File(getDbDirectory(), BACKUP_FILE_NAME);
}

async function readUserVersion(db: DB): Promise<number> {
  const result = await db.execute('PRAGMA user_version');
  const row = result.rows?.[0] as { user_version?: number } | undefined;
  return row?.user_version ?? 0;
}

/**
 * §7.2: a plain file copy is not safe while `journal_mode=WAL` is active —
 * committed data can still be sitting in the `-wal` file. `VACUUM INTO`
 * asks SQLite itself to write a consistent, fully-checkpointed snapshot,
 * which sidesteps that problem entirely.
 */
async function createMigrationBackup(db: DB): Promise<void> {
  const backup = getBackupFile();
  if (backup.exists) {
    backup.delete();
  }
  await db.execute(`VACUUM INTO ?`, [backup.uri.replace(/^file:\/\//, '')]);
}

function deleteMigrationBackupIfPresent(): void {
  const backup = getBackupFile();
  if (backup.exists) {
    backup.delete();
  }
}

function restoreMigrationBackup(): void {
  const backup = getBackupFile();
  const dbFile = getDbFile();
  if (!backup.exists) {
    return;
  }
  if (dbFile.exists) {
    dbFile.delete();
  }
  backup.copy(dbFile);
  backup.delete();
}

let dbSingleton: DB | null = null;
let openPromise: Promise<DB> | null = null;

async function openAndMigrate(encryptionKey: string): Promise<DB> {
  const dir = getDbDirectory();
  if (!dir.exists) {
    dir.create({ intermediates: true });
  }

  const db = open({
    name: DB_FILE_NAME,
    location: getDbDirectory().uri.replace(/^file:\/\//, ''),
    encryptionKey,
  });

  // §6: per-connection, not persisted — must be set on every open.
  await db.execute('PRAGMA foreign_keys = ON');
  // §6: persistent once set, but confirmed on every open regardless.
  await db.execute('PRAGMA journal_mode = WAL');

  await runMigrations(db, MIGRATIONS, {
    getUserVersion: () => readUserVersion(db),
    backup: {
      createBackup: () => createMigrationBackup(db),
      deleteBackup: async () => deleteMigrationBackupIfPresent(),
      restoreBackup: async () => restoreMigrationBackup(),
    },
  });

  return db;
}

/**
 * Returns the singleton database connection, opening and migrating it on
 * first call. Concurrent callers during startup share one in-flight open.
 */
export async function getDatabase(): Promise<DB> {
  if (dbSingleton) {
    return dbSingleton;
  }
  if (!openPromise) {
    openPromise = (async () => {
      const key = await getOrCreateDatabaseKey();
      const db = await openAndMigrate(key);
      dbSingleton = db;
      return db;
    })();
  }
  return openPromise;
}

/**
 * §8.5/D-06 Recovery bootstrap, step 1: close the unreadable connection.
 * Does not delete anything — see `database/recovery.ts` (Phase 3) for the
 * full bootstrap sequence.
 */
export function closeDatabaseForRecovery(): void {
  if (dbSingleton) {
    dbSingleton.close();
  }
  dbSingleton = null;
  openPromise = null;
}

export function getDbFilePathForDiagnostics(): string {
  return getDbFile().uri;
}

/** Only for tests that need to force a fresh singleton between cases. */
export function __resetConnectionForTests(): void {
  dbSingleton = null;
  openPromise = null;
}

export { generateNewDatabaseKey };
