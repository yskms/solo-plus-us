/**
 * Test-only adapter: makes `better-sqlite3` (real SQLite3, synchronous,
 * pure Node — no native RN module needed) look like the `SqlExecutor`/`DB`
 * interfaces our Repository/Service layer expects from op-sqlite.
 *
 * This is NOT shipped in the app. Its only purpose is to run the actual
 * SQL in `database/schema.ts` and every repository query against a real
 * SQLite engine in Jest, so syntax/constraint bugs are caught here instead
 * of only on a device build. SQLCipher (what op-sqlite uses in the real
 * app) is a drop-in SQLite3 fork — same SQL dialect — so this is a
 * legitimate proxy for SQL correctness, though it obviously can't stand
 * in for anything SQLCipher/op-sqlite-specific (encryption, `PRAGMA key`).
 */
import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { SCHEMA_V1_STATEMENTS } from '../../database/schema';
import type { QueryResult, SqlExecutor } from '../../database/SqlExecutor';

function isSelectLike(sql: string): boolean {
  return /^\s*(SELECT|PRAGMA\s+\w+\s*(;|$))/i.test(sql);
}

function runOne(raw: DatabaseType, query: string, params: readonly unknown[] = []): QueryResult {
  const trimmed = query.trim();

  const pragmaSet = /^PRAGMA\s+(\w+)\s*=\s*(.+)$/i.exec(trimmed);
  if (pragmaSet) {
    raw.pragma(`${pragmaSet[1]} = ${pragmaSet[2]}`);
    return { rowsAffected: 0, rows: [] };
  }
  const pragmaGet = /^PRAGMA\s+(\w+)\s*$/i.exec(trimmed);
  if (pragmaGet) {
    const rows = raw.pragma(pragmaGet[1]) as Record<string, unknown>[];
    return { rowsAffected: 0, rows: rows as never };
  }

  if (isSelectLike(trimmed)) {
    const rows = raw.prepare(query).all(...(params as never[]));
    return { rowsAffected: 0, rows: rows as never };
  }

  const info = raw.prepare(query).run(...(params as never[]));
  return { rowsAffected: info.changes, rows: [], insertId: Number(info.lastInsertRowid) };
}

export interface TestDb extends SqlExecutor {
  transaction: (fn: (tx: SqlExecutor) => Promise<void>) => Promise<void>;
  raw: DatabaseType;
  close: () => void;
}

/** A fresh, fully-migrated in-memory database (schema version 1 applied). */
export function createTestDb(): TestDb {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');

  for (const statement of SCHEMA_V1_STATEMENTS) {
    raw.exec(statement);
  }

  const execute = async (query: string, params?: unknown[]): Promise<QueryResult> => runOne(raw, query, params ?? []);

  const transaction = async (fn: (tx: SqlExecutor) => Promise<void>): Promise<void> => {
    raw.exec('BEGIN');
    try {
      await fn({ execute });
      raw.exec('COMMIT');
    } catch (error) {
      raw.exec('ROLLBACK');
      throw error;
    }
  };

  return { execute, transaction, raw, close: () => raw.close() };
}
