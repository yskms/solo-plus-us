/**
 * 基本設計 v0.11 §7 — Migration runner.
 *
 * Rules encoded here:
 *  - `user_version` is advanced by the runner after each migration
 *    succeeds, never baked into a migration's own SQL (§6.3) — each
 *    migration's DDL/DML and its version bump commit together in one
 *    transaction, so a partially-applied migration can never be recorded
 *    as done.
 *  - Forward-only. A migration whose version is <= the current
 *    `user_version` is never re-run; there is no down-migration (§7.1).
 *  - If `user_version` is *higher* than any migration this build knows
 *    about, the app was downgraded onto data written by a newer version.
 *    §7.1 requires refusing to open rather than guessing — this throws
 *    `SchemaTooNewError` before touching the DB any further.
 *  - Before running any migration against a database that already holds
 *    data (`user_version > 0`), the caller-supplied `backup` hooks are
 *    used to snapshot first. §7.2 explicitly forbids a plain file copy
 *    while `journal_mode=WAL` is active (data can be sitting in the `-wal`
 *    file); how to take a *consistent* snapshot is a filesystem/SQLite
 *    concern, so it's injected rather than implemented here — see
 *    `database/connection.ts`.
 */
import { SchemaTooNewError } from '../../lib/errors';

export interface MigrationExecutor {
  execute: (query: string, params?: (string | number | boolean | null)[]) => Promise<unknown>;
}

export interface Migration {
  version: number;
  description: string;
  up: (tx: MigrationExecutor) => Promise<void>;
}

export interface MigrationTransactor {
  /** Must run `fn` inside a single DB transaction and roll back on throw. */
  transaction: (fn: (tx: MigrationExecutor) => Promise<void>) => Promise<void>;
}

export interface BackupHooks {
  createBackup: () => Promise<void>;
  deleteBackup: () => Promise<void>;
  restoreBackup: () => Promise<void>;
}

export interface RunMigrationsOptions {
  getUserVersion: () => Promise<number>;
  backup?: BackupHooks;
}

/**
 * Runs every migration whose version is greater than the current
 * `user_version`, in ascending order. Returns the list of versions that
 * were actually applied (empty if already up to date).
 */
export async function runMigrations(
  db: MigrationTransactor,
  migrations: readonly Migration[],
  options: RunMigrationsOptions,
): Promise<number[]> {
  const currentVersion = await options.getUserVersion();

  const maxKnownVersion = migrations.reduce((max, m) => Math.max(max, m.version), 0);
  if (currentVersion > maxKnownVersion) {
    throw new SchemaTooNewError(currentVersion, maxKnownVersion);
  }

  const pending = migrations
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version);

  if (pending.length === 0) {
    return [];
  }

  const hadExistingData = currentVersion > 0;
  if (hadExistingData && options.backup) {
    await options.backup.createBackup();
  }

  try {
    const applied: number[] = [];
    for (const migration of pending) {
      await db.transaction(async (tx) => {
        await migration.up(tx);
        // PRAGMA doesn't take bound parameters; `version` is our own
        // integer, never user input, so string interpolation is safe here.
        await tx.execute(`PRAGMA user_version = ${migration.version}`);
      });
      applied.push(migration.version);
    }

    if (hadExistingData && options.backup) {
      await options.backup.deleteBackup();
    }
    return applied;
  } catch (error) {
    if (hadExistingData && options.backup) {
      // §7.2: restore, then let the app keep running on the pre-migration
      // schema. Migration failure is not fatal to opening the app.
      await options.backup.restoreBackup();
    }
    throw error;
  }
}
