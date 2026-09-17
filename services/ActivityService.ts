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
 * actually sends a queued job to a provider — are Phase 4 and don't exist
 * yet. In Phase 1, `healthConnect.enabled` is always `false` (no UI sets
 * it yet), so in practice no job rows are created; the queueing logic
 * below is still real and tested so Phase 4 only has to add the sender.
 */
import { buildOccurredAtFields, getDeviceTimeZoneId, addSecondsIso, nowUtcIso } from '../lib/datetime';
import * as ActivityRepository from '../repositories/ActivityRepository';
import * as HealthSyncRepository from '../repositories/HealthSyncRepository';
import * as HealthSyncJobRepository from '../repositories/HealthSyncJobRepository';
import type { SqlExecutor, Transactor } from '../database/SqlExecutor';
import { getSetting } from './SettingsRepository';
import { planForDelete, planForEdit, planForRecord, toCurrentJobState } from './syncJobPlanner';
import type { Activity, ActivityUpdateInput } from '../types/Activity';
import type { Provider } from '../types/HealthSync';

/** Every provider this app knows about, regardless of whether it's currently enabled — §10 delete cleanup must check all of them (a disabled provider can still hold a leftover mapping, D-45). */
const ALL_PROVIDERS: readonly Provider[] = ['health_connect', 'healthkit'];

/** §9.6/D-45: only providers the user has turned on get *new* jobs queued on record/edit. HealthKit has no settings toggle yet (not implemented), so it's never active in Phase 1. */
async function getActiveProviders(executor: SqlExecutor): Promise<Provider[]> {
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
      const plan = planForEdit(toCurrentJobState(job), mapping !== null);
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
 * Naturally idempotent: calling this twice on an already-deleted id is a
 * no-op (every read comes back empty, every plan is 'noop', the final
 * DELETE affects zero rows) — this is what makes `undoLastRecord` safe to
 * tap more than once (D-15 "冪等に実装する").
 */
export async function deleteActivity(db: Transactor, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    for (const provider of ALL_PROVIDERS) {
      const [job, mapping] = await Promise.all([
        HealthSyncJobRepository.findJob(tx, id, provider),
        HealthSyncRepository.findMapping(tx, id, provider),
      ]);
      const mappingExists = mapping !== null;
      const plan = planForDelete(toCurrentJobState(job), mappingExists);

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
  });
}

/** Thin, discoverable alias — see 基本設計 §17 method list. Undo has no separate DB behavior from a normal delete; §10.1 順1 (drop an unattempted create job outright) already *is* the Undo case. The 5s Undo window itself is enforced by the UI only offering this while the snackbar is visible (D-15 "Undo可能期間はSnackbar表示中"), not by this function. */
export async function undoLastRecord(db: Transactor, activityId: string): Promise<void> {
  await deleteActivity(db, activityId);
}
