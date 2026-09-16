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

// The plaintext SQLite header is the 16-byte ASCII string "SQLite format 3"
// followed by a single 0x00 byte. A SQLCipher-encrypted file has random
// bytes here instead — every byte of the file is encrypted, including what
// would otherwise be this magic string. Split into a 15-char ASCII prefix
// plus a separate numeric check for the trailing 0x00, so this source file
// never has to embed a literal NUL byte in a string literal.
const SQLITE_PLAINTEXT_MAGIC_PREFIX = 'SQLite format 3';
const SQLITE_PLAINTEXT_MAGIC_LENGTH = SQLITE_PLAINTEXT_MAGIC_PREFIX.length + 1;

const MIGRATIONS: readonly Migration[] = [migration001Initial];

/**
 * The DB lives in its own subdirectory of Documents (not the app's default
 * SQLite location) so `database/connection.ts` — not op-sqlite's default —
 * is the one place that knows the exact file path. That path is what the
 * §7.2 migration backup and the (not yet implemented, see README) iOS
 * backup-exclusion step both need.
 *
 * Known gap (README): Documents is included in iCloud/iTunes backup by
 * default on iOS. Until the backup-exclusion native module exists, do not
 * distribute this app (even via TestFlight) to anyone whose backups you
 * don't control.
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

/** The `-wal` / `-shm` siblings SQLite creates next to a WAL-mode database file. */
function getWalSiblings(dbFile: File): File[] {
  return [new File(`${dbFile.uri}-wal`), new File(`${dbFile.uri}-shm`)];
}

function deleteIfExists(file: File): void {
  if (file.exists) {
    file.delete();
  }
}

async function readUserVersion(db: DB): Promise<number> {
  const result = await db.execute('PRAGMA user_version');
  const row = result.rows?.[0] as { user_version?: number } | undefined;
  return row?.user_version ?? 0;
}

function openConnection(encryptionKey: string): DB {
  return open({
    name: DB_FILE_NAME,
    location: getDbDirectory().uri.replace(/^file:\/\//, ''),
    encryptionKey,
  });
}

async function applyPragmas(db: DB): Promise<void> {
  // §6: per-connection, not persisted — must be set on every open.
  await db.execute('PRAGMA foreign_keys = ON');
  // §6: persistent once set, but confirmed on every open regardless.
  await db.execute('PRAGMA journal_mode = WAL');
}

/**
 * §7.2: a plain file copy is not safe while `journal_mode=WAL` is active —
 * committed data can still be sitting in the `-wal` file. `VACUUM INTO`
 * asks SQLite itself to write a consistent, fully-checkpointed snapshot,
 * which sidesteps that problem entirely.
 *
 * §8 (D-05): this database is only ever meant to exist encrypted. If
 * SQLCipher's `VACUUM INTO` were ever to emit a plaintext file (unverified
 * on-device, README "Known gaps"), a full plaintext copy of every Activity
 * would sit on disk. This checks the output's header before trusting it as
 * a real backup, and fails loudly instead.
 */
async function createMigrationBackup(db: DB): Promise<void> {
  const backup = getBackupFile();
  deleteIfExists(backup);

  await db.execute(`VACUUM INTO ?`, [backup.uri.replace(/^file:\/\//, '')]);

  const handle = backup.open();
  let header: Uint8Array;
  try {
    header = handle.readBytes(SQLITE_PLAINTEXT_MAGIC_LENGTH);
  } finally {
    handle.close();
  }
  const prefixText = String.fromCharCode(...header.subarray(0, SQLITE_PLAINTEXT_MAGIC_PREFIX.length));
  const looksPlaintext = prefixText === SQLITE_PLAINTEXT_MAGIC_PREFIX && header[SQLITE_PLAINTEXT_MAGIC_PREFIX.length] === 0;
  if (looksPlaintext) {
    backup.delete(); // never leave a plaintext copy on disk, even for a moment longer than this
    throw new Error(
      'Migration backup (VACUUM INTO) produced a plaintext SQLite file instead of an encrypted one. Refusing to proceed with migration.',
    );
  }
}

function deleteMigrationBackupIfPresent(): void {
  deleteIfExists(getBackupFile());
}

/**
 * §7.2 restore. The caller must have already closed `db` — deleting the
 * live database file out from under an open connection (and its `-wal`/
 * `-shm` siblings) is exactly the kind of unsafe file surgery §7.2 warns
 * against for the *backup* step; the restore step deserves the same care.
 */
function restoreMigrationBackup(): void {
  const backup = getBackupFile();
  if (!backup.exists) {
    return;
  }
  const dbFile = getDbFile();
  deleteIfExists(dbFile);
  for (const sibling of getWalSiblings(dbFile)) {
    deleteIfExists(sibling);
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

  let db = openConnection(encryptionKey);
  await applyPragmas(db);

  let restoredFromBackup = false;
  try {
    await runMigrations(db, MIGRATIONS, {
      getUserVersion: () => readUserVersion(db),
      backup: {
        createBackup: () => createMigrationBackup(db),
        deleteBackup: async () => deleteMigrationBackupIfPresent(),
        restoreBackup: async () => {
          db.close(); // must happen before touching the file (see restoreMigrationBackup doc comment)
          restoreMigrationBackup();
          restoredFromBackup = true;
        },
      },
    });
  } catch (error) {
    if (!restoredFromBackup) {
      // No existing data to fall back to (fresh install, or the failure
      // happened before backup/restore ran at all) — nothing safe to
      // continue with. §7.1's "downgrade → don't open" and any other
      // migration failure both surface here unchanged.
      throw error;
    }
    // §7.2: "失敗時は復元して起動を継続する" — the file is back to its
    // pre-migration state, but `db` above was closed as part of that
    // restore and is no longer valid. Open a fresh connection against the
    // restored file and hand that back, without retrying the migration
    // that just failed (retrying here would fail identically and loop).
    db = openConnection(encryptionKey);
    await applyPragmas(db);
  }

  return db;
}

/**
 * Returns the singleton database connection, opening and migrating it on
 * first call. Concurrent callers during startup share one in-flight open.
 *
 * §8.5 (D-06): whether the DB file already exists is checked *before*
 * touching the key — see `key.ts`'s `getOrCreateDatabaseKey` doc comment
 * for why a missing key must be treated differently in each case.
 */
export async function getDatabase(): Promise<DB> {
  if (dbSingleton) {
    return dbSingleton;
  }
  if (!openPromise) {
    openPromise = (async () => {
      try {
        const key = await getOrCreateDatabaseKey(getDbFile().exists);
        const db = await openAndMigrate(key);
        dbSingleton = db;
        return db;
      } catch (error) {
        // Don't poison future attempts: a transient failure (or a
        // Recovery flow that fixes things and wants to retry) must be
        // able to call getDatabase() again and actually retry, not
        // replay a stale rejected promise forever.
        openPromise = null;
        throw error;
      }
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
