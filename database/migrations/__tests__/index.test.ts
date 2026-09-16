import { runMigrations, type Migration, type MigrationExecutor, type MigrationTransactor } from '../index';
import { SchemaTooNewError } from '../../../lib/errors';

/**
 * A fake DB that behaves like op-sqlite closely enough to test the
 * runner's sequencing, transaction-per-migration, and backup/restore
 * decisions — without touching any native module.
 */
function makeFakeDb(initialUserVersion: number) {
  const executedStatements: string[] = [];
  let userVersion = initialUserVersion;
  let failOnStatementIncluding: string | null = null;

  const executor: MigrationExecutor = {
    execute: async (query: string) => {
      if (failOnStatementIncluding && query.includes(failOnStatementIncluding)) {
        throw new Error(`simulated failure on: ${query}`);
      }
      executedStatements.push(query);
      const m = /PRAGMA user_version = (\d+)/.exec(query);
      if (m) {
        userVersion = Number(m[1]);
      }
      return {};
    },
  };

  const db: MigrationTransactor = {
    transaction: async (fn) => {
      // Simplified: no real rollback of `executedStatements`/`userVersion` on
      // throw, since our fake never partially commits — good enough to
      // assert atomicity of "migration DDL + version bump happen together".
      await fn(executor);
    },
  };

  return {
    db,
    getUserVersion: async () => userVersion,
    getUserVersionSync: () => userVersion,
    executedStatements,
    setFailOnStatementIncluding: (s: string | null) => {
      failOnStatementIncluding = s;
    },
  };
}

function migration(version: number, statement: string): Migration {
  return {
    version,
    description: `migration ${version}`,
    up: async (tx: MigrationExecutor) => {
      await tx.execute(statement);
    },
  };
}

describe('runMigrations', () => {
  it('applies all migrations from a fresh database (user_version 0)', async () => {
    const fake = makeFakeDb(0);
    const applied = await runMigrations(fake.db, [migration(1, 'CREATE TABLE a (id TEXT)')], {
      getUserVersion: fake.getUserVersion,
    });

    expect(applied).toEqual([1]);
    expect(fake.getUserVersionSync()).toBe(1);
    expect(fake.executedStatements).toContain('CREATE TABLE a (id TEXT)');
  });

  it('is a no-op when already at the latest version', async () => {
    const fake = makeFakeDb(1);
    const applied = await runMigrations(fake.db, [migration(1, 'CREATE TABLE a (id TEXT)')], {
      getUserVersion: fake.getUserVersion,
    });

    expect(applied).toEqual([]);
    expect(fake.executedStatements).toHaveLength(0);
  });

  it('applies only migrations newer than the current version, in ascending order', async () => {
    const fake = makeFakeDb(1);
    const applied = await runMigrations(
      fake.db,
      [
        migration(1, 'CREATE TABLE a (id TEXT)'),
        migration(3, 'CREATE TABLE c (id TEXT)'),
        migration(2, 'CREATE TABLE b (id TEXT)'),
      ],
      { getUserVersion: fake.getUserVersion },
    );

    expect(applied).toEqual([2, 3]);
    expect(fake.executedStatements).toEqual([
      'CREATE TABLE b (id TEXT)',
      'PRAGMA user_version = 2',
      'CREATE TABLE c (id TEXT)',
      'PRAGMA user_version = 3',
    ]);
    expect(fake.getUserVersionSync()).toBe(3);
  });

  it('does not create a backup for a fresh database (nothing to protect)', async () => {
    const fake = makeFakeDb(0);
    const createBackup = jest.fn(async () => {});
    const deleteBackup = jest.fn(async () => {});
    const restoreBackup = jest.fn(async () => {});

    await runMigrations(fake.db, [migration(1, 'CREATE TABLE a (id TEXT)')], {
      getUserVersion: fake.getUserVersion,
      backup: { createBackup, deleteBackup, restoreBackup },
    });

    expect(createBackup).not.toHaveBeenCalled();
    expect(deleteBackup).not.toHaveBeenCalled();
    expect(restoreBackup).not.toHaveBeenCalled();
  });

  it('backs up before migrating an existing database, and deletes the backup on success', async () => {
    const fake = makeFakeDb(1);
    const createBackup = jest.fn(async () => {});
    const deleteBackup = jest.fn(async () => {});
    const restoreBackup = jest.fn(async () => {});

    await runMigrations(fake.db, [migration(1, 'CREATE TABLE a (id TEXT)'), migration(2, 'ALTER TABLE a ADD COLUMN b TEXT')], {
      getUserVersion: fake.getUserVersion,
      backup: { createBackup, deleteBackup, restoreBackup },
    });

    expect(createBackup).toHaveBeenCalledTimes(1);
    expect(deleteBackup).toHaveBeenCalledTimes(1);
    expect(restoreBackup).not.toHaveBeenCalled();
  });

  it('restores the backup and rethrows when a migration fails, without deleting the backup', async () => {
    const fake = makeFakeDb(1);
    fake.setFailOnStatementIncluding('ALTER TABLE a');
    const createBackup = jest.fn(async () => {});
    const deleteBackup = jest.fn(async () => {});
    const restoreBackup = jest.fn(async () => {});

    await expect(
      runMigrations(fake.db, [migration(2, 'ALTER TABLE a ADD COLUMN b TEXT')], {
        getUserVersion: fake.getUserVersion,
        backup: { createBackup, deleteBackup, restoreBackup },
      }),
    ).rejects.toThrow('simulated failure');

    expect(createBackup).toHaveBeenCalledTimes(1);
    expect(restoreBackup).toHaveBeenCalledTimes(1);
    expect(deleteBackup).not.toHaveBeenCalled();
  });
});

describe('runMigrations — §7.1 downgrade detection', () => {
  it('refuses to open when user_version is newer than any known migration', async () => {
    const fake = makeFakeDb(5); // e.g. the app was downgraded onto data written by a newer build
    await expect(
      runMigrations(fake.db, [migration(1, 'CREATE TABLE a (id TEXT)')], {
        getUserVersion: fake.getUserVersion,
      }),
    ).rejects.toThrow(SchemaTooNewError);

    expect(fake.executedStatements).toHaveLength(0); // never touches the DB
  });

  it('does not throw when user_version exactly matches the highest known migration', async () => {
    const fake = makeFakeDb(1);
    await expect(
      runMigrations(fake.db, [migration(1, 'CREATE TABLE a (id TEXT)')], {
        getUserVersion: fake.getUserVersion,
      }),
    ).resolves.toEqual([]);
  });
});
