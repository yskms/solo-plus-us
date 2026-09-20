/**
 * 基本設計 v0.11 §5/§9.1 (D-03) — `health_sync`: the *current* mapping to
 * an external provider record, one row per (activity, provider). FK
 * `ON DELETE RESTRICT` means a row here can only exist for a living
 * Activity — callers must remove the mapping (via `deleteMapping`) inside
 * the same transaction, before deleting the Activity row (§10.2).
 *
 * D-51: a row's `sync_state` distinguishes an actual confirmed sync
 * (`synced`) from the two "gave up without knowing for sure" outcomes
 * (`uncertain`/`declined`) — see `types/HealthSync.ts`'s `SyncState` doc
 * comment and `services/syncJobPlanner.ts`'s `MappingState`.
 */
import { nowUtcIso } from '../lib/datetime';
import type { SqlExecutor } from '../database/SqlExecutor';
import type { HealthSyncRow, Provider, SyncState } from '../types/HealthSync';

interface HealthSyncDbRow {
  activity_id: string;
  provider: string;
  external_record_id: string | null;
  sync_state: string;
  last_synced_at: string | null;
}

function rowToHealthSync(row: HealthSyncDbRow): HealthSyncRow {
  return {
    activityId: row.activity_id,
    provider: row.provider as Provider,
    externalRecordId: row.external_record_id,
    syncState: row.sync_state as SyncState,
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

/**
 * Called by `SyncWorker`'s finalize step — "the external call succeeded" is
 * recorded here regardless of whether the job row can also be cleared
 * (D-32/§9.5.1). Always writes `sync_state = 'synced'`, explicitly, on both
 * the insert and the conflict-update path (D-51) — omitting it from the
 * `DO UPDATE SET` would leave a row that was previously `uncertain`/
 * `declined` stuck there forever even after a real, confirmed sync
 * succeeds (this exact mistake was caught in review before it shipped).
 */
export async function upsertMapping(
  executor: SqlExecutor,
  input: { activityId: string; provider: Provider; externalRecordId: string | null },
): Promise<void> {
  await executor.execute(
    `INSERT INTO health_sync (activity_id, provider, external_record_id, sync_state, last_synced_at)
     VALUES (?, ?, ?, 'synced', ?)
     ON CONFLICT (activity_id, provider) DO UPDATE SET
       external_record_id = excluded.external_record_id,
       sync_state = 'synced',
       last_synced_at = excluded.last_synced_at`,
    [input.activityId, input.provider, input.externalRecordId, nowUtcIso()],
  );
}

/**
 * D-51: records that a create/update/recreate job was discarded (Settings
 * "discard") rather than actually confirmed synced. `services/
 * HealthSyncManualActions.discardSyncJob` is the only caller — it decides
 * `uncertain` vs `declined` from the discarded job's `attempts`.
 *
 * Deliberately does **not** overwrite `external_record_id`/`last_synced_at`
 * on conflict — only `sync_state` changes. If this (activity, provider)
 * was previously `synced`, its `external_record_id` may still be the real
 * provider identifier a *future* defensive delete needs (§5.4 — HealthKit
 * in particular can require it), and `last_synced_at` stays true as "the
 * last time this was actually confirmed synced," which remains accurate
 * information even once the state moves to `uncertain`/`declined`. Only a
 * fresh row (no prior mapping) gets `external_record_id`/`last_synced_at`
 * as `NULL` — there is nothing to preserve yet.
 */
export async function upsertDeclinedOrUncertainMapping(
  executor: SqlExecutor,
  input: { activityId: string; provider: Provider; syncState: Extract<SyncState, 'declined' | 'uncertain'> },
): Promise<void> {
  await executor.execute(
    `INSERT INTO health_sync (activity_id, provider, external_record_id, sync_state, last_synced_at)
     VALUES (?, ?, NULL, ?, NULL)
     ON CONFLICT (activity_id, provider) DO UPDATE SET
       sync_state = excluded.sync_state`,
    [input.activityId, input.provider, input.syncState],
  );
}

/** §10.2 step 3 — must run before `deleteActivityRow`, or the FK RESTRICT rejects the delete. Removes the mapping regardless of `sync_state`. */
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
