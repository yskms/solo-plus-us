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
 * D-35's explicit "don't sync this" choice, set only by `services/
 * HealthSyncManualActions.discardSyncJob`; `'uncertain'` (also only set by
 * that same discard flow) means "may have reached the provider, but the
 * person also confirmed the exact same 'この記録を Health Connect へ
 * 同期しない' text D-35 shows for `declined`" — see `planForEdit`'s doc
 * comment for why that makes the two asymmetric with `planForDelete`, not
 * identical to it.
 */
export type MappingState = 'none' | 'synced' | 'uncertain' | 'declined';

/**
 * "Might a copy of this record already exist on the provider" — the axis
 * `planForDelete` cares about, and the same test `services/
 * HealthSyncManualActions.discardSyncJob` needs when deciding whether a
 * *newly* discarded job's `attempts === 0` can be trusted (it can't, if a
 * prior mapping already implies a touch — see that function's doc
 * comment). Exported so neither caller re-derives this condition a second,
 * driftable way (D-21's "don't duplicate the table").
 */
export function mappingImpliesExternalTouch(mappingState: MappingState): boolean {
  return mappingState === 'synced' || mappingState === 'uncertain';
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
 * D-51 resolved what "no job" should do, using `mappingState` — and,
 * after a correction during review, **`'uncertain'` joins `'declined'`
 * here (noop), not `'synced'`.** Both `'uncertain'` and `'declined'` are
 * set only by `services/HealthSyncManualActions.discardSyncJob`, and both
 * are reached from the exact same confirmation text (D-35's "この記録を
 * Health Connect へ同期しない") — the person sees and confirms the same
 * sentence either way. Resuming active syncing for `'uncertain'` but not
 * `'declined'` would mean two people who took the identical action get
 * different future behavior based on an invisible internal detail (did
 * the worker happen to attempt the job once before it was discarded) —
 * exactly the kind of "利用者はローカルと HC が一致していると誤解する"
 * mismatch D-35 exists to prevent, just mirrored. v1 deliberately has no
 * "resume syncing this declined/uncertain record" action, so once either
 * state is set, an edit alone must not revive it.
 *
 *  - `'synced'`: insert an `update` job — the only state where an edit
 *    should opportunistically resume syncing.
 *  - `'uncertain'` / `'declined'`: noop, per above.
 *  - `'none'`: noop — no backfill-on-edit. The provider became active only
 *    after this Activity existed (never queued for it at all); inserting
 *    `create` here would be the "backfill" an earlier version of this
 *    function assumed, and would also risk D-34's race with a
 *    replace-restore (D-10) that wiped every job/mapping while a
 *    still-present, higher-`clientRecordVersion` external record survives
 *    (fixing that case for real needs `recreate`, not `create`).
 *
 * This makes `planForEdit` and `planForDelete` treat `'uncertain'`
 * *asymmetrically* — `planForDelete` still puts it on the "may exist on
 * the provider" side, alongside `'synced'` (see that function's doc
 * comment). The two functions are answering different questions: whether
 * to *resume active syncing* (a question of the person's intent, which
 * `'uncertain'` does not override) versus whether a *defensive cleanup*
 * might be needed (a question of physical state, which discarding a job
 * never actually resolves either way).
 */
export function planForEdit(current: CurrentJobState | null, mappingState: MappingState): SyncJobPlan {
  if (current) {
    // create / update / recreate: unaffected by an edit, regardless of
    // attempts or claim state (§9.3).
    return { action: 'noop' };
  }
  if (mappingState === 'synced') {
    return { action: 'insert', operation: 'update' };
  }
  return { action: 'noop' }; // 'uncertain' / 'declined' / 'none' — see docstring
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
 * every branch (順2/順5, via `mappingImpliesExternalTouch`) — that is the
 * entire reason D-51 introduced it: a discarded job that may have reached
 * the provider must still get a defensive delete job later, exactly like
 * a confirmed `'synced'` mapping would. `'declined'` joins `'none'`
 * instead — it is only ever set when nothing about the discarded job or
 * any prior mapping suggested an external touch (see `services/
 * HealthSyncManualActions.discardSyncJob`'s doc comment for how it
 * decides that, which is not simply "this job's own `attempts === 0`").
 *
 * (`planForEdit`, just above, treats `'uncertain'` differently —
 * alongside `'declined'`, not `'synced'`. See its doc comment for why
 * that asymmetry is intentional rather than an inconsistency.)
 */
export function planForDelete(current: CurrentJobState | null, mappingState: MappingState): SyncJobPlan {
  const externalTouchViaMapping = mappingImpliesExternalTouch(mappingState);

  if (current?.operation === 'create') {
    const externalTouchPossible = current.attempts > 0 || current.claimedAt !== null || externalTouchViaMapping;
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
  if (externalTouchViaMapping) {
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
