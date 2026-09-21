/**
 * 基本設計 v0.11 §5/§9 (D-03) — `health_sync_jobs`: the outbox of pending
 * work. No FK to `activities` (a pending `delete` job's whole reason to
 * exist is that the Activity is already gone).
 *
 * This file is DB-only primitives. The *decisions* about which operation
 * to enqueue for a given event (§9.3's join table, §10.1's delete
 * branching) are pure functions in `services/syncJobPlanner.ts` — kept
 * separate specifically so they can be unit tested without a database.
 * `services/ActivityService` combines the two.
 *
 * `services/SyncWorker` / `services/HealthConnectService` (§9.5–§9.7, the
 * actual claim/finalize loop and native provider calls) are implemented
 * (Phase 4) — see README "Phase 4 実装状況". The claim/finalize primitives
 * below were written earlier as plain SQL with no native dependency, ahead
 * of that loop, but are the same primitives it uses now.
 */
import { generateId } from '../lib/id';
import { nowUtcIso } from '../lib/datetime';
import type { Scalar, SqlExecutor } from '../database/SqlExecutor';
import type { HealthSyncJobRow, JobOperation, Provider, SyncErrorCode } from '../types/HealthSync';

interface HealthSyncJobDbRow {
  id: string;
  activity_id: string;
  provider: string;
  operation: string;
  external_record_id: string | null;
  revision: number;
  claimed_at: string | null;
  not_before: string | null;
  attempts: number;
  last_error_code: string | null;
  created_at: string;
}

function rowToJob(row: HealthSyncJobDbRow): HealthSyncJobRow {
  return {
    id: row.id,
    activityId: row.activity_id,
    provider: row.provider as Provider,
    operation: row.operation as JobOperation,
    externalRecordId: row.external_record_id,
    revision: row.revision,
    claimedAt: row.claimed_at,
    notBefore: row.not_before,
    attempts: row.attempts,
    lastErrorCode: row.last_error_code as SyncErrorCode | null,
    createdAt: row.created_at,
  };
}

export async function findJob(
  executor: SqlExecutor,
  activityId: string,
  provider: Provider,
): Promise<HealthSyncJobRow | null> {
  const result = await executor.execute(
    'SELECT * FROM health_sync_jobs WHERE activity_id = ? AND provider = ?',
    [activityId, provider],
  );
  const row = result.rows?.[0] as unknown as HealthSyncJobDbRow | undefined;
  return row ? rowToJob(row) : null;
}

/** Settings > Health Connect's "unsynced changes" list (§10.4) only has job ids to act on — this is how `services/HealthSyncManualActions` looks one back up before deciding what discarding it means (D-51). */
export async function findJobById(executor: SqlExecutor, jobId: string): Promise<HealthSyncJobRow | null> {
  const result = await executor.execute('SELECT * FROM health_sync_jobs WHERE id = ?', [jobId]);
  const row = result.rows?.[0] as unknown as HealthSyncJobDbRow | undefined;
  return row ? rowToJob(row) : null;
}

/** Precondition: no job currently exists for (activityId, provider) — the `uq_health_sync_jobs` index enforces this; call `replaceJob` instead if one does. */
export async function insertJob(
  executor: SqlExecutor,
  input: { activityId: string; provider: Provider; operation: JobOperation; externalRecordId?: string | null; notBefore: string | null },
): Promise<HealthSyncJobRow> {
  const id = generateId();
  const now = nowUtcIso();
  await executor.execute(
    `INSERT INTO health_sync_jobs (
       id, activity_id, provider, operation, external_record_id,
       revision, claimed_at, not_before, attempts, last_error_code, created_at
     ) VALUES (?, ?, ?, ?, ?, 1, NULL, ?, 0, NULL, ?)`,
    [id, input.activityId, input.provider, input.operation, input.externalRecordId ?? null, input.notBefore, now],
  );
  const created = await findJob(executor, input.activityId, input.provider);
  if (!created) throw new Error('insertJob: insert succeeded but row is not readable back');
  return created;
}

/** Rows/statement kept well under SQLite's default 999-bound-parameter limit (6 params/row: id, activity_id, provider, operation, not_before, created_at). */
const BULK_INSERT_CHUNK_SIZE = 100;

/**
 * Bulk variant of `insertJob` for callers that queue many jobs at once
 * (`services/HealthSyncResyncService.ts`, §13.6) and don't need each
 * inserted row read back — `insertJob`'s per-row `INSERT` + `SELECT`
 * read-back would double the statement count across potentially thousands
 * of Activities. Chunked into multi-row `VALUES` statements instead of one
 * `execute()` per row, so the whole call is a handful of statements rather
 * than one per job — this matters because every `db.transaction()` in this
 * app shares one connection-wide FIFO queue (op-sqlite's `enhanceDB`,
 * `node_modules/@op-engineering/op-sqlite/src/functions.ts`): a slow
 * transaction here blocks every other transaction in the app (recording a
 * new Activity, `SyncWorker`'s own finalize) for its entire duration, not
 * just this one.
 *
 * Same precondition as `insertJob`, per row: no existing job for
 * (activityId, provider) — `uq_health_sync_jobs`.
 */
export async function insertJobsBulk(
  executor: SqlExecutor,
  jobs: readonly { activityId: string; provider: Provider; operation: JobOperation; notBefore: string | null }[],
): Promise<void> {
  if (jobs.length === 0) return;
  const now = nowUtcIso();

  for (let i = 0; i < jobs.length; i += BULK_INSERT_CHUNK_SIZE) {
    const chunk = jobs.slice(i, i + BULK_INSERT_CHUNK_SIZE);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, NULL, 1, NULL, ?, 0, NULL, ?)').join(', ');
    const params: Scalar[] = [];
    for (const job of chunk) {
      params.push(generateId(), job.activityId, job.provider, job.operation, job.notBefore, now);
    }
    await executor.execute(
      `INSERT INTO health_sync_jobs (
         id, activity_id, provider, operation, external_record_id,
         revision, claimed_at, not_before, attempts, last_error_code, created_at
       ) VALUES ${placeholders}`,
      params,
    );
  }
}

/**
 * §9.3/§10.1: replaces the pending job's operation for (activityId,
 * provider) — e.g. `create` → `delete` when attempts > 0 or a mapping
 * exists. Always bumps `revision` (required, §9.3).
 *
 * Implementation choice beyond what 基本設計 §9.3/§9.5.1 spells out
 * verbatim: this also clears `claimed_at`/`attempts`/`last_error_code`.
 * The docs only say the *worker's own* finalize step must leave a
 * revision-mismatched row untouched (§9.5.1's "else: job は残す") — they
 * don't say what a *system-triggered* replace (this function, called from
 * `ActivityService` reacting to a fresh edit/delete, which §9.3 requires
 * to proceed even while the job is claimed) should do to those fields.
 * Leaving `claimed_at` set here would leave the newly-replaced job stuck
 * until app restart clears it (§6.2) — undesirable when §9.3 explicitly
 * mandates this replace can happen while a job is mid-flight. Attempts is
 * reset because the replaced operation hasn't been attempted yet; the
 * in-flight caller's own finalize (§9.5.1) is unaffected since it only
 * acts when the revision it captured at claim time still matches.
 */
export async function replaceJob(
  executor: SqlExecutor,
  activityId: string,
  provider: Provider,
  input: { operation: JobOperation; externalRecordId?: string | null; notBefore: string | null },
): Promise<HealthSyncJobRow> {
  await executor.execute(
    `UPDATE health_sync_jobs SET
       operation = ?, external_record_id = ?, not_before = ?,
       revision = revision + 1, claimed_at = NULL, attempts = 0, last_error_code = NULL
     WHERE activity_id = ? AND provider = ?`,
    [input.operation, input.externalRecordId ?? null, input.notBefore, activityId, provider],
  );
  const updated = await findJob(executor, activityId, provider);
  if (!updated) throw new Error('replaceJob: no job found for (activityId, provider)');
  return updated;
}

/** §9.3 row 1: an unattempted `create` job can simply be removed when the Activity is deleted (nothing ever reached the provider). */
export async function deleteJob(executor: SqlExecutor, activityId: string, provider: Provider): Promise<void> {
  await executor.execute('DELETE FROM health_sync_jobs WHERE activity_id = ? AND provider = ?', [
    activityId,
    provider,
  ]);
}

export async function findJobsForActivity(executor: SqlExecutor, activityId: string): Promise<HealthSyncJobRow[]> {
  const result = await executor.execute('SELECT * FROM health_sync_jobs WHERE activity_id = ?', [activityId]);
  return ((result.rows ?? []) as unknown as HealthSyncJobDbRow[]).map(rowToJob);
}

/** §6.2 — run once at app startup, before the worker starts. */
export async function clearAllClaims(executor: SqlExecutor): Promise<void> {
  await executor.execute('UPDATE health_sync_jobs SET claimed_at = NULL WHERE claimed_at IS NOT NULL');
}

// ---------------------------------------------------------------------------
// The following are DB primitives for the SyncWorker claim/finalize loop —
// §9.5/§9.6 (services/SyncWorker.ts). Written as plain SQL with no native
// dependency ahead of that loop's own implementation.
// ---------------------------------------------------------------------------

/** Distinguishable from `null` (no due job at all) — a caller (`services/SyncWorker`) that loses the race should try the next due row instead of concluding the queue is empty. */
export const LOST_CLAIM_RACE = Symbol('LOST_CLAIM_RACE');

/**
 * §9.5 steps 1–2: finds the oldest due, unclaimed job for `provider` and
 * claims it (`claimed_at = now`, `attempts += 1`, `revision += 1` — §9.5.2:
 * attempts increases at claim time, not on failure). Returns `null` if
 * there is no due job at all, or `LOST_CLAIM_RACE` if a concurrent caller
 * claimed/replaced it first — the two are deliberately distinguishable so a
 * caller can retry on the latter instead of treating the whole queue as
 * empty (v1 has no concurrent worker yet, so this only matters once
 * something drives `drainDueJobs` from more than one trigger at a time).
 */
export async function claimNextDueJob(
  executor: SqlExecutor,
  provider: Provider,
  nowIso: string = nowUtcIso(),
): Promise<HealthSyncJobRow | null | typeof LOST_CLAIM_RACE> {
  const dueResult = await executor.execute(
    `SELECT * FROM health_sync_jobs
     WHERE provider = ? AND claimed_at IS NULL AND not_before IS NOT NULL AND not_before <= ?
     ORDER BY not_before ASC LIMIT 1`,
    [provider, nowIso],
  );
  const dueRow = dueResult.rows?.[0] as unknown as HealthSyncJobDbRow | undefined;
  if (!dueRow) return null;

  const claimResult = await executor.execute(
    `UPDATE health_sync_jobs
     SET claimed_at = ?, attempts = attempts + 1, revision = revision + 1
     WHERE id = ? AND revision = ?`,
    [nowIso, dueRow.id, dueRow.revision],
  );
  if (claimResult.rowsAffected === 0) {
    return LOST_CLAIM_RACE;
  }

  const claimed = await executor.execute('SELECT * FROM health_sync_jobs WHERE id = ?', [dueRow.id]);
  const row = claimed.rows?.[0] as unknown as HealthSyncJobDbRow | undefined;
  return row ? rowToJob(row) : null;
}

/**
 * §9.5.1's create/update/recreate race: "create 送信中に編集 → mapping は
 * 作られる → ジョブは残り、大きい sync_version で送り直す". Unlike a
 * concurrent delete (which routes through `replaceJob` and bumps
 * `revision`), an edit while a job is already in flight is a documented
 * no-op for the job row itself (`services/syncJobPlanner.ts`'s
 * `planForEdit` — the worker is expected to read current values right
 * before sending, §9.2). That means `revision` alone cannot detect an edit
 * that lands *during* the external call, after that read already happened
 * — the caller must compare the `syncVersion` it actually sent against the
 * Activity's current one and call this instead of
 * `deleteJobIfRevisionMatches` when they differ, so the job survives to be
 * resent with the newer data. Still gated on `revisionAtClaim` (nothing
 * else should have touched this job row while the Activity exists and
 * wasn't deleted) — a `false` return here is `services/SyncWorker`'s
 * §9.5.4 signal.
 */
export async function releaseClaimForResend(
  executor: SqlExecutor,
  jobId: string,
  revisionAtClaim: number,
  notBefore: string,
): Promise<boolean> {
  const result = await executor.execute(
    `UPDATE health_sync_jobs SET claimed_at = NULL, not_before = ?, revision = revision + 1
     WHERE id = ? AND revision = ?`,
    [notBefore, jobId, revisionAtClaim],
  );
  return (result.rowsAffected ?? 0) > 0;
}

/**
 * §9.5.1: deletes the job only if its revision still matches what the
 * caller captured at claim time. Returns `false` (and leaves the row
 * completely untouched) on mismatch — the caller is expected to have
 * already recorded the external success via `HealthSyncRepository.
 * upsertMapping` regardless of this result (§9.5.1: "外部呼び出しが成功した
 * 事実は... 独立に記録する").
 */
export async function deleteJobIfRevisionMatches(
  executor: SqlExecutor,
  jobId: string,
  revisionAtClaim: number,
): Promise<boolean> {
  const result = await executor.execute('DELETE FROM health_sync_jobs WHERE id = ? AND revision = ?', [
    jobId,
    revisionAtClaim,
  ]);
  return (result.rowsAffected ?? 0) > 0;
}

/**
 * §9.5.1 "else" branch — the Activity was deleted mid-flight, so §10.1's
 * `replaceJob` has already turned this job into `delete`; it needs the
 * external id the just-finished `create` obtained, so the eventual delete
 * can address the real record.
 *
 * Deliberately does *not* gate on the revision captured at claim time —
 * `replaceJob` (called to make the delete happen in the first place)
 * always bumps `revision`, so a revision-equality check here would never
 * match in exactly the case this function exists for. Gates on state
 * instead: only attach when the row is still a `delete` with no id yet,
 * which is idempotent and safe even if something else touches the row
 * between the check and the update.
 */
export async function attachExternalIdToDeleteJob(
  executor: SqlExecutor,
  jobId: string,
  externalRecordId: string,
): Promise<boolean> {
  const result = await executor.execute(
    `UPDATE health_sync_jobs SET external_record_id = ?, revision = revision + 1
     WHERE id = ? AND operation = 'delete' AND external_record_id IS NULL`,
    [externalRecordId, jobId],
  );
  return (result.rowsAffected ?? 0) > 0;
}

/**
 * §9.6 failure path. Backoff and manual-retry-required (`notBefore: null`)
 * are the caller's decision (`attempts` on the claimed row tells it which).
 * No-ops on revision mismatch, for the same reason as
 * `deleteJobIfRevisionMatches`.
 */
export async function markJobFailed(
  executor: SqlExecutor,
  jobId: string,
  revisionAtClaim: number,
  input: { errorCode: SyncErrorCode; notBefore: string | null },
): Promise<boolean> {
  const result = await executor.execute(
    `UPDATE health_sync_jobs SET
       claimed_at = NULL, last_error_code = ?, not_before = ?, revision = revision + 1
     WHERE id = ? AND revision = ?`,
    [input.errorCode, input.notBefore, jobId, revisionAtClaim],
  );
  return (result.rowsAffected ?? 0) > 0;
}

/** §9.5.3 — the create/update Activity target is gone; not retryable automatically (D-33). */
export async function markJobInternalInconsistency(
  executor: SqlExecutor,
  jobId: string,
  revisionAtClaim: number,
): Promise<boolean> {
  return markJobFailed(executor, jobId, revisionAtClaim, {
    errorCode: 'LOCAL_ACTIVITY_NOT_FOUND',
    notBefore: null,
  });
}

/** Settings "Retry now" (§9.6/§10.4) — D-39: refuses if the job is currently claimed. */
export async function requestManualRetry(executor: SqlExecutor, jobId: string): Promise<boolean> {
  const result = await executor.execute(
    `UPDATE health_sync_jobs SET not_before = ?, revision = revision + 1
     WHERE id = ? AND claimed_at IS NULL`,
    [nowUtcIso(), jobId],
  );
  return (result.rowsAffected ?? 0) > 0;
}

/**
 * Settings "discard" (D-35/§9.6) — D-39: refuses if the job is currently
 * claimed. Deletes the job row only — this is the raw primitive.
 *
 * **Does not by itself record `uncertain`/`declined` into `health_sync`
 * (D-51).** The gap this used to describe (discarding a `create` job with
 * `attempts > 0` losing all record that "may have reached the provider",
 * so a later delete silently skips defensive cleanup — §10.1 順6) is
 * resolved, but not here: `services/HealthSyncManualActions.discardSyncJob`
 * is the actual entry point Settings calls, and it wraps this primitive
 * together with `HealthSyncRepository.upsertDeclinedOrUncertainMapping` in
 * one transaction (this project's convention — Repository functions take a
 * bare `SqlExecutor`, the caller owns the transaction, same shape as
 * `ActivityService.deleteActivity`). Call this function directly only for
 * `delete`/internal-inconsistency jobs, where the Activity is already gone
 * and no `health_sync` row could exist for it anyway (FK RESTRICT).
 */
export async function discardJob(executor: SqlExecutor, jobId: string): Promise<boolean> {
  const result = await executor.execute('DELETE FROM health_sync_jobs WHERE id = ? AND claimed_at IS NULL', [jobId]);
  return (result.rowsAffected ?? 0) > 0;
}

/** Jobs shown in Settings > Health Connect as "unsynced changes" (§10.4). */
export async function findAllJobsForProvider(executor: SqlExecutor, provider: Provider): Promise<HealthSyncJobRow[]> {
  const result = await executor.execute('SELECT * FROM health_sync_jobs WHERE provider = ? ORDER BY created_at ASC', [
    provider,
  ]);
  return ((result.rows ?? []) as unknown as HealthSyncJobDbRow[]).map(rowToJob);
}

/** §13.3: wipes every pending job, across all providers — used only by the Import replace-restore flow. */
export async function deleteAllJobs(executor: SqlExecutor): Promise<void> {
  await executor.execute('DELETE FROM health_sync_jobs');
}
