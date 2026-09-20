/**
 * 基本設計 v0.11 §9.3 (join rules) / §10.1 (delete branching), as pure
 * functions with no DB access — the single highest-scrutiny table in the
 * whole design (D-18 through D-51 revisit it repeatedly). Kept separate
 * from `repositories/HealthSyncJobRepository` specifically so it can be
 * unit tested exhaustively without a database.
 *
 * These functions assume the caller has already decided `provider` is
 * currently active (§9.6/D-45 — a disabled provider's jobs are never
 * touched at all, active or not).
 */
import type { HealthSyncJobRow, HealthSyncRow, JobOperation } from '../types/HealthSync';

/** The subset of a job row the planner needs to decide — narrower than the full row so tests don't have to fabricate unrelated fields. */
export interface CurrentJobState {
  operation: JobOperation;
  attempts: number;
  claimedAt: string | null;
}

/**
 * D-51: what `health_sync` says about this (activity, provider), folding
 * "no row at all" in alongside the row's own `SyncState` (`types/
 * HealthSync.ts`). `'none'` is the truly-untouched case (e.g. the provider
 * was only enabled after this Activity already existed); `'declined'` is
 * D-35's explicit "don't sync this" choice; `'uncertain'` and `'synced'`
 * both mean "may have (or definitely has) reached the provider" and are
 * treated identically by this file — see `planForEdit`/`planForDelete`.
 */
export type MappingState = 'none' | 'synced' | 'uncertain' | 'declined';

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
 * D-51 resolved what "no job" should do, using `mappingState`:
 *  - `'synced'`/`'uncertain'`: insert an `update` job. Neither is an
 *    intentional opt-out — `uncertain` just means a previous attempt was
 *    abandoned without confirmation, not that syncing should stop, so an
 *    edit is exactly the moment to try again (and a later successful send
 *    moves it back to `'synced'`, §9.5.1/`HealthSyncRepository.
 *    upsertMapping`).
 *  - `'declined'`: noop. D-35's explicit "この記録を Health Connect へ
 *    同期しない" must not be silently overridden by an unrelated edit.
 *  - `'none'`: noop — no backfill-on-edit. The provider became active only
 *    after this Activity existed (never queued for it at all); inserting
 *    `create` here would be the "backfill" an earlier version of this
 *    function assumed, and would also risk D-34's race with a
 *    replace-restore (D-10) that wiped every job/mapping while a
 *    still-present, higher-`clientRecordVersion` external record survives
 *    (fixing that case for real needs `recreate`, not `create`).
 */
export function planForEdit(current: CurrentJobState | null, mappingState: MappingState): SyncJobPlan {
  if (current) {
    // create / update / recreate: unaffected by an edit, regardless of
    // attempts or claim state (§9.3).
    return { action: 'noop' };
  }
  if (mappingState === 'synced' || mappingState === 'uncertain') {
    return { action: 'insert', operation: 'update' };
  }
  return { action: 'noop' }; // 'declined' / 'none' — see docstring
}

/**
 * §10.1 (D-21/D-46's job-first table, extended by D-51 for `mappingState`).
 * Order matters — evaluate top to bottom, first match wins.
 *
 * | # | condition                                                          | action         |
 * |---|---------------------------------------------------------------------|----------------|
 * | 1 | create, attempts=0, unclaimed, mappingState 'none'/'declined'       | delete the job |
 * | 2 | create, and (attempts>0 or claimed or mappingState 'synced'/'uncertain') | replace → delete |
 * | 3 | update                                                             | replace → delete |
 * | 4 | recreate                                                           | replace → delete |
 * | 5 | no job, mappingState 'synced' or 'uncertain'                        | insert delete  |
 * | 6 | no job, mappingState 'none' or 'declined'                           | noop           |
 *
 * `'uncertain'` joins `'synced'` on the "external touch possible" side of
 * every branch (順2/順5) — that is the entire reason D-51 introduced it:
 * a discarded job with `attempts > 0` may have reached the provider, so a
 * later delete must still queue a defensive delete job, exactly like a
 * confirmed `'synced'` mapping would. `'declined'` joins `'none'` instead
 * — `attempts === 0` at discard time means definitely never reached the
 * provider, same as never having synced at all.
 */
export function planForDelete(current: CurrentJobState | null, mappingState: MappingState): SyncJobPlan {
  const mappingImpliesExternalTouch = mappingState === 'synced' || mappingState === 'uncertain';

  if (current?.operation === 'create') {
    const externalTouchPossible = current.attempts > 0 || current.claimedAt !== null || mappingImpliesExternalTouch;
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
  if (mappingImpliesExternalTouch) {
    return { action: 'insert', operation: 'delete' }; // §10.1 順5
  }
  return { action: 'noop' }; // §10.1 順6
}

export function toCurrentJobState(job: HealthSyncJobRow | null): CurrentJobState | null {
  if (!job) return null;
  return { operation: job.operation, attempts: job.attempts, claimedAt: job.claimedAt };
}

/** Pairs with `toCurrentJobState` — folds "no row" into the same `MappingState` union as the row's own `syncState` (D-51). */
export function toMappingState(mapping: HealthSyncRow | null): MappingState {
  return mapping ? mapping.syncState : 'none';
}
