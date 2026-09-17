import type { QueryResult, Scalar } from '@op-engineering/op-sqlite';

/**
 * The common shape of both `DB` and `Transaction` from op-sqlite. All
 * repository functions take one of these as their first argument instead
 * of importing `DB` directly, so the *same* function can run standalone
 * or as one statement inside a caller's `db.transaction()` — which
 * `ActivityService` relies on for §10.2's "everything or nothing" delete.
 */
export interface SqlExecutor {
  execute: (query: string, params?: Scalar[]) => Promise<QueryResult>;
}

/**
 * The minimal shape `services/ActivityService` (and Export/Import) need
 * from a connection: run one statement, or run several as one atomic
 * transaction. Deliberately narrower than op-sqlite's full `DB` type so
 * that anything satisfying this — including the real `DB`, or a test
 * double backed by a different SQLite binding (see `test/support/
 * sqliteTestDb.ts`) — can be passed in without depending on op-sqlite
 * itself.
 */
export interface Transactor extends SqlExecutor {
  transaction: (fn: (tx: SqlExecutor) => Promise<void>) => Promise<void>;
}

export type { Scalar, QueryResult };
