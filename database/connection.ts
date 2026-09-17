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
const RESTORE_TEMP_FILE_NAME = 'solo-plus-us.sqlite.restoring';

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
/** Exported for `services/RecoveryService.ts` (§8.8) — the only other place allowed to know where the DB lives on disk. */
export function getDbDirectory(): Directory {
  return new Directory(Paths.document, DB_DIR_NAME);
}

export function getDbFile(): File {
  return new File(getDbDirectory(), DB_FILE_NAME);
}

function getBackupFile(): File {
  return new File(getDbDirectory(), BACKUP_FILE_NAME);
}

function getRestoreTempFile(): File {
  return new File(getDbDirectory(), RESTORE_TEMP_FILE_NAME);
}

/** The `-wal` / `-shm` siblings SQLite creates next to a WAL-mode database file. Exported for `services/RecoveryService.ts`. */
export function getWalSiblings(dbFile: File): File[] {
  return [new File(`${dbFile.uri}-wal`), new File(`${dbFile.uri}-shm`)];
}

/** Exported for `services/RecoveryService.ts`. */
export function deleteIfExists(file: File): void {
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
 *
 * Copies into a temp file *before* touching `dbFile`, then does a
 * filesystem move (rename) rather than a second copy into place. The
 * highest-risk step — copying a whole file, which could fail partway
 * through — happens entirely before `dbFile` is deleted, so a failure
 * there leaves `backup` and the (already-broken) `dbFile` exactly as they
 * were: nothing new to lose. Without this, deleting `dbFile` first and
 * then copying `backup` on top of it (the original implementation) had a
 * window where a failed copy left *neither* file in place — the next
 * launch would see no `dbFile`, treat that as a fresh install, and create
 * a brand-new empty database while the real data sat untouched in
 * `backup`, looking to the user like every record had been deleted. See
 * `recoverInterruptedRestoreIfNeeded` for the complementary startup check
 * that catches this even if a future change reintroduces a similar gap.
 */
function restoreMigrationBackup(): void {
  const backup = getBackupFile();
  if (!backup.exists) {
    return;
  }

  const temp = getRestoreTempFile();
  deleteIfExists(temp);
  // `copySync`, not `copy` — this function is synchronous end-to-end on
  // purpose (see call sites), and `copy()` returns a `Promise<void>` that,
  // left un-awaited here, would let every line below run before the copy
  // actually finished: `dbFile` gets deleted and `backup` gets deleted out
  // from under a copy that's still in flight, which is real data loss (not
  // just the appearance of it) rather than the failure mode this function
  // exists to prevent. `tsc` does not flag an un-awaited Promise, so this
  // was previously silent.
  backup.copySync(temp);

  const dbFile = getDbFile();
  deleteIfExists(dbFile);
  for (const sibling of getWalSiblings(dbFile)) {
    deleteIfExists(sibling);
  }

  temp.moveSync(dbFile);
  backup.delete();
}

/**
 * Startup self-healing for an interrupted restore. If the app was killed
 * (or crashed) mid-`restoreMigrationBackup` — after `backup` was fully
 * copied into `dbFile` but before `backup.delete()` ran, or, before the
 * fix above existed, after `dbFile` was deleted but before the copy back
 * finished — this finishes the job *before* anything else runs. Without
 * it, `getDbFile().exists === false` (with data still sitting in
 * `backup`) would be indistinguishable from a genuine first launch: a
 * brand-new empty database would be created with the existing key, and
 * every record would appear to have vanished.
 *
 * Must run before `getOrCreateDatabaseKey` is asked whether the DB file
 * exists — that's the exact question this resolves first.
 */
function recoverInterruptedRestoreIfNeeded(): void {
  const dbFile = getDbFile();
  const backup = getBackupFile();

  if (!dbFile.exists && backup.exists) {
    restoreMigrationBackup();
    return;
  }
  if (dbFile.exists && backup.exists) {
    // Two different histories land here, not one: either the restore
    // itself finished (dbFile is back) and only the final cleanup step
    // didn't run, *or* the app was killed while migrations were still
    // being applied — before anything failed, so `restoreMigrationBackup`
    // never ran at all — leaving the original backup untouched next to a
    // dbFile that's partway through the pending migrations. Both are safe
    // to resolve the same way: each migration commits its DDL and its
    // `user_version` bump in one transaction (see migrations/index.ts), so
    // dbFile is never left structurally inconsistent, only possibly behind
    // the latest known version. Deleting the stale backup here is safe in
    // both cases — the next `runMigrations` call reads whatever
    // `user_version` dbFile actually has and, if there's still existing
    // data and pending migrations, creates a fresh backup before touching
    // it again. This reasoning assumes every migration step lives inside
    // that per-migration transaction; a future migration with a
    // transaction-outside step would need this rechecked.
    backup.delete();
  }
  if (dbFile.exists) {
    // A `.restoring` temp file only ever matters mid-`restoreMigrationBackup`;
    // once `dbFile` exists again, any leftover is stale.
    deleteIfExists(getRestoreTempFile());
  }
}

let dbSingleton: DB | null = null;
let openPromise: Promise<DB> | null = null;

/**
 * §7.2's exact wording is "復元して**起動を継続してエラーを表示する**" — restore,
 * keep running, *and show an error*. `openAndMigrate` still has to return a
 * working `DB` in this case (that's the "keep running" part — v1 is the
 * only migration today, so this never fires, but v2+ would otherwise
 * silently run the app against an old schema its own queries don't
 * expect). This flag is how it also satisfies "show an error" without
 * throwing away the connection: the caller (`DatabaseContext`) checks it
 * after a successful `getDatabase()` and surfaces a notice.
 */
let restoredFromBackupOnLastOpen = false;

export function wasRestoredFromFailedMigration(): boolean {
  return restoredFromBackupOnLastOpen;
}

/**
 * Undecided design gap — resolve before the first v2 migration ships.
 *
 * `wasRestoredFromFailedMigration()` and `MigrationRestoredBanner` satisfy
 * §7.2's "show an error" today, but the app otherwise keeps running
 * completely normally after a restore: the code is written against the
 * *current* (v2+) schema/types, while the restored file is still on the
 * *old* (v1) schema. A v2 migration that adds a column, and Repository
 * code that unconditionally references that column in every write, would
 * make every record/edit fail with a generic error on every attempt — not
 * a one-time notice, an ongoing broken state the banner alone doesn't
 * convey ("your records are safe" is true; "but you can no longer add to
 * them" isn't said anywhere).
 *
 * This needs an explicit decision, in the design docs, before v2 exists —
 * not something to improvise here once a real migration is on the line.
 * Candidate direction: when `wasRestoredFromFailedMigration()` is true,
 * put the app in a read-only mode (Repository writes rejected up front
 * with a clear reason, Export still allowed) until an app update ships a
 * fixed migration — rather than letting every write path discover the
 * schema mismatch independently, one confusing failure at a time.
 *
 * Related, same-decision-point item: the `MigrationRestoreFailedError`
 * screen in `DatabaseContext` (migration *and* the fallback restore both
 * failed) currently just states that fact. In practice a relaunch often
 * recovers on its own — `recoverInterruptedRestoreIfNeeded` finishes an
 * interrupted restore on the next `getDatabase()` call — so that screen
 * could tell the user to try restarting the app. Worth adding alongside
 * the read-only-mode work above rather than as its own one-off change.
 */

async function openAndMigrate(encryptionKey: string): Promise<DB> {
  const dir = getDbDirectory();
  if (!dir.exists) {
    dir.create({ intermediates: true });
  }

  restoredFromBackupOnLastOpen = false;
  let db = openConnection(encryptionKey);
  let dbClosed = false;
  let restoredFromBackup = false;

  // Closing an already-closed (or already-broken) connection can itself
  // throw on some SQLite bindings. Without tracking `dbClosed`, that
  // second close — reached when `restoreBackup` below closes `db` and
  // then `restoreMigrationBackup()` itself throws — would replace the
  // *real* error (why the restore failed) with a confusing "close of a
  // closed handle" one. `dbClosed` makes this a true no-op the second
  // time, and any close-time exception is swallowed rather than allowed
  // to mask whatever error is already being thrown.
  const closeOnce = () => {
    if (dbClosed) return;
    dbClosed = true;
    try {
      db.close();
    } catch {
      // See comment above — never let this override the real error.
    }
  };

  try {
    // Deliberately inside the try: a wrong/corrupt key typically doesn't
    // fail at open() itself (SQLCipher validates lazily, on first real
    // read), so a decrypt failure surfaces here, not before this block.
    await applyPragmas(db);
    await runMigrations(db, MIGRATIONS, {
      getUserVersion: () => readUserVersion(db),
      backup: {
        createBackup: () => createMigrationBackup(db),
        deleteBackup: async () => deleteMigrationBackupIfPresent(),
        restoreBackup: async () => {
          closeOnce(); // must happen before touching the file (see restoreMigrationBackup doc comment)
          restoreMigrationBackup();
          restoredFromBackup = true;
        },
      },
    });
  } catch (error) {
    if (!restoredFromBackup) {
      // No existing data to fall back to (fresh install, downgrade
      // detected, decrypt failure, or the failure happened before
      // backup/restore ran at all) — nothing safe to continue with.
      // Close the handle so a caller that retries `getDatabase()` doesn't
      // leak one connection per attempt. A no-op if `restoreBackup`
      // above already closed it before failing.
      closeOnce();
      throw error;
    }
    // §7.2: reopen against the restored (pre-migration) file so the app
    // stays usable, but record that this happened — see
    // `wasRestoredFromFailedMigration` above. Does not retry the
    // migration that just failed (retrying here would fail identically
    // and loop). If *this* reopen itself fails, close whatever got
    // opened before propagating — otherwise a broken reopen leaks a
    // connection the same way the original bug did.
    try {
      db = openConnection(encryptionKey);
      dbClosed = false;
      await applyPragmas(db);
    } catch (reopenError) {
      closeOnce();
      throw reopenError;
    }
    restoredFromBackupOnLastOpen = true;
  }

  return db;
}

/**
 * Opens, applies pragmas, and brings a *fresh* database (at `fileName`, in
 * the same directory as the main DB) up to the current schema version.
 * Only for `services/RecoveryService.ts`'s temporary database (§8.8) — a
 * brand-new file always starts at `user_version = 0`, so unlike
 * `openAndMigrate`, there's no existing-data backup/restore path to wire
 * up, and no shared `dbSingleton` (the caller owns this connection's
 * lifecycle directly, since Recovery may open several of these in
 * sequence while the *real* connection stays closed throughout).
 */
export async function openAndMigrateFreshAt(fileName: string, encryptionKey: string): Promise<DB> {
  const dir = getDbDirectory();
  if (!dir.exists) {
    dir.create({ intermediates: true });
  }
  const db = open({ name: fileName, location: dir.uri.replace(/^file:\/\//, ''), encryptionKey });
  await applyPragmas(db);
  await runMigrations(db, MIGRATIONS, { getUserVersion: () => readUserVersion(db) });
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
        // Must run before anything asks whether the DB file exists — an
        // interrupted restore is exactly a case where that question's
        // obvious-looking answer ("no") would be wrong. See doc comment.
        recoverInterruptedRestoreIfNeeded();
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
