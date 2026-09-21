/**
 * Exercises `services/ActivityService` against real SQLite, including the
 * job-queueing logic from §9.3/§10.1. This is the highest-value
 * integration test in the project — the join/delete tables were revisited
 * across a dozen design-review rounds specifically because they're easy
 * to get subtly wrong.
 */
import { createTestDb, type TestDb } from '../support/sqliteTestDb';
import * as ActivityService from '../../services/ActivityService';
import * as HealthSyncJobRepository from '../../repositories/HealthSyncJobRepository';
import * as HealthSyncRepository from '../../repositories/HealthSyncRepository';
import * as ActivityRepository from '../../repositories/ActivityRepository';
import { getSetting, setSetting } from '../../services/SettingsRepository';
import { addSecondsIso, nowUtcIso } from '../../lib/datetime';

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  db.close();
});

async function enableHealthConnect() {
  await setSetting(db, 'healthConnect.enabled', true);
}

describe('recordActivity', () => {
  it('persists the Activity with all §3 fields correctly derived', async () => {
    const activity = await ActivityService.recordActivity(db, {
      context: 'solo',
      instantUtc: new Date('2026-09-14T14:42:30Z'), // has seconds — must be truncated
      timezoneId: 'Asia/Tokyo',
      orgasm: true,
    });

    expect(activity.context).toBe('solo');
    expect(activity.occurredAtUtc).toBe('2026-09-14T14:42:00Z');
    expect(activity.occurredLocalDate).toBe('2026-09-14');
    expect(activity.occurredLocalTime).toBe('23:42');
    expect(activity.timezoneOffsetMinutes).toBe(540);
    expect(activity.orgasm).toBe(true);
    expect(activity.ejaculation).toBeNull();
    expect(activity.syncVersion).toBe(1);

    const reread = await ActivityRepository.findActivityById(db, activity.id);
    expect(reread).toEqual(activity);
  });

  it('does not queue a sync job when Health Connect is disabled (Phase 1 default)', async () => {
    const activity = await ActivityService.recordActivity(db, {
      context: 'solo',
      instantUtc: new Date('2026-09-14T14:42:00Z'),
      timezoneId: 'Asia/Tokyo',
    });
    const jobs = await HealthSyncJobRepository.findJobsForActivity(db, activity.id);
    expect(jobs).toHaveLength(0);
  });

  it('queues a create job, due 5 seconds after the record *action* (not the backdated occurred time), when Health Connect is enabled (D-15/D-44)', async () => {
    await enableHealthConnect();
    // A backdated entry: occurredAt is in the past, but the record action itself happens "now".
    const activity = await ActivityService.recordActivity(db, {
      context: 'partnered',
      instantUtc: new Date('2026-09-14T14:42:00Z'),
      timezoneId: 'Asia/Tokyo',
    });

    const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    expect(job).not.toBeNull();
    expect(job?.operation).toBe('create');
    expect(job?.attempts).toBe(0);
    expect(job?.claimedAt).toBeNull();
    // §9.6/D-44's 5s Undo-sync-delay is measured from createdAt (the real
    // moment of the record action), not from the possibly-backdated
    // occurredAtUtc — this activity's occurredAt is 2026-09-14 but
    // createdAt is "now" (real system time when this test ran).
    expect(job?.notBefore).toBe(addSecondsIso(activity.createdAt, 5));
    expect(job?.notBefore).not.toBe('2026-09-14T14:42:05Z');
  });
});

describe('updateActivity', () => {
  it('bumps sync_version on every edit, regardless of which field changed (D-19)', async () => {
    const activity = await ActivityService.recordActivity(db, {
      context: 'solo',
      instantUtc: new Date('2026-09-14T14:42:00Z'),
    });
    const edited = await ActivityService.updateActivity(db, activity.id, { note: 'just a note' });
    expect(edited.syncVersion).toBe(2);
    expect(edited.note).toBe('just a note');

    const editedAgain = await ActivityService.updateActivity(db, activity.id, { moodBefore: 3 });
    expect(editedAgain.syncVersion).toBe(3);
  });

  it('updates the recorded date/time together with its derived fields (D-50 Activity Detail post-hoc edit)', async () => {
    const activity = await ActivityService.recordActivity(db, {
      context: 'solo',
      instantUtc: new Date('2026-09-14T14:42:00Z'),
      timezoneId: 'Asia/Tokyo',
    });

    const edited = await ActivityService.updateActivity(db, activity.id, {
      occurredAtUtc: '2026-09-10T05:00:00Z',
      occurredLocalDate: '2026-09-10',
      occurredLocalTime: '14:00',
      timezoneOffsetMinutes: 540,
      timezoneId: 'Asia/Tokyo',
    });

    expect(edited.occurredAtUtc).toBe('2026-09-10T05:00:00Z');
    expect(edited.occurredLocalDate).toBe('2026-09-10');
    expect(edited.occurredLocalTime).toBe('14:00');
    expect(edited.timezoneOffsetMinutes).toBe(540);
    expect(edited.syncVersion).toBe(2); // D-19: bumped like any other edit
    expect(edited.context).toBe('solo'); // untouched by this patch

    const reread = await ActivityRepository.findActivityById(db, activity.id);
    expect(reread).toEqual(edited);
  });

  it('leaves an existing pending create job untouched on edit (§9.3, no payload on jobs)', async () => {
    await enableHealthConnect();
    const activity = await ActivityService.recordActivity(db, {
      context: 'solo',
      instantUtc: new Date('2026-09-14T14:42:00Z'),
    });
    const jobBefore = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');

    await ActivityService.updateActivity(db, activity.id, { note: 'edited before the job ever sent' });

    const jobAfter = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    expect(jobAfter?.id).toBe(jobBefore?.id);
    expect(jobAfter?.operation).toBe('create');
    expect(jobAfter?.revision).toBe(jobBefore?.revision); // untouched — planForEdit returns 'noop' for an existing job
  });

  it('inserts an update job for an already-synced Activity with no pending job (normal case)', async () => {
    await enableHealthConnect();
    const activity = await ActivityService.recordActivity(db, {
      context: 'solo',
      instantUtc: new Date('2026-09-14T14:42:00Z'),
    });
    // Simulate the worker having already finished the create job (Phase 4 not implemented — do it directly).
    await HealthSyncRepository.upsertMapping(db, { activityId: activity.id, provider: 'health_connect', externalRecordId: null });
    await HealthSyncJobRepository.deleteJob(db, activity.id, 'health_connect');

    await ActivityService.updateActivity(db, activity.id, { note: 'now editing a synced record' });

    const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    expect(job?.operation).toBe('update');
  });
});

describe('deleteActivity — §10.1 branching', () => {
  it('順1: drops an unattempted create job outright and removes the Activity (the Undo case)', async () => {
    await enableHealthConnect();
    const activity = await ActivityService.recordActivity(db, { context: 'solo', instantUtc: new Date('2026-09-14T14:42:00Z') });

    await ActivityService.deleteActivity(db, activity.id);

    expect(await ActivityRepository.findActivityById(db, activity.id)).toBeNull();
    expect(await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect')).toBeNull();
  });

  it('undoLastRecord is the same operation, and is idempotent (D-15 冪等)', async () => {
    const activity = await ActivityService.recordActivity(db, { context: 'solo', instantUtc: new Date('2026-09-14T14:42:00Z') });
    await ActivityService.undoLastRecord(db, activity.id);
    await expect(ActivityService.undoLastRecord(db, activity.id)).resolves.toBeUndefined(); // second tap: no-op, no throw
    expect(await ActivityRepository.findActivityById(db, activity.id)).toBeNull();
  });

  it('順2: replaces a create job with delete when attempts > 0 (may have reached the provider, D-32/D-33 scenario)', async () => {
    await enableHealthConnect();
    const activity = await ActivityService.recordActivity(db, { context: 'solo', instantUtc: new Date('2026-09-14T14:42:00Z') });
    // Simulate the worker having claimed (and thus incremented attempts on) the create job at least once.
    // Claim slightly after the job's real not_before (createdAt + 5s), which is "now" + 5s here.
    const claimAt = addSecondsIso(nowUtcIso(), 6);
    const claimed = await HealthSyncJobRepository.claimNextDueJob(db, 'health_connect', claimAt);
    expect(claimed).not.toBeNull();

    await ActivityService.deleteActivity(db, activity.id);

    expect(await ActivityRepository.findActivityById(db, activity.id)).toBeNull();
    const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    expect(job?.operation).toBe('delete');
    expect(job?.attempts).toBe(0); // reset on replace — see HealthSyncJobRepository.replaceJob doc comment
    expect(job?.claimedAt).toBeNull();
  });

  it('順2: replaces a create job with delete when a mapping already exists (external create raced ahead of a local edit/delete, D-32)', async () => {
    await enableHealthConnect();
    const activity = await ActivityService.recordActivity(db, { context: 'solo', instantUtc: new Date('2026-09-14T14:42:00Z') });
    // Simulate: the external create succeeded and the finalize step recorded the mapping,
    // but for some reason the job row is still sitting there (e.g. revision mismatch, §9.5.1).
    await HealthSyncRepository.upsertMapping(db, { activityId: activity.id, provider: 'health_connect', externalRecordId: 'hc-123' });

    await ActivityService.deleteActivity(db, activity.id);

    const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    expect(job?.operation).toBe('delete');
    expect(job?.externalRecordId).toBe('hc-123'); // carried over from the mapping so the delete can address the real record
    expect(await HealthSyncRepository.findMapping(db, activity.id, 'health_connect')).toBeNull(); // §10.2 step 3
  });

  it('順3: an update job is replaced with delete', async () => {
    await enableHealthConnect();
    const activity = await ActivityService.recordActivity(db, { context: 'solo', instantUtc: new Date('2026-09-14T14:42:00Z') });
    await HealthSyncRepository.upsertMapping(db, { activityId: activity.id, provider: 'health_connect', externalRecordId: 'hc-1' });
    await HealthSyncJobRepository.deleteJob(db, activity.id, 'health_connect');
    await HealthSyncJobRepository.insertJob(db, { activityId: activity.id, provider: 'health_connect', operation: 'update', notBefore: '2026-09-14T14:42:05Z' });

    await ActivityService.deleteActivity(db, activity.id);

    const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    expect(job?.operation).toBe('delete');
  });

  it('順5: no job but a mapping exists — inserts a fresh delete job', async () => {
    await enableHealthConnect();
    const activity = await ActivityService.recordActivity(db, { context: 'solo', instantUtc: new Date('2026-09-14T14:42:00Z') });
    await HealthSyncRepository.upsertMapping(db, { activityId: activity.id, provider: 'health_connect', externalRecordId: 'hc-9' });
    await HealthSyncJobRepository.deleteJob(db, activity.id, 'health_connect'); // simulate: create job already finalized away

    await ActivityService.deleteActivity(db, activity.id);

    const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    expect(job?.operation).toBe('delete');
    expect(job?.externalRecordId).toBe('hc-9');
  });

  it('順6: no job and no mapping — clean delete, no jobs left for any provider', async () => {
    const activity = await ActivityService.recordActivity(db, { context: 'solo', instantUtc: new Date('2026-09-14T14:42:00Z') }); // HC disabled — no job queued at all
    await ActivityService.deleteActivity(db, activity.id);
    expect(await HealthSyncJobRepository.findJobsForActivity(db, activity.id)).toHaveLength(0);
  });

  it('cleans up a leftover mapping from a now-disabled provider (D-45: disconnect does not drop pending state)', async () => {
    await enableHealthConnect();
    const activity = await ActivityService.recordActivity(db, { context: 'solo', instantUtc: new Date('2026-09-14T14:42:00Z') });
    await HealthSyncRepository.upsertMapping(db, { activityId: activity.id, provider: 'health_connect', externalRecordId: 'hc-1' });
    await HealthSyncJobRepository.deleteJob(db, activity.id, 'health_connect');
    await setSetting(db, 'healthConnect.enabled', false); // user disconnects — mapping/job history must still be honored

    await ActivityService.deleteActivity(db, activity.id);

    const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    expect(job?.operation).toBe('delete'); // still queued for cleanup even though the provider is currently off
  });
});

describe('deleteAllActivities — §10.6 bulk-applies §10.1 to every Activity', () => {
  it('removes every Activity row', async () => {
    await ActivityService.recordActivity(db, { context: 'solo', instantUtc: new Date('2026-09-14T14:42:00Z') });
    await ActivityService.recordActivity(db, { context: 'partnered', instantUtc: new Date('2026-09-15T14:42:00Z') });

    await ActivityService.deleteAllActivities(db);

    expect(await ActivityRepository.findAllActivities(db)).toHaveLength(0);
  });

  it('is a no-op when there are no Activities at all', async () => {
    await expect(ActivityService.deleteAllActivities(db)).resolves.toBeUndefined();
  });

  it('applies each Activity\'s own §10.1 branch rather than one blanket rule (順1 unattempted create dropped, 順5 mapping-only gets a fresh delete job)', async () => {
    await enableHealthConnect();
    const undoable = await ActivityService.recordActivity(db, { context: 'solo', instantUtc: new Date('2026-09-14T14:42:00Z') }); // 順1: unattempted create job
    const synced = await ActivityService.recordActivity(db, { context: 'partnered', instantUtc: new Date('2026-09-15T14:42:00Z') });
    await HealthSyncRepository.upsertMapping(db, { activityId: synced.id, provider: 'health_connect', externalRecordId: 'hc-1' });
    await HealthSyncJobRepository.deleteJob(db, synced.id, 'health_connect'); // simulate: create job already finalized away → 順5

    await ActivityService.deleteAllActivities(db);

    expect(await ActivityRepository.findAllActivities(db)).toHaveLength(0);
    expect(await HealthSyncJobRepository.findJobsForActivity(db, undoable.id)).toHaveLength(0); // 順1: dropped, not queued for external deletion
    const survivingJob = await HealthSyncJobRepository.findJob(db, synced.id, 'health_connect');
    expect(survivingJob?.operation).toBe('delete'); // 順5: a delete job survives the Activity itself so the outbox can still reach Health Connect
    expect(survivingJob?.externalRecordId).toBe('hc-1');
    expect(await HealthSyncRepository.findMapping(db, synced.id, 'health_connect')).toBeNull(); // §10.2 step 3
  });

  it('順2: a create job that may have already reached the provider (attempts > 0, no mapping yet) is replaced with delete, not dropped — the exact case §10.6 names as "同期済みだけを対象にしない"', async () => {
    await enableHealthConnect();
    const activity = await ActivityService.recordActivity(db, { context: 'solo', instantUtc: new Date('2026-09-14T14:42:00Z') });
    const claimAt = addSecondsIso(nowUtcIso(), 6);
    const claimed = await HealthSyncJobRepository.claimNextDueJob(db, 'health_connect', claimAt);
    expect(claimed).not.toBeNull(); // attempts is now 1 — an external create may have already gone out

    await ActivityService.deleteAllActivities(db);

    const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    expect(job?.operation).toBe('delete'); // not silently dropped — the provider might still have this record
    expect(job?.attempts).toBe(0); // reset on replace
    expect(job?.claimedAt).toBeNull();
  });

  it('順5 batches correctly across more than one mapping-only Activity (insertJobsBulk path, not just a single row)', async () => {
    await enableHealthConnect();
    const first = await ActivityService.recordActivity(db, { context: 'solo', instantUtc: new Date('2026-09-14T14:42:00Z') });
    const second = await ActivityService.recordActivity(db, { context: 'partnered', instantUtc: new Date('2026-09-15T14:42:00Z') });
    for (const activity of [first, second]) {
      await HealthSyncRepository.upsertMapping(db, { activityId: activity.id, provider: 'health_connect', externalRecordId: `hc-${activity.id}` });
      await HealthSyncJobRepository.deleteJob(db, activity.id, 'health_connect');
    }

    await ActivityService.deleteAllActivities(db);

    for (const activity of [first, second]) {
      const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
      expect(job?.operation).toBe('delete');
      expect(job?.externalRecordId).toBe(`hc-${activity.id}`);
    }
  });

  it('順6, not 順5: a declined mapping with no job gets no delete job (D-35 — the person explicitly chose not to sync this record, and a full delete must not override that by requesting its deletion from a provider it was never sent to)', async () => {
    await enableHealthConnect();
    const activity = await ActivityService.recordActivity(db, { context: 'solo', instantUtc: new Date('2026-09-14T14:42:00Z') });
    await HealthSyncRepository.upsertDeclinedOrUncertainMapping(db, { activityId: activity.id, provider: 'health_connect', syncState: 'declined' });
    await HealthSyncJobRepository.deleteJob(db, activity.id, 'health_connect'); // simulate: the create job itself was discarded (D-35), leaving only the 'declined' mapping row

    await ActivityService.deleteAllActivities(db);

    expect(await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect')).toBeNull();
  });

  it('順5, not 順6: an uncertain mapping with no job still gets a delete job (D-51 — unlike declined, the provider may actually hold this record)', async () => {
    await enableHealthConnect();
    const activity = await ActivityService.recordActivity(db, { context: 'solo', instantUtc: new Date('2026-09-14T14:42:00Z') });
    await HealthSyncRepository.upsertDeclinedOrUncertainMapping(db, { activityId: activity.id, provider: 'health_connect', syncState: 'uncertain' });
    await HealthSyncJobRepository.deleteJob(db, activity.id, 'health_connect');

    await ActivityService.deleteAllActivities(db);

    const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    expect(job?.operation).toBe('delete');
  });

  it('resets healthConnect.lastSyncedAt to null (§10.6 "全削除の開始時点で...以前の「Last synced」を残すと誤解を招く")', async () => {
    await enableHealthConnect();
    await setSetting(db, 'healthConnect.lastSyncedAt', '2026-09-14T14:42:00Z');
    await ActivityService.recordActivity(db, { context: 'solo', instantUtc: new Date('2026-09-14T14:42:00Z') });

    await ActivityService.deleteAllActivities(db);

    expect(await getSetting(db, 'healthConnect.lastSyncedAt')).toBeNull();
  });

  it('resets healthConnect.lastSyncedAt to null even when there is nothing to delete', async () => {
    await setSetting(db, 'healthConnect.lastSyncedAt', '2026-09-14T14:42:00Z');
    await ActivityService.deleteAllActivities(db);
    expect(await getSetting(db, 'healthConnect.lastSyncedAt')).toBeNull();
  });
});
