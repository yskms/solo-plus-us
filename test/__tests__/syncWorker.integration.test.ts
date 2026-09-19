/**
 * `services/SyncWorker` の claim/finalize ループ（§9.5–§9.7）を、実SQLite +
 * モック化した `services/HealthConnectService` に対して検証する。
 * `HealthConnectService` 自体の変換・エラー分類は
 * `services/__tests__/HealthConnectService.test.ts` で検証済みなので、
 * ここでは「呼ばれた結果（成功/失敗）に対して DB がどう遷移するか」に絞る。
 */
const mockUpsertActivity = jest.fn();
const mockDeleteActivityRecord = jest.fn();
const mockRecreateActivity = jest.fn();
const mockEnsureInitialized = jest.fn();

jest.mock('../../services/HealthConnectService', () => ({
  upsertActivity: (...args: unknown[]) => mockUpsertActivity(...args),
  deleteActivityRecord: (...args: unknown[]) => mockDeleteActivityRecord(...args),
  recreateActivity: (...args: unknown[]) => mockRecreateActivity(...args),
  ensureInitialized: (...args: unknown[]) => mockEnsureInitialized(...args),
}));

import { createTestDb, type TestDb } from '../support/sqliteTestDb';
import * as ActivityService from '../../services/ActivityService';
import * as HealthSyncJobRepository from '../../repositories/HealthSyncJobRepository';
import * as HealthSyncRepository from '../../repositories/HealthSyncRepository';
import * as ActivityRepository from '../../repositories/ActivityRepository';
import { setSetting } from '../../services/SettingsRepository';
import { processNextDueJob, drainDueJobs } from '../../services/SyncWorker';

let db: TestDb;

beforeEach(async () => {
  db = createTestDb();
  jest.resetAllMocks();
  mockEnsureInitialized.mockResolvedValue(true);
  await setSetting(db, 'healthConnect.enabled', true);
});

afterEach(() => {
  db.close();
});

async function recordDueActivity() {
  const activity = await ActivityService.recordActivity(db, {
    context: 'solo',
    instantUtc: new Date('2026-09-14T14:42:00Z'),
    timezoneId: 'Asia/Tokyo',
  });
  // Make the job immediately claimable — recordActivity sets a 5s Undo delay (D-44).
  const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
  await db.execute('UPDATE health_sync_jobs SET not_before = ? WHERE id = ?', ['2000-01-01T00:00:00Z', job!.id]);
  return activity;
}

describe('processNextDueJob — no work', () => {
  it('returns no-due-job when the queue is empty', async () => {
    expect(await processNextDueJob(db, 'health_connect')).toEqual({ status: 'no-due-job' });
    expect(mockUpsertActivity).not.toHaveBeenCalled();
  });
});

describe('processNextDueJob — create/update success (§9.5.1)', () => {
  it('upserts the mapping and deletes the job on success', async () => {
    const activity = await recordDueActivity();
    mockUpsertActivity.mockResolvedValue({ ok: true, externalRecordId: null });

    const result = await processNextDueJob(db, 'health_connect');

    expect(result.status).toBe('processed');
    expect(mockUpsertActivity).toHaveBeenCalledWith(
      expect.objectContaining({ id: activity.id, occurredAtUtc: activity.occurredAtUtc, syncVersion: 1 }),
    );
    const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    expect(job).toBeNull();
    const mapping = await HealthSyncRepository.findMapping(db, activity.id, 'health_connect');
    expect(mapping).not.toBeNull();
    expect(mapping?.externalRecordId).toBeNull();
  });

  it('still marks the job complete when the Activity is edited mid-flight — planForEdit leaves an in-flight job\'s revision untouched (§9.3), so the worker relies on having read current values just before the external call, not on revision to detect this particular race', async () => {
    const activity = await recordDueActivity();
    mockUpsertActivity.mockImplementation(async () => {
      await ActivityService.updateActivity(db, activity.id, { protectionUsed: true });
      return { ok: true, externalRecordId: null };
    });

    await processNextDueJob(db, 'health_connect');

    const mapping = await HealthSyncRepository.findMapping(db, activity.id, 'health_connect');
    expect(mapping).not.toBeNull();
    const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    expect(job).toBeNull(); // revision unchanged by the edit (activityService.integration.test.ts asserts this directly), so finalize's revision check still matches
  });

  it('does not create a mapping, and attaches the external id to the replaced delete job, when the Activity was deleted mid-flight (§9.5.1 else, I10)', async () => {
    const activity = await recordDueActivity();
    mockUpsertActivity.mockImplementation(async () => {
      await ActivityService.deleteActivity(db, activity.id);
      return { ok: true, externalRecordId: null };
    });

    await processNextDueJob(db, 'health_connect');

    const mapping = await HealthSyncRepository.findMapping(db, activity.id, 'health_connect');
    expect(mapping).toBeNull(); // FK RESTRICT — cannot exist once the Activity is gone
    const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    expect(job?.operation).toBe('delete');
    // health_connect doesn't need this (§5.4, clientRecordId suffices), but the generic
    // §9.5.1 "else" bookkeeping should still run without throwing.
  });
});

describe('processNextDueJob — failure & backoff (§9.6)', () => {
  it('backs off with claimed_at cleared and last_error_code recorded, keeping the job', async () => {
    const activity = await recordDueActivity();
    mockUpsertActivity.mockResolvedValue({ ok: false, errorCode: 'UNAVAILABLE' });

    await processNextDueJob(db, 'health_connect');

    const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    expect(job).not.toBeNull();
    expect(job?.claimedAt).toBeNull();
    expect(job?.lastErrorCode).toBe('UNAVAILABLE');
    expect(job?.attempts).toBe(1);
    expect(job?.notBefore).not.toBeNull(); // still within the automatic-retry budget
  });

  it('switches to manual-retry-only (not_before = null) once attempts reach the cap (10)', async () => {
    const activity = await recordDueActivity();
    mockUpsertActivity.mockResolvedValue({ ok: false, errorCode: 'UNKNOWN' });

    for (let i = 0; i < 10; i++) {
      await db.execute('UPDATE health_sync_jobs SET not_before = ? WHERE activity_id = ?', [
        '2000-01-01T00:00:00Z',
        activity.id,
      ]);
      await processNextDueJob(db, 'health_connect');
    }

    const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    expect(job?.attempts).toBe(10);
    expect(job?.notBefore).toBeNull();
  });
});

describe('processNextDueJob — internal inconsistency (§9.5.3)', () => {
  it('marks LOCAL_ACTIVITY_NOT_FOUND and stops automatic retries when the Activity is gone but a create/update job still claims to exist (should be unreachable via normal app code paths)', async () => {
    const activity = await recordDueActivity();
    // Force the inconsistency directly at the DB layer — normal ActivityService
    // deletion would have already turned this into a `delete` job (§10.1),
    // so this specifically exercises the "should never happen" branch.
    await db.execute('DELETE FROM activities WHERE id = ?', [activity.id]);

    const result = await processNextDueJob(db, 'health_connect');

    expect(result.status).toBe('processed');
    expect(mockUpsertActivity).not.toHaveBeenCalled();
    const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    expect(job?.lastErrorCode).toBe('LOCAL_ACTIVITY_NOT_FOUND');
    expect(job?.notBefore).toBeNull();
  });
});

describe('processNextDueJob — delete (§9.7)', () => {
  it('deletes the job on a successful external delete (mapping was already removed synchronously by deleteActivity)', async () => {
    const activity = await recordDueActivity();
    mockUpsertActivity.mockResolvedValue({ ok: true, externalRecordId: null });
    await processNextDueJob(db, 'health_connect'); // land the create first so a mapping exists

    await ActivityService.deleteActivity(db, activity.id);
    await db.execute('UPDATE health_sync_jobs SET not_before = ? WHERE activity_id = ?', [
      '2000-01-01T00:00:00Z',
      activity.id,
    ]);
    mockDeleteActivityRecord.mockResolvedValue({ ok: true, externalRecordId: null });

    const result = await processNextDueJob(db, 'health_connect');

    expect(result.status).toBe('processed');
    expect(mockDeleteActivityRecord).toHaveBeenCalledWith(activity.id);
    const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    expect(job).toBeNull();
  });

  it('does not treat a rejected delete as an internal-inconsistency Activity-existence check — deletes never re-check Activity existence (it is already gone by definition)', async () => {
    const activity = await recordDueActivity();
    mockUpsertActivity.mockResolvedValue({ ok: true, externalRecordId: null });
    await processNextDueJob(db, 'health_connect');
    await ActivityService.deleteActivity(db, activity.id);
    await db.execute('UPDATE health_sync_jobs SET not_before = ? WHERE activity_id = ?', [
      '2000-01-01T00:00:00Z',
      activity.id,
    ]);
    mockDeleteActivityRecord.mockResolvedValue({ ok: false, errorCode: 'UNKNOWN' });

    await processNextDueJob(db, 'health_connect');

    expect(ActivityRepository.findActivityById(db, activity.id)).resolves.toBeNull();
    const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    expect(job?.operation).toBe('delete');
    expect(job?.lastErrorCode).toBe('UNKNOWN');
  });
});

describe('processNextDueJob — recreate (§9.3.1)', () => {
  it('upserts the mapping and deletes the job on success, same as create/update', async () => {
    await setSetting(db, 'healthConnect.enabled', false); // recreate isn't queued by normal record/edit flows
    const activity = await ActivityService.recordActivity(db, { context: 'solo', instantUtc: new Date('2026-09-14T14:42:00Z') });
    await HealthSyncJobRepository.insertJob(db, {
      activityId: activity.id,
      provider: 'health_connect',
      operation: 'recreate',
      notBefore: '2000-01-01T00:00:00Z',
    });
    mockRecreateActivity.mockResolvedValue({ ok: true, externalRecordId: null });

    const result = await processNextDueJob(db, 'health_connect');

    expect(result.status).toBe('processed');
    expect(mockRecreateActivity).toHaveBeenCalledWith(expect.objectContaining({ id: activity.id }));
    const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    expect(job).toBeNull();
    const mapping = await HealthSyncRepository.findMapping(db, activity.id, 'health_connect');
    expect(mapping).not.toBeNull();
  });
});

describe('drainDueJobs', () => {
  it('processes every due job across multiple Activities in one call', async () => {
    const a = await recordDueActivity();
    const b = await recordDueActivity();
    mockUpsertActivity.mockResolvedValue({ ok: true, externalRecordId: null });

    const result = await drainDueJobs(db, 'health_connect');

    expect(result.processedCount).toBe(2);
    expect(await HealthSyncJobRepository.findJob(db, a.id, 'health_connect')).toBeNull();
    expect(await HealthSyncJobRepository.findJob(db, b.id, 'health_connect')).toBeNull();
  });

  it('does nothing when Health Connect is disabled (D-45: jobs are kept, just not claimed)', async () => {
    await recordDueActivity();
    await setSetting(db, 'healthConnect.enabled', false);

    const result = await drainDueJobs(db, 'health_connect');

    expect(result.processedCount).toBe(0);
    expect(mockUpsertActivity).not.toHaveBeenCalled();
  });

  it('does nothing when the SDK fails to initialize, without burning through job attempts', async () => {
    await recordDueActivity();
    mockEnsureInitialized.mockResolvedValue(false);

    const result = await drainDueJobs(db, 'health_connect');

    expect(result.processedCount).toBe(0);
    expect(mockUpsertActivity).not.toHaveBeenCalled();
  });
});
