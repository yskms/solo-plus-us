/**
 * 基本設計 v0.11 §8.5/§8.8 — Recovery bootstrap, for when the existing DB
 * file can't be decrypted (`DatabaseKeyUnavailableError`). Deliberately
 * independent from the normal `getDatabase()`/Import path — by
 * definition the existing DB can't be opened, so nothing that depends on
 * that (the normal Import flow, `ActivityRepository`, `ActivityService`)
 * is usable here. This is the one place allowed to bypass that and talk
 * to the filesystem/key storage directly, alongside `database/connection.ts`.
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

/** Removes anything a previous, interrupted Recovery attempt might have left behind, before starting a new one. */
function cleanUpAnyPriorAttempt(): void {
  const tempFile = getRecoveryTempFile();
  deleteIfExists(tempFile);
  for (const sibling of getWalSiblings(tempFile)) deleteIfExists(sibling);
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
 * 可能性がある限り、こちらから消さない").
 */
export async function restoreFromBackup(backupFileUri: string): Promise<RestoreFromBackupResult> {
  // Step 1.
  closeDatabaseForRecovery();
  cleanUpAnyPriorAttempt();

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
    deleteIfExists(tempFile);
    for (const sibling of getWalSiblings(tempFile)) deleteIfExists(sibling);
    throw error;
  }

  // Step 5. The old file may not even exist (e.g. it was already moved
  // aside by an interrupted previous attempt) — that's fine, there's
  // simply nothing to preserve from it this time.
  const dbFile = getDbFile();
  const oldAsideFile = getRecoveryOldFile();
  deleteIfExists(oldAsideFile);
  if (dbFile.exists) {
    dbFile.moveSync(oldAsideFile);
  }
  for (const sibling of getWalSiblings(dbFile)) deleteIfExists(sibling);

  // Step 6.
  tempFile.moveSync(dbFile);

  // Step 7.
  const finalDb = await openAndMigrateFreshAt(dbFile.name, newKey);
  const finalCheck = await finalDb.execute('SELECT COUNT(*) as n FROM activities');
  const finalCount = (finalCheck.rows?.[0] as { n?: number } | undefined)?.n ?? -1;
  finalDb.close();
  if (finalCount !== file.activities.length) {
    // The old DB is still intact at `oldAsideFile` and the stored key is
    // still the *old* one (step 8 hasn't run) — this deliberately doesn't
    // attempt an automatic rollback beyond that: getting here means step 4
    // already verified the same data moments earlier, so this would only
    // fire on a genuinely unexpected failure worth surfacing directly
    // rather than silently papering over with more file surgery.
    throw new RecoveryVerificationFailedError(
      `Database verification failed after switching (expected ${file.activities.length} rows, found ${finalCount}).`,
    );
  }

  // Step 8.
  await replaceStoredDatabaseKey(newKey);

  // Step 9.
  deleteIfExists(oldAsideFile);

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
 */
export async function resetAndStartOver(): Promise<void> {
  closeDatabaseForRecovery();
  cleanUpAnyPriorAttempt();

  const dbFile = getDbFile();
  deleteIfExists(dbFile);
  for (const sibling of getWalSiblings(dbFile)) deleteIfExists(sibling);
  deleteIfExists(getRecoveryOldFile());

  try {
    await deleteStoredDatabaseKey();
  } catch (error) {
    // Not fatal — worst case the old (already-unreadable) key stays in
    // SecureStore and gets silently overwritten the next time a key is
    // generated, which is harmless.
    logError('deleteStoredDatabaseKey failed during resetAndStartOver', error);
  }
}
