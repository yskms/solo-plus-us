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
import type { SqlExecutor } from '../../database/SqlExecutor';

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

describe('claimNextDueJob', () => {
  it('returns null (not LOST_CLAIM_RACE) when there is simply no due job', async () => {
    expect(await HealthSyncJobRepository.claimNextDueJob(db, 'health_connect')).toBeNull();
  });

  it('returns LOST_CLAIM_RACE, distinguishable from null, when the row was claimed/replaced between the SELECT and the UPDATE', async () => {
    const activity = await makeActivity();
    const inserted = await HealthSyncJobRepository.insertJob(db, {
      activityId: activity.id,
      provider: 'health_connect',
      operation: 'create',
      notBefore: '2026-09-14T14:42:05Z',
    });

    // claimNextDueJob runs a SELECT (find the due row) then an UPDATE (claim
    // it, gated on the revision the SELECT just read). Bumping the revision
    // *before* calling it would just make the SELECT see the new value and
    // the UPDATE succeed — no race. To actually exercise the race, this
    // executor wrapper injects a concurrent claim right after the SELECT
    // runs but before claimNextDueJob's own UPDATE does.
    let sawSelect = false;
    const racingExecutor: SqlExecutor = {
      execute: async (query, params) => {
        const result = await db.execute(query, params);
        if (!sawSelect && /^\s*SELECT/i.test(query)) {
          sawSelect = true;
          await db.execute('UPDATE health_sync_jobs SET revision = revision + 1 WHERE id = ?', [inserted.id]);
        }
        return result;
      },
    };

    const result = await HealthSyncJobRepository.claimNextDueJob(
      racingExecutor,
      'health_connect',
      '2026-09-14T14:42:10Z',
    );

    expect(result).toBe(HealthSyncJobRepository.LOST_CLAIM_RACE);
    expect(result).not.toBeNull();
  });
});

describe('releaseClaimForResend', () => {
  it('clears the claim and sets not_before, bumping revision, without deleting the job', async () => {
    const activity = await makeActivity();
    const inserted = await HealthSyncJobRepository.insertJob(db, {
      activityId: activity.id,
      provider: 'health_connect',
      operation: 'create',
      notBefore: '2026-09-14T14:42:05Z',
    });
    const claimed = await HealthSyncJobRepository.claimNextDueJob(db, 'health_connect', '2026-09-14T14:42:10Z');
    if (!claimed || claimed === HealthSyncJobRepository.LOST_CLAIM_RACE) throw new Error('setup failed');

    const released = await HealthSyncJobRepository.releaseClaimForResend(
      db,
      claimed.id,
      claimed.revision,
      '2026-09-14T14:42:11Z',
    );

    expect(released).toBe(true);
    const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    expect(job?.operation).toBe('create'); // untouched — still needs resending
    expect(job?.claimedAt).toBeNull();
    expect(job?.notBefore).toBe('2026-09-14T14:42:11Z');
    expect(job?.revision).toBe(claimed.revision + 1);
  });

  it('returns false and changes nothing on revision mismatch', async () => {
    const activity = await makeActivity();
    const inserted = await HealthSyncJobRepository.insertJob(db, {
      activityId: activity.id,
      provider: 'health_connect',
      operation: 'create',
      notBefore: '2026-09-14T14:42:05Z',
    });

    const released = await HealthSyncJobRepository.releaseClaimForResend(
      db,
      inserted.id,
      inserted.revision + 1, // wrong revision
      '2026-09-14T14:42:11Z',
    );

    expect(released).toBe(false);
    const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    expect(job?.notBefore).toBe('2026-09-14T14:42:05Z'); // untouched
  });
});
