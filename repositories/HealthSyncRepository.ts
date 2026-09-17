/**
 * 基本設計 v0.11 §5/§9.1 (D-03) — `health_sync`: the *current* mapping to
 * an external provider record, one row per (activity, provider). FK
 * `ON DELETE RESTRICT` means a row here can only exist for a living
 * Activity — callers must remove the mapping (via `deleteMapping`) inside
 * the same transaction, before deleting the Activity row (§10.2).
 */
import { nowUtcIso } from '../lib/datetime';
import type { SqlExecutor } from '../database/SqlExecutor';
import type { HealthSyncRow, Provider } from '../types/HealthSync';

interface HealthSyncDbRow {
  activity_id: string;
  provider: string;
  external_record_id: string | null;
  last_synced_at: string;
}

function rowToHealthSync(row: HealthSyncDbRow): HealthSyncRow {
  return {
    activityId: row.activity_id,
    provider: row.provider as Provider,
    externalRecordId: row.external_record_id,
    lastSyncedAt: row.last_synced_at,
  };
}

export async function findMapping(
  executor: SqlExecutor,
  activityId: string,
  provider: Provider,
): Promise<HealthSyncRow | null> {
  const result = await executor.execute(
    'SELECT * FROM health_sync WHERE activity_id = ? AND provider = ?',
    [activityId, provider],
  );
  const row = result.rows?.[0] as unknown as HealthSyncDbRow | undefined;
  return row ? rowToHealthSync(row) : null;
}

export async function findMappingsForActivity(
  executor: SqlExecutor,
  activityId: string,
): Promise<HealthSyncRow[]> {
  const result = await executor.execute('SELECT * FROM health_sync WHERE activity_id = ?', [activityId]);
  return ((result.rows ?? []) as unknown as HealthSyncDbRow[]).map(rowToHealthSync);
}

/** Called by the (Phase 4) SyncWorker's finalize step — "the external call succeeded" is recorded here regardless of whether the job row can also be cleared (D-32/§9.5.1). */
export async function upsertMapping(
  executor: SqlExecutor,
  input: { activityId: string; provider: Provider; externalRecordId: string | null },
): Promise<void> {
  await executor.execute(
    `INSERT INTO health_sync (activity_id, provider, external_record_id, last_synced_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (activity_id, provider) DO UPDATE SET
       external_record_id = excluded.external_record_id,
       last_synced_at = excluded.last_synced_at`,
    [input.activityId, input.provider, input.externalRecordId, nowUtcIso()],
  );
}

/** §10.2 step 3 — must run before `deleteActivityRow`, or the FK RESTRICT rejects the delete. */
export async function deleteMapping(executor: SqlExecutor, activityId: string, provider: Provider): Promise<void> {
  await executor.execute('DELETE FROM health_sync WHERE activity_id = ? AND provider = ?', [activityId, provider]);
}

export async function deleteAllMappingsForActivity(executor: SqlExecutor, activityId: string): Promise<void> {
  await executor.execute('DELETE FROM health_sync WHERE activity_id = ?', [activityId]);
}

/** §13.3: wipes every mapping, across all providers — used only by the Import replace-restore flow. */
export async function deleteAllMappings(executor: SqlExecutor): Promise<void> {
  await executor.execute('DELETE FROM health_sync');
}
