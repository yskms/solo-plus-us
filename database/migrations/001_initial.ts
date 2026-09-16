import { SCHEMA_V1_STATEMENTS } from '../schema';
import type { Migration, MigrationExecutor } from './index';

/**
 * Creates schema version 1 in full (§5). There is no "version 0" to
 * migrate from — this only ever runs once, against a brand-new database
 * file.
 */
export const migration001Initial: Migration = {
  version: 1,
  description: 'Initial schema: activities, health_sync, health_sync_jobs, app_settings',
  up: async (tx: MigrationExecutor) => {
    for (const statement of SCHEMA_V1_STATEMENTS) {
      await tx.execute(statement);
    }
  },
};
