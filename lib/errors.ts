/** Thrown when input fails validation before it would otherwise hit a DB CHECK constraint. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Thrown when a lookup by id finds nothing. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * Thrown when code reaches a state the design docs call "internal
 * inconsistency" (e.g. §9.5.3 create/update job with no matching Activity).
 * This is not a retryable condition — see 基本設計 v0.11 §9.5.3 / §9.5.4.
 */
export class InternalInconsistencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InternalInconsistencyError';
  }
}

/**
 * §8.5 (D-06) — the DB file exists but its encryption key cannot be read
 * from Keychain/Keystore. This is deliberately a *distinct* error from
 * "no key and no DB" (first launch, safe to generate a new key): the
 * caller must route this to the Recovery bootstrap (§8.8, Phase 3), never
 * silently generate and persist a replacement key over whatever is left
 * of the real one.
 */
export class DatabaseKeyUnavailableError extends Error {
  constructor(message = 'The database exists but its encryption key could not be read from this device.') {
    super(message);
    this.name = 'DatabaseKeyUnavailableError';
  }
}

/**
 * §8.5 — the DB file exists and a key *was* read successfully, but
 * SQLCipher still couldn't decrypt the file with it (a stale/wrong key,
 * or file corruption). §8.5's "鍵が読み出せない" (key unreadable) and this
 * are different failure points, but the same practical situation from the
 * person's side — their records won't open — so both route to the same
 * Recovery screen (§8.8).
 *
 * Detected heuristically from the raw error message
 * (`looksLikeDecryptFailure` in `database/connection.ts`) — SQLite's own
 * header-validation failure surfaces as "file is not a database", the
 * same symptom decrypting with the wrong key produces (SQLCipher can't
 * verify the header without the right key). This heuristic is unverified
 * on-device (see README): this app cannot currently build to a device to
 * confirm exactly what op-sqlite/SQLCipher surface for this case.
 */
export class DatabaseCorruptOrWrongKeyError extends Error {
  readonly originalError: unknown;

  constructor(originalError: unknown) {
    super('The database file exists but could not be decrypted with the stored key.');
    this.name = 'DatabaseCorruptOrWrongKeyError';
    this.originalError = originalError;
  }
}

/**
 * §7.1 — the DB's `user_version` is newer than any migration this build of
 * the app knows about (the app was downgraded onto data written by a
 * newer version). The design forbids opening the DB in this state.
 */
export class SchemaTooNewError extends Error {
  constructor(currentVersion: number, maxKnownVersion: number) {
    super(
      `Database schema version ${currentVersion} is newer than the highest version this app build knows about (${maxKnownVersion}). Refusing to open — this usually means the app was downgraded.`,
    );
    this.name = 'SchemaTooNewError';
  }
}

/**
 * §7.2 — a migration failed *and* the attempt to restore the pre-migration
 * backup also failed. Two independent causes are relevant to debugging
 * this (why the migration broke, and separately why the restore couldn't
 * recover from that), so both are kept as plain fields rather than via the
 * ES2022 `Error` `cause` option: that option's support on Hermes-on-device
 * is unverified (this app cannot currently build to a device — see
 * README), and if unsupported it would fail silently, discarding both
 * errors with no indication anything was lost. Plain constructor
 * arguments have no such runtime-support question.
 */
export class MigrationRestoreFailedError extends Error {
  readonly migrationError: unknown;
  readonly restoreError: unknown;

  constructor(migrationError: unknown, restoreError: unknown) {
    super('Migration failed, and restoring the pre-migration backup also failed.');
    this.name = 'MigrationRestoreFailedError';
    this.migrationError = migrationError;
    this.restoreError = restoreError;
  }
}

/**
 * §13.3 — the mandatory safety backup before a destructive replace-import
 * either couldn't be written, or was written but failed the read-back
 * verification (`services/SafetyExportService.ts`). Either way, §13.3's
 * rule is absolute: "キャンセルされた／検証に失敗した場合、置換を開始しない"
 * — the caller must not proceed to the destructive replace.
 */
export class SafetyExportFailedError extends Error {
  readonly originalError: unknown;

  constructor(message: string, originalError?: unknown) {
    super(message);
    this.name = 'SafetyExportFailedError';
    this.originalError = originalError;
  }
}

/**
 * §8.8 Recovery bootstrap — the chosen backup file failed the same
 * validation a normal Import would apply (`services/importValidation`).
 * A distinct type (not a plain `ValidationError`) so `RecoveryScreen` can
 * show the per-field report rather than a single message. `errors` is
 * typed structurally (not imported from `services/importValidation`) to
 * keep `lib/` free of a dependency on `services/` — the shape is small
 * and stable enough not to need the shared type.
 */
export class RecoveryImportInvalidError extends Error {
  readonly validationErrors: { path: string; message: string }[];

  constructor(validationErrors: { path: string; message: string }[]) {
    super(`Backup file failed validation (${validationErrors.length} issue(s)).`);
    this.name = 'RecoveryImportInvalidError';
    this.validationErrors = validationErrors;
  }
}

/**
 * §8.8 step 4/7 — the temporary (or, after switching, the real) database
 * was reopened after import but its row count didn't match the backup
 * file. Whichever step this happens at, nothing about the *original*
 * (still-undecryptable) database has been touched yet — see
 * `RecoveryService` for exactly what's still safe at each point.
 */
export class RecoveryVerificationFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecoveryVerificationFailedError';
  }
}
