/**
 * §9.5.1/D-32 "else" branch — attaching the external id to a delete job
 * after the Activity was deleted mid-flight. Exercises against real
 * SQLite specifically because the original implementation's bug (gating
 * on a revision that `replaceJob` always bumps) only shows up once you
 * actually run the two statements in the sequence the real flow does.
 */
import { createTestDb, type TestDb } from '../support/sqliteTestDb';
import * as ActivityRepository from '../../repositories/ActivityRepository';
import * as HealthSyncJobRepository from '../../repositories/HealthSyncJobRepository';

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  db.close();
});

async function makeActivity() {
  return ActivityRepository.createActivity(db, {
    context: 'solo',
    occurredAtUtc: '2026-09-14T14:42:00Z',
    occurredLocalDate: '2026-09-14',
    occurredLocalTime: '23:42',
    timezoneOffsetMinutes: 540,
    timezoneId: 'Asia/Tokyo',
  });
}

describe('attachExternalIdToDeleteJob', () => {
  it('attaches the id to a delete job, even after replaceJob has bumped its revision past what a claim-time caller would have captured', async () => {
    const activity = await makeActivity();
    const inserted = await HealthSyncJobRepository.insertJob(db, {
      activityId: activity.id,
      provider: 'health_connect',
      operation: 'create',
      notBefore: '2026-09-14T14:42:05Z',
    });
    const revisionAtClaim = inserted.revision; // what a worker would have captured before the Activity was deleted out from under it

    // Simulate the real sequence: the Activity gets deleted mid-flight,
    // which replaces the job with `delete` and bumps its revision.
    await HealthSyncJobRepository.replaceJob(db, activity.id, 'health_connect', {
      operation: 'delete',
      notBefore: '2026-09-14T14:42:06Z',
    });

    const attached = await HealthSyncJobRepository.attachExternalIdToDeleteJob(db, inserted.id, 'hc-external-123');
    expect(attached).toBe(true);

    const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    expect(job?.operation).toBe('delete');
    expect(job?.externalRecordId).toBe('hc-external-123');
    expect(job?.revision).not.toBe(revisionAtClaim); // confirms this really did race a revision bump, and still worked
  });

  it('does not overwrite an external id the job already has', async () => {
    const activity = await makeActivity();
    const inserted = await HealthSyncJobRepository.insertJob(db, {
      activityId: activity.id,
      provider: 'health_connect',
      operation: 'delete',
      externalRecordId: 'already-set',
      notBefore: '2026-09-14T14:42:05Z',
    });

    const attached = await HealthSyncJobRepository.attachExternalIdToDeleteJob(db, inserted.id, 'should-not-apply');
    expect(attached).toBe(false);

    const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    expect(job?.externalRecordId).toBe('already-set');
  });

  it('is a no-op if the job is not (or no longer) a delete job', async () => {
    const activity = await makeActivity();
    const inserted = await HealthSyncJobRepository.insertJob(db, {
      activityId: activity.id,
      provider: 'health_connect',
      operation: 'create',
      notBefore: '2026-09-14T14:42:05Z',
    });

    const attached = await HealthSyncJobRepository.attachExternalIdToDeleteJob(db, inserted.id, 'hc-1');
    expect(attached).toBe(false);
  });
});
