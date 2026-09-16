/**
 * 基本設計 v0.11 §9.3 (join rules) / §10.1 (delete branching), as pure
 * functions with no DB access — the single highest-scrutiny table in the
 * whole design (D-18 through D-46 revisit it repeatedly). Kept separate
 * from `repositories/HealthSyncJobRepository` specifically so it can be
 * unit tested exhaustively without a database.
 *
 * These functions assume the caller has already decided `provider` is
 * currently active (§9.6/D-45 — a disabled provider's jobs are never
 * touched at all, active or not).
 */
import type { HealthSyncJobRow, JobOperation } from '../types/HealthSync';

/** The subset of a job row the planner needs to decide — narrower than the full row so tests don't have to fabricate unrelated fields. */
export interface CurrentJobState {
  operation: JobOperation;
  attempts: number;
  claimedAt: string | null;
}

export type SyncJobPlan =
  | { action: 'insert'; operation: JobOperation }
  | { action: 'replace'; operation: JobOperation }
  | { action: 'delete-job' }
  | { action: 'noop' };

/**
 * A brand-new Activity always has no existing job/mapping for a
 * newly-active provider — §9.3 row 1.
 */
export function planForRecord(): SyncJobPlan {
  return { action: 'insert', operation: 'create' };
}

/**
 * §9.3 rows for "編集" (edit): an existing job is left as-is — the worker
 * reads current Activity values when it eventually sends, so there's
 * nothing to change on the job row itself (§9.2 "ジョブはペイロードを
 * 持たない").
 *
 * Gap filled here: §9.3's table has no row for "no job AND no mapping"
 * under 編集 — that combination isn't reachable when a provider has been
 * active since the Activity was first recorded (record always inserts a
 * `create` job). It *is* reachable if the provider became active only
 * after the Activity existed (never queued for this provider at all).
 * Treated the same as a first-time record for this provider: insert
 * `create`.
 */
export function planForEdit(current: CurrentJobState | null, mappingExists: boolean): SyncJobPlan {
  if (current) {
    // create / update / recreate: unaffected by an edit, regardless of
    // attempts or claim state (§9.3).
    return { action: 'noop' };
  }
  if (mappingExists) {
    return { action: 'insert', operation: 'update' };
  }
  return { action: 'insert', operation: 'create' }; // gap fill, see docstring
}

/**
 * §10.1 (D-21/D-46's final job-first table). Order matters — evaluate top
 * to bottom, first match wins.
 *
 * | # | condition                                                    | action              |
 * |---|---------------------------------------------------------------|---------------------|
 * | 1 | create, attempts=0, unclaimed, no mapping                     | delete the job       |
 * | 2 | create, and (attempts>0 or claimed or mapping exists)         | replace → delete      |
 * | 3 | update                                                       | replace → delete      |
 * | 4 | recreate                                                     | replace → delete      |
 * | 5 | no job, mapping exists                                       | insert delete          |
 * | 6 | no job, no mapping                                           | noop (nothing to do for this provider) |
 */
export function planForDelete(current: CurrentJobState | null, mappingExists: boolean): SyncJobPlan {
  if (current?.operation === 'create') {
    const externalTouchPossible = current.attempts > 0 || current.claimedAt !== null || mappingExists;
    if (!externalTouchPossible) {
      return { action: 'delete-job' }; // §10.1 順1: external unreached, safe to drop
    }
    return { action: 'replace', operation: 'delete' }; // §10.1 順2
  }
  if (current?.operation === 'update') {
    return { action: 'replace', operation: 'delete' }; // §10.1 順3
  }
  if (current?.operation === 'recreate') {
    return { action: 'replace', operation: 'delete' }; // §10.1 順4
  }
  // current is null (or, unreachably, 'delete' — §9.3: "発生しない")
  if (mappingExists) {
    return { action: 'insert', operation: 'delete' }; // §10.1 順5
  }
  return { action: 'noop' }; // §10.1 順6
}

export function toCurrentJobState(job: HealthSyncJobRow | null): CurrentJobState | null {
  if (!job) return null;
  return { operation: job.operation, attempts: job.attempts, claimedAt: job.claimedAt };
}
