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
