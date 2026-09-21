/**
 * 基本設計 v0.11 §9.6/§9.8/§10 — orchestrates an Activity write together
 * with the sync jobs it implies, as one DB transaction (Rule 1/Rule 2:
 * SQLite is the source of truth; a provider being unreachable must never
 * fail — or partially apply — the local write).
 *
 * Job *decisions* come from the pure `services/syncJobPlanner`; this file
 * is where those decisions meet the DB (`repositories/HealthSyncJobRepository`,
 * `repositories/HealthSyncRepository`) and the Activity write itself
 * (`repositories/ActivityRepository`).
 *
 * `services/SyncWorker` / `services/HealthConnectService` — the code that
 * actually sends a queued job to a provider — are implemented (Phase 4).
 * `healthConnect.enabled` is settable from `app/settings/health-connect.tsx`;
 * the queueing logic below was written and tested ahead of both, back when
 * neither existed yet, so Phase 4 only had to add the sender and the toggle.
 */
import { buildOccurredAtFields, getDeviceTimeZoneId, addSecondsIso, nowUtcIso } from '../lib/datetime';
import * as ActivityRepository from '../repositories/ActivityRepository';
import * as HealthSyncRepository from '../repositories/HealthSyncRepository';
import * as HealthSyncJobRepository from '../repositories/HealthSyncJobRepository';
import type { SqlExecutor, Transactor } from '../database/SqlExecutor';
import { getSetting, setSetting } from './SettingsRepository';
import { planForDelete, planForEdit, planForRecord, toCurrentJobState, toMappingState } from './syncJobPlanner';
import type { Activity, ActivityUpdateInput } from '../types/Activity';
import type { Provider } from '../types/HealthSync';
import { SYNC_DERIVED_SETTING_KEYS } from '../types/Settings';

/** Every provider this app knows about, regardless of whether it's currently enabled — §10 delete cleanup must check all of them (a disabled provider can still hold a leftover mapping, D-45). */
const ALL_PROVIDERS: readonly Provider[] = ['health_connect', 'healthkit'];

/**
 * §9.6/D-45: only providers the user has turned on get *new* jobs queued on
 * record/edit. HealthKit has no settings toggle yet (not implemented), so
 * it's never active in Phase 1. Exported so `services/SyncWorker` can use
 * the same "is this provider active" check before claiming (§9.5 step 0)
 * instead of re-deriving it from settings a second way.
 */
export async function getActiveProviders(executor: SqlExecutor): Promise<Provider[]> {
  const healthConnectEnabled = await getSetting(executor, 'healthConnect.enabled');
  return healthConnectEnabled ? ['health_connect'] : [];
}

/** D-15/D-44: the Undo window's sync delay is a fixed 5 seconds from the record instant, expressed as `not_before` on the persistent job — not a JS timer, so it survives the app being killed. */
const UNDO_SYNC_DELAY_SECONDS = 5;

export interface RecordActivityInput {
  context: Activity['context'];
  instantUtc: Date;
  timezoneId?: string;
  orgasm?: boolean | null;
  ejaculation?: boolean | null;
  protectionUsed?: boolean | null;
  durationSeconds?: number | null;
  moodBefore?: number | null;
  moodAfter?: number | null;
  note?: string | null;
}

export async function recordActivity(db: Transactor, input: RecordActivityInput): Promise<Activity> {
  const occurred = buildOccurredAtFields(input.instantUtc, input.timezoneId ?? getDeviceTimeZoneId());

  let created!: Activity;
  await db.transaction(async (tx) => {
    created = await ActivityRepository.createActivity(tx, {
      context: input.context,
      ...occurred,
      timezoneId: input.timezoneId ?? getDeviceTimeZoneId(),
      orgasm: input.orgasm,
      ejaculation: input.ejaculation,
      protectionUsed: input.protectionUsed,
      durationSeconds: input.durationSeconds,
      moodBefore: input.moodBefore,
      moodAfter: input.moodAfter,
      note: input.note,
    });

    const activeProviders = await getActiveProviders(tx);
    const notBefore = addSecondsIso(created.createdAt, UNDO_SYNC_DELAY_SECONDS);
    for (const provider of activeProviders) {
      const plan = planForRecord();
      if (plan.action === 'insert') {
        await HealthSyncJobRepository.insertJob(tx, {
          activityId: created.id,
          provider,
          operation: plan.operation,
          notBefore,
        });
      }
    }
  });

  return created;
}

export async function updateActivity(db: Transactor, id: string, patch: ActivityUpdateInput): Promise<Activity> {
  let updated!: Activity;
  await db.transaction(async (tx) => {
    updated = await ActivityRepository.updateActivity(tx, id, patch);

    const activeProviders = await getActiveProviders(tx);
    const now = nowUtcIso();
    for (const provider of activeProviders) {
      const [job, mapping] = await Promise.all([
        HealthSyncJobRepository.findJob(tx, id, provider),
        HealthSyncRepository.findMapping(tx, id, provider),
      ]);
      const plan = planForEdit(toCurrentJobState(job), toMappingState(mapping));
      if (plan.action === 'insert') {
        await HealthSyncJobRepository.insertJob(tx, {
          activityId: id,
          provider,
          operation: plan.operation,
          notBefore: now,
        });
      }
      // 'noop': job (if any) already reflects the latest state — §9.2, no payload to update.
    }
  });
  return updated;
}

/**
 * §10.2: for *every* known provider (not just currently-active ones — a
 * disabled provider can still hold a mapping/job from before it was
 * disabled, D-45), read the current job/mapping, apply §10.1's plan, then
 * clear the mapping (FK RESTRICT would otherwise block the Activity
 * delete) before finally deleting the Activity row.
 *
 * Takes an already-open `tx` and does *not* open its own transaction, so
 * `deleteActivity` can wrap it in one `db.transaction`. `deleteAllActivities`
 * (§10.6, below) does *not* reuse this — bulk-deleting every Activity has a
 * different, batch-shaped I/O profile than repeating this per row would
 * give it (see that function's doc comment) — but it does reuse the same
 * `planForDelete` decision logic this calls.
 *
 * Naturally idempotent: calling this twice on an already-deleted id is a
 * no-op (every read comes back empty, every plan is 'noop', the final
 * DELETE affects zero rows) — this is what makes `undoLastRecord` safe to
 * tap more than once (D-15 "冪等に実装する").
 */
async function applyDeletePlan(tx: SqlExecutor, id: string): Promise<void> {
  for (const provider of ALL_PROVIDERS) {
    const [job, mapping] = await Promise.all([
      HealthSyncJobRepository.findJob(tx, id, provider),
      HealthSyncRepository.findMapping(tx, id, provider),
    ]);
    const mappingExists = mapping !== null;
    const plan = planForDelete(toCurrentJobState(job), toMappingState(mapping));

    switch (plan.action) {
      case 'delete-job':
        await HealthSyncJobRepository.deleteJob(tx, id, provider);
        break;
      case 'replace':
        await HealthSyncJobRepository.replaceJob(tx, id, provider, {
          operation: plan.operation,
          externalRecordId: mapping?.externalRecordId ?? null,
          notBefore: nowUtcIso(),
        });
        break;
      case 'insert':
        await HealthSyncJobRepository.insertJob(tx, {
          activityId: id,
          provider,
          operation: plan.operation,
          externalRecordId: mapping?.externalRecordId ?? null,
          notBefore: nowUtcIso(),
        });
        break;
      case 'noop':
        break;
    }

    if (mappingExists) {
      await HealthSyncRepository.deleteMapping(tx, id, provider); // §10.2 step 3, before the Activity row goes (FK RESTRICT)
    }
  }

  await ActivityRepository.deleteActivityRow(tx, id); // §10.2 step 4
}

export async function deleteActivity(db: Transactor, id: string): Promise<void> {
  await db.transaction((tx) => applyDeletePlan(tx, id));
}

/**
 * §10.6 "全 Activity 削除" (Settings > Delete Data): applies §10.1's
 * per-Activity branching to every Activity, in one transaction — not
 * `ActivityRepository.deleteAllActivities`, which is a raw table wipe used
 * only by `ImportService.performReplaceImport` *after* health_sync/
 * health_sync_jobs have already been cleared separately (§13.3), and which
 * deliberately creates no delete jobs (a replace-restore isn't "delete this
 * from Health Connect too" — §10.6's own table draws that distinction).
 *
 * Unlike `deleteActivity`, this does **not** loop `applyDeletePlan` once per
 * Activity — that would cost 2 reads (job + mapping) per Activity per
 * provider regardless of whether that Activity ever touched sync at all,
 * which is O(全Activity数) even for the common case (Health Connect never
 * enabled, zero jobs/mappings for every provider). Instead this follows
 * 基本設計 §10.6's own pseudocode shape — "1. 全 Activity に上表を適用して
 * ジョブを整理する / 2. health_sync を全削除 / 3. activities を全削除" — by
 * reading only the jobs/mappings that actually *exist* per provider
 * (bounded by sync history, not total Activity count) and applying
 * `planForDelete` to just those, then bulk-clearing `health_sync` and
 * `activities` in one statement each (`HealthSyncRepository.
 * deleteAllMappings`/`ActivityRepository.deleteAllActivities` — the same
 * raw bulk primitives `performReplaceImport` uses, reused here because by
 * this point every mapping either has been superseded by a fresh `delete`
 * job (§10.1 順5, batched via `insertJobsBulk`) or was never relevant to
 * begin with (順6, no job/mapping — the FK let it go with the Activity
 * either way)). Same decision logic as `applyDeletePlan`
 * (`planForDelete`/`toCurrentJobState`/`toMappingState`) — only the I/O
 * shape differs, not what's decided.
 *
 * §10.6's own note applies here too: this only runs inside
 * `SyncCoordinator.runExclusive` (caller's responsibility, see below), so
 * no job for any provider can be `claimed_at` — `planForDelete`'s "claim
 * 中" handling in `applyDeletePlan`/`deleteActivity` never actually
 * triggers here, but reusing the exact same function (rather than a
 * claim-blind variant) keeps there being only one place that encodes
 * §10.1's table.
 *
 * §10.6 also requires resetting `healthConnect.lastSyncedAt` (and any
 * future provider's equivalent) to `null` at the start of a full delete —
 * every mapping is being wiped, so a stale "Last synced" would misrepresent
 * a device with zero Activities as "just synced". `SYNC_DERIVED_SETTING_KEYS`
 * is the same list `ImportService.performReplaceImport` resets for the same
 * reason (§13.3.1) — kept in one place so a future new provider's setting
 * only needs adding there, not at each of its resets.
 *
 * Caller's responsibility, not this function's (§9.12, same layering as
 * `ImportService.performReplaceImport` — see `services/SyncCoordinator`'s
 * doc comment "対象範囲"): run this through `SyncCoordinator.runExclusive`
 * against the live app DB, and don't call it from inside another
 * `runExclusive` callback (nesting deadlocks the serialization queue).
 */
export async function deleteAllActivities(db: Transactor): Promise<void> {
  await db.transaction(async (tx) => {
    for (const provider of ALL_PROVIDERS) {
      const [jobs, mappings] = await Promise.all([
        HealthSyncJobRepository.findAllJobsForProvider(tx, provider),
        HealthSyncRepository.findAllMappingsForProvider(tx, provider),
      ]);
      const mappingByActivity = new Map(mappings.map((m) => [m.activityId, m]));
      const notBefore = nowUtcIso();

      // Every job here has a non-null `current` state, so `planForDelete`
      // only ever returns 'delete-job' or 'replace' (never 'insert'/'noop'
      // — see its doc comment) — 順1..順4 of §10.1's table.
      for (const job of jobs) {
        const mapping = mappingByActivity.get(job.activityId) ?? null;
        const plan = planForDelete(toCurrentJobState(job), toMappingState(mapping));
        if (plan.action === 'delete-job') {
          await HealthSyncJobRepository.deleteJob(tx, job.activityId, provider); // 順1
        } else if (plan.action === 'replace') {
          await HealthSyncJobRepository.replaceJob(tx, job.activityId, provider, {
            operation: plan.operation,
            externalRecordId: mapping?.externalRecordId ?? null,
            notBefore,
          }); // 順2/3/4
        }
        mappingByActivity.delete(job.activityId); // handled above — anything left has no job (順5 candidates only)
      }

      // 順5: a mapping with no job gets a fresh delete job — batched, since
      // in the common "everything already synced, nothing pending" case
      // this is every mapping for the provider, which can be the entire
      // sync history (unlike the job-replacement loop above, bounded by
      // the outbox backlog).
      const freshDeleteJobs = Array.from(mappingByActivity.values()).map((mapping) => ({
        activityId: mapping.activityId,
        provider,
        operation: 'delete' as const,
        externalRecordId: mapping.externalRecordId,
        notBefore,
      }));
      await HealthSyncJobRepository.insertJobsBulk(tx, freshDeleteJobs);
      // 順6 (no job, no mapping) needs nothing — the bulk Activity delete below covers it.
    }

    await HealthSyncRepository.deleteAllMappings(tx); // §10.2 step 3 / §10.6 pseudocode step 2, all providers, bulk
    await ActivityRepository.deleteAllActivities(tx); // §10.6 pseudocode step 3, bulk

    for (const key of SYNC_DERIVED_SETTING_KEYS) {
      await setSetting(tx, key, null); // §10.6 "lastSyncedAt を全削除の開始時に null にする"
    }
  });
}

/** Thin, discoverable alias — see 基本設計 §17 method list. Undo has no separate DB behavior from a normal delete; §10.1 順1 (drop an unattempted create job outright) already *is* the Undo case. The 5s Undo window itself is enforced by the UI only offering this while the snackbar is visible (D-15 "Undo可能期間はSnackbar表示中"), not by this function. */
export async function undoLastRecord(db: Transactor, activityId: string): Promise<void> {
  await deleteActivity(db, activityId);
}
