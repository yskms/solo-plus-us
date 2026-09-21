/**
 * 設計判断記録 D-51 — Settings「破棄」（`discardSyncJob`）を実 SQLite で
 * 検証する。単体の挙動だけでなく、「破棄した後どうなるか」を
 * `ActivityService`/`SyncWorker` と組み合わせた end-to-end で検証する
 * ——D-51 がそもそも解決しようとした問題（discard 後の delete が防御的
 * cleanup を落とす、discard 後の edit が再同期を試みない）そのもの。
 */
const mockUpsertActivity = jest.fn();

jest.mock('../../services/HealthConnectService', () => ({
  upsertActivity: (...args: unknown[]) => mockUpsertActivity(...args),
  deleteActivityRecord: jest.fn(),
  recreateActivity: jest.fn(),
  ensureInitialized: jest.fn().mockResolvedValue(true),
}));

import { createTestDb, type TestDb } from '../support/sqliteTestDb';
import * as ActivityService from '../../services/ActivityService';
import * as ActivityRepository from '../../repositories/ActivityRepository';
import * as HealthSyncJobRepository from '../../repositories/HealthSyncJobRepository';
import * as HealthSyncRepository from '../../repositories/HealthSyncRepository';
import { discardSyncJob } from '../../services/HealthSyncManualActions';
import { setSetting } from '../../services/SettingsRepository';
import { processNextDueJob } from '../../services/SyncWorker';

let db: TestDb;

beforeEach(async () => {
  db = createTestDb();
  jest.clearAllMocks();
  await setSetting(db, 'healthConnect.enabled', true);
});

afterEach(() => {
  db.close();
});

async function recordActivityWithCreateJob() {
  const activity = await ActivityService.recordActivity(db, {
    context: 'solo',
    instantUtc: new Date('2026-09-14T14:42:00Z'),
  });
  const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
  return { activity, job: job! };
}

describe('discardSyncJob — create job', () => {
  it('attempts=0 → declined: the job is removed and health_sync records "declined"', async () => {
    const { activity, job } = await recordActivityWithCreateJob();
    expect(job.attempts).toBe(0);

    const result = await discardSyncJob(db, job.id);

    expect(result).toBe('discarded');
    expect(await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect')).toBeNull();
    const mapping = await HealthSyncRepository.findMapping(db, activity.id, 'health_connect');
    expect(mapping?.syncState).toBe('declined');
    expect(mapping?.externalRecordId).toBeNull();
    expect(mapping?.lastSyncedAt).toBeNull();
  });

  it('attempts>0 → uncertain: "may have reached the provider" is preserved for a future defensive delete', async () => {
    const { activity, job } = await recordActivityWithCreateJob();
    // Simulate a claim/failure cycle so attempts > 0, then make it due and unclaimed again.
    await db.execute('UPDATE health_sync_jobs SET attempts = 1, claimed_at = NULL WHERE id = ?', [job.id]);

    const result = await discardSyncJob(db, job.id);

    expect(result).toBe('discarded');
    const mapping = await HealthSyncRepository.findMapping(db, activity.id, 'health_connect');
    expect(mapping?.syncState).toBe('uncertain');
  });

  it('refuses a claimed job (D-39) and leaves everything untouched', async () => {
    const { activity, job } = await recordActivityWithCreateJob();
    await db.execute('UPDATE health_sync_jobs SET claimed_at = ? WHERE id = ?', ['2026-09-14T14:42:05Z', job.id]);

    const result = await discardSyncJob(db, job.id);

    expect(result).toBe('not-found-or-claimed');
    expect(await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect')).not.toBeNull();
    expect(await HealthSyncRepository.findMapping(db, activity.id, 'health_connect')).toBeNull();
  });

  it('returns not-found-or-claimed for a job id that does not exist', async () => {
    await expect(discardSyncJob(db, 'nonexistent-job-id')).resolves.toBe('not-found-or-claimed');
  });
});

describe('discardSyncJob — update job (regression: this job\'s own attempts is not enough, レビューで実際に再現・修正)', () => {
  it('attempts=0, but a prior mapping was already synced → uncertain, NOT declined (the record may well already be on the provider from an earlier create)', async () => {
    const { activity, job } = await recordActivityWithCreateJob();
    // Land the original create for real, so a confirmed `synced` mapping with a real external id exists.
    mockUpsertActivity.mockResolvedValue({ ok: true, externalRecordId: null });
    await db.execute('UPDATE health_sync_jobs SET not_before = ? WHERE id = ?', ['2000-01-01T00:00:00Z', job.id]);
    await processNextDueJob(db, 'health_connect');
    expect((await HealthSyncRepository.findMapping(db, activity.id, 'health_connect'))?.syncState).toBe('synced');

    // An unrelated edit queues an update job — never attempted yet.
    await ActivityService.updateActivity(db, activity.id, { protectionUsed: true });
    const updateJob = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    expect(updateJob?.operation).toBe('update');
    expect(updateJob?.attempts).toBe(0);

    const result = await discardSyncJob(db, updateJob!.id);

    expect(result).toBe('discarded');
    const mapping = await HealthSyncRepository.findMapping(db, activity.id, 'health_connect');
    // This job's own attempts (0) alone would wrongly say "declined" (definitely never
    // reached the provider) — but the PRIOR create really did reach it, so the record
    // must stay flagged as at-least-uncertain, not silently become "definitely not there".
    expect(mapping?.syncState).toBe('uncertain');
  });
});

describe('discardSyncJob — delete job', () => {
  it('does not touch health_sync (the Activity is already gone by definition)', async () => {
    const { activity, job } = await recordActivityWithCreateJob();
    mockUpsertActivity.mockResolvedValue({ ok: true, externalRecordId: null });
    await db.execute('UPDATE health_sync_jobs SET not_before = ? WHERE id = ?', ['2000-01-01T00:00:00Z', job.id]);
    await processNextDueJob(db, 'health_connect'); // land the create so a mapping exists
    await ActivityService.deleteActivity(db, activity.id);
    const deleteJob = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    expect(deleteJob?.operation).toBe('delete');

    const result = await discardSyncJob(db, deleteJob!.id);

    expect(result).toBe('discarded');
    expect(await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect')).toBeNull();
    expect(await HealthSyncRepository.findMapping(db, activity.id, 'health_connect')).toBeNull();
  });
});

describe('discardSyncJob — internal inconsistency (§9.5.3)', () => {
  it('deletes the job without attempting a health_sync write (Activity already gone, FK would reject it anyway)', async () => {
    const { activity, job } = await recordActivityWithCreateJob();
    // Force the §9.5.3 state directly: Activity gone, job still claims to exist.
    await db.execute('DELETE FROM activities WHERE id = ?', [activity.id]);
    await db.execute("UPDATE health_sync_jobs SET last_error_code = 'LOCAL_ACTIVITY_NOT_FOUND' WHERE id = ?", [job.id]);

    const result = await discardSyncJob(db, job.id);

    expect(result).toBe('discarded');
    expect(await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect')).toBeNull();
  });
});

describe('D-51 end-to-end: discard → delete produces defensive cleanup (the original motivating scenario)', () => {
  it('an uncertain create-discard, followed by deleting the Activity, still queues a delete job (§10.1 順5)', async () => {
    const { activity, job } = await recordActivityWithCreateJob();
    await db.execute('UPDATE health_sync_jobs SET attempts = 1, claimed_at = NULL WHERE id = ?', [job.id]);
    await discardSyncJob(db, job.id);
    expect(await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect')).toBeNull(); // no job right now

    await ActivityService.deleteActivity(db, activity.id);

    // Before D-51, planForDelete(null, false) saw nothing to do (§10.1 順6) — the
    // whole point of `uncertain` is that this now queues a defensive delete instead.
    const deleteJob = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    expect(deleteJob?.operation).toBe('delete');
  });

  it('a declined create-discard, followed by deleting the Activity, does NOT queue a delete job (definitely never reached the provider)', async () => {
    const { activity, job } = await recordActivityWithCreateJob();
    expect(job.attempts).toBe(0);
    await discardSyncJob(db, job.id);

    await ActivityService.deleteActivity(db, activity.id);

    expect(await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect')).toBeNull();
  });
});

describe('D-51 end-to-end: edit never silently resumes syncing after either discard outcome (corrected in review — see syncJobPlanner.ts planForEdit doc comment)', () => {
  it('editing an uncertain record does NOT queue any job — same D-35 confirmation text as declined, so the same "stays stopped" behavior applies', async () => {
    const { activity, job } = await recordActivityWithCreateJob();
    await db.execute('UPDATE health_sync_jobs SET attempts = 1, claimed_at = NULL WHERE id = ?', [job.id]);
    await discardSyncJob(db, job.id);
    expect((await HealthSyncRepository.findMapping(db, activity.id, 'health_connect'))?.syncState).toBe('uncertain');

    await ActivityService.updateActivity(db, activity.id, { protectionUsed: true });

    expect(await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect')).toBeNull();
    // The mapping itself is untouched by the edit — still uncertain, not silently upgraded or downgraded.
    expect((await HealthSyncRepository.findMapping(db, activity.id, 'health_connect'))?.syncState).toBe('uncertain');
  });

  it('editing a declined record does NOT queue any job — D-35\'s opt-out is not silently overridden', async () => {
    const { activity, job } = await recordActivityWithCreateJob();
    await discardSyncJob(db, job.id);
    expect((await HealthSyncRepository.findMapping(db, activity.id, 'health_connect'))?.syncState).toBe('declined');

    await ActivityService.updateActivity(db, activity.id, { protectionUsed: true });

    expect(await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect')).toBeNull();
    expect(await ActivityRepository.findActivityById(db, activity.id)).not.toBeNull(); // sanity: the edit itself still applied
  });
});

describe('D-51 regression (found in review): confirmed sync → edit → immediate discard → local delete must still clean up', () => {
  it('a record that was genuinely synced, then edited and the resulting update job discarded before ever being attempted, still gets a defensive delete job when the Activity is deleted', async () => {
    const { activity, job } = await recordActivityWithCreateJob();
    mockUpsertActivity.mockResolvedValue({ ok: true, externalRecordId: 'HC-REAL-123' });
    await db.execute('UPDATE health_sync_jobs SET not_before = ? WHERE id = ?', ['2000-01-01T00:00:00Z', job.id]);
    await processNextDueJob(db, 'health_connect');
    const confirmedMapping = await HealthSyncRepository.findMapping(db, activity.id, 'health_connect');
    expect(confirmedMapping?.syncState).toBe('synced');

    await ActivityService.updateActivity(db, activity.id, { protectionUsed: true });
    const updateJob = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    expect(updateJob?.attempts).toBe(0); // never even attempted

    const discardResult = await discardSyncJob(db, updateJob!.id);
    expect(discardResult).toBe('discarded');
    // Not declined — a real, confirmed create already reached Health Connect.
    expect((await HealthSyncRepository.findMapping(db, activity.id, 'health_connect'))?.syncState).toBe('uncertain');

    await ActivityService.deleteActivity(db, activity.id);

    const deleteJob = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    expect(deleteJob?.operation).toBe('delete'); // the defensive cleanup this whole design exists for
  });
});
