/**
 * 基本設計 v0.11 §8.5/§8.8 — Recovery bootstrap, for when the existing DB
 * file can't be decrypted (`DatabaseKeyUnavailableError` /
 * `DatabaseCorruptOrWrongKeyError`). Deliberately independent from the
 * normal `getDatabase()`/Import path — by definition the existing DB
 * can't be opened, so nothing that depends on that (the normal Import
 * flow, `ActivityRepository`, `ActivityService`) is usable here. This is
 * the one place allowed to bypass that and talk to the filesystem/key
 * storage directly, alongside `database/connection.ts`.
 */
import { File } from 'expo-file-system';
import {
  closeDatabaseForRecovery,
  deleteIfExists,
  getDbDirectory,
  getDbFile,
  getWalSiblings,
  openAndMigrateFreshAt,
} from '../database/connection';
import { deleteStoredDatabaseKey, generateNewDatabaseKey, replaceStoredDatabaseKey } from '../database/key';
import { markPrivacyIntroSeen } from '../lib/onboarding';
import { validateExportFile } from './importValidation';
import { performReplaceImport } from './ImportService';
import { RecoveryImportInvalidError, RecoveryVerificationFailedError } from '../lib/errors';
import { logError } from '../lib/log';

const RECOVERY_TEMP_DB_FILE_NAME = 'solo-plus-us.recovery-temp.sqlite';
const RECOVERY_OLD_DB_FILE_NAME = 'solo-plus-us.recovery-old.sqlite';

function getRecoveryTempFile(): File {
  return new File(getDbDirectory(), RECOVERY_TEMP_DB_FILE_NAME);
}

function getRecoveryOldFile(): File {
  return new File(getDbDirectory(), RECOVERY_OLD_DB_FILE_NAME);
}

/**
 * Moves `source` to `destination`, including its `-wal`/`-shm` siblings
 * (if present) — §7.2's reasoning applies here too: in WAL mode, a
 * connection can have committed data sitting in `-wal` that was never
 * checkpointed into the main file, so leaving it behind would silently
 * turn "preserve the old DB" into "preserve an incomplete copy of it".
 *
 * Sibling paths for *both* `source` and `destination` are computed
 * up front, before any move happens — `File#moveSync` updates the calling
 * instance's own `uri` to the new location, so deriving a sibling path
 * from a `File` *after* moving it would silently compute the sibling of
 * where it ended up, not where it started.
 */
function moveDbFileWithWalSiblings(source: File, destination: File): void {
  const sourceSiblings = getWalSiblings(source);
  const destinationSiblings = getWalSiblings(destination);

  if (!source.exists) return;
  source.moveSync(destination);

  for (let i = 0; i < sourceSiblings.length; i++) {
    if (sourceSiblings[i].exists) {
      sourceSiblings[i].moveSync(destinationSiblings[i]);
    }
  }
}

function deleteDbFileWithWalSiblings(file: File): void {
  const siblings = getWalSiblings(file);
  deleteIfExists(file);
  for (const sibling of siblings) deleteIfExists(sibling);
}

/**
 * If a previous `restoreFromBackup` attempt got at least as far as
 * step 5 (moving the genuine old DB aside) but never reached step 9
 * (final cleanup) — whether because step 7's verification failed, the
 * app was killed in between, or this is a second attempt after the first
 * one errored out — `getRecoveryOldFile()` holds the one and only
 * genuine copy of the original, still-undecryptable database. Whatever
 * currently sits at `getDbFile()`'s position is either leftover from
 * that failed attempt (a new DB whose key was never persisted, since
 * step 8 didn't run either) or nothing at all — never the real data.
 *
 * Without this, a *second* `restoreFromBackup` call would reach its own
 * step 5, see `getDbFile()` present (the leftover), and — via
 * `deleteIfExists(oldAsideFile)` — destroy the genuine old DB to make
 * room for that leftover. §8.8's central guarantee ("将来復号できる
 * 可能性がある限り、こちらから消さない") held only within a single
 * successful run without this check; restoring the genuine old DB to its
 * rightful place *first* is what makes it hold across a retry too.
 */
function recoverGenuineOldDbIfNeeded(): void {
  const oldAsideFile = getRecoveryOldFile();
  if (!oldAsideFile.exists) return;

  deleteDbFileWithWalSiblings(getDbFile());
  moveDbFileWithWalSiblings(oldAsideFile, getDbFile());
}

/** Removes anything a previous, interrupted Recovery attempt might have left behind in the *temp* file specifically — see `recoverGenuineOldDbIfNeeded` for the old-DB-aside case, which is handled separately because it must never simply be deleted. */
function cleanUpPriorTempAttempt(): void {
  deleteDbFileWithWalSiblings(getRecoveryTempFile());
}

export interface RestoreFromBackupResult {
  importedCount: number;
}

/**
 * §8.8's 9-step sequence. Reads and validates the backup file *before*
 * touching anything on disk (step numbers below refer to the design doc):
 *
 * 1. Close the unreadable connection.
 * 2. New key + temporary DB, migrated to the current schema.
 * 3. Import all records into the temporary DB.
 * 4. Close it, reopen with the new key, confirm decryption + row count.
 * 5. Move the old (undecryptable) DB aside — not deleted yet.
 * 6. Move the temporary DB into the real DB's position.
 * 7. Reopen the real DB at its real location, confirm it works.
 * 8. Persist the new key as the official key.
 * 9. Only now discard the old DB.
 *
 * Until step 8 commits, the old DB+key are never destroyed — if anything
 * fails before then, the original (still-undecryptable, but *un-deleted*)
 * database is exactly where it was, preserving whatever chance remains of
 * a human eventually recovering it some other way (§8.8: "将来復号できる
 * 可能性がある限り、こちらから消さない"). This holds across retries too —
 * see `recoverGenuineOldDbIfNeeded`, run first, below.
 */
export async function restoreFromBackup(backupFileUri: string): Promise<RestoreFromBackupResult> {
  // Step 1.
  closeDatabaseForRecovery();
  recoverGenuineOldDbIfNeeded();
  cleanUpPriorTempAttempt();

  const raw = await new File(backupFileUri).text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new RecoveryImportInvalidError([{ path: '', message: 'This file is not valid JSON.' }]);
  }
  const validation = validateExportFile(parsed);
  if (!validation.valid) {
    throw new RecoveryImportInvalidError(validation.errors);
  }
  const file = validation.file;

  // Step 2.
  const newKey = await generateNewDatabaseKey();
  const tempFile = getRecoveryTempFile();
  let tempDb = await openAndMigrateFreshAt(RECOVERY_TEMP_DB_FILE_NAME, newKey);

  try {
    // Step 3.
    await performReplaceImport(tempDb, file);
    tempDb.close();

    // Step 4.
    tempDb = await openAndMigrateFreshAt(RECOVERY_TEMP_DB_FILE_NAME, newKey);
    const verifyResult = await tempDb.execute('SELECT COUNT(*) as n FROM activities');
    const verifiedCount = (verifyResult.rows?.[0] as { n?: number } | undefined)?.n ?? -1;
    tempDb.close();
    if (verifiedCount !== file.activities.length) {
      throw new RecoveryVerificationFailedError(
        `Imported row count (${verifiedCount}) does not match the backup file (${file.activities.length}).`,
      );
    }
  } catch (error) {
    // Nothing about the real DB has been touched yet — only the temp
    // file, which is safe to discard and retry from scratch.
    try {
      tempDb.close();
    } catch {
      // Already closed above in the success path; a close-of-closed here
      // is expected on the error path where it wasn't reached yet.
    }
    deleteDbFileWithWalSiblings(tempFile);
    throw error;
  }

  // Step 5. The old file may not even exist (a first-ever launch could
  // theoretically reach `restoreFromBackup` with no prior DB at all) —
  // that's fine, there's simply nothing to preserve from it this time.
  const dbFile = getDbFile();
  const oldAsideFile = getRecoveryOldFile();
  moveDbFileWithWalSiblings(dbFile, oldAsideFile);

  // Step 6.
  tempFile.moveSync(dbFile);

  // Step 7.
  const finalDb = await openAndMigrateFreshAt(dbFile.name, newKey);
  const finalCheck = await finalDb.execute('SELECT COUNT(*) as n FROM activities');
  const finalCount = (finalCheck.rows?.[0] as { n?: number } | undefined)?.n ?? -1;
  if (finalCount !== file.activities.length) {
    finalDb.close();
    // The old DB is still intact at `oldAsideFile` and the stored key is
    // still the *old* one (step 8 hasn't run) — this deliberately doesn't
    // attempt an automatic rollback beyond that: getting here means step 4
    // already verified the same data moments earlier, so this would only
    // fire on a genuinely unexpected failure worth surfacing directly
    // rather than silently papering over with more file surgery. Whatever
    // is left at `dbFile` now is exactly what `recoverGenuineOldDbIfNeeded`
    // discards (not restores from) on the next attempt, since the real
    // data is safe at `oldAsideFile`.
    throw new RecoveryVerificationFailedError(
      `Database verification failed after switching (expected ${file.activities.length} rows, found ${finalCount}).`,
    );
  }

  // Step 8.
  await replaceStoredDatabaseKey(newKey);

  // Step 9.
  deleteDbFileWithWalSiblings(oldAsideFile);

  // Not part of §8.8's numbered sequence, but necessary for the restored
  // app to behave correctly: `onboarding.privacyIntroSeenAt` isn't part
  // of the export (lib/onboarding.ts — device-local routing state, not a
  // product setting), so a freshly-imported DB has no record of it.
  // Someone going through Recovery is, by definition, an existing user
  // restoring their own history, not a first-time installer — sending
  // them back through Privacy Introduction would misrepresent that.
  // Must run before `finalDb.close()` below — the connection is needed.
  await markPrivacyIntroSeen(finalDb);
  finalDb.close();

  return { importedCount: file.activities.length };
}

/**
 * §8.5's other Recovery option: discard the undecryptable DB entirely and
 * start fresh. Deleting the DB file (without touching the key) is enough
 * on its own — `getOrCreateDatabaseKey` only throws
 * `DatabaseKeyUnavailableError` when the DB file exists *and* no key is
 * readable, so once the file is gone, the next `getDatabase()` call takes
 * the "generate a new key" path regardless. The explicit key deletion
 * here is extra care for the (already-empty, by definition of having
 * reached this error state) SecureStore entry, not something the file
 * deletion alone depends on.
 *
 * Unlike `restoreFromBackup`, this doesn't call `recoverGenuineOldDbIfNeeded`
 * first — choosing "delete and start over" is an explicit, fully-
 * destructive choice, so any `recovery-old` leftover from a previous
 * interrupted restore attempt is exactly the kind of thing this is meant
 * to discard, not preserve.
 */
export async function resetAndStartOver(): Promise<void> {
  closeDatabaseForRecovery();
  cleanUpPriorTempAttempt();

  deleteDbFileWithWalSiblings(getDbFile());
  deleteDbFileWithWalSiblings(getRecoveryOldFile());

  try {
    await deleteStoredDatabaseKey();
  } catch (error) {
    // Not fatal — worst case the old (already-unreadable) key stays in
    // SecureStore and gets silently overwritten the next time a key is
    // generated, which is harmless.
    logError('deleteStoredDatabaseKey failed during resetAndStartOver', error);
  }
}
