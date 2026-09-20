/**
 * 基本設計 v0.11 §5/§9.1・設計判断記録 D-51 — `health_sync` の
 * `sync_state` 周りの Repository 動作を実 SQLite で検証する。
 */
import { createTestDb, type TestDb } from '../support/sqliteTestDb';
import * as ActivityRepository from '../../repositories/ActivityRepository';
import * as HealthSyncRepository from '../../repositories/HealthSyncRepository';

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

describe('upsertMapping (§9.5.1 finalize — always sync_state=synced)', () => {
  it('inserts a fresh row with sync_state=synced', async () => {
    const activity = await makeActivity();
    await HealthSyncRepository.upsertMapping(db, {
      activityId: activity.id,
      provider: 'health_connect',
      externalRecordId: null,
    });

    const mapping = await HealthSyncRepository.findMapping(db, activity.id, 'health_connect');
    expect(mapping?.syncState).toBe('synced');
    expect(mapping?.externalRecordId).toBeNull();
    expect(mapping?.lastSyncedAt).not.toBeNull();
  });

  it('moves an existing uncertain/declined row back to synced on a real confirmed sync (the exact bug this must not regress into)', async () => {
    const activity = await makeActivity();
    await HealthSyncRepository.upsertDeclinedOrUncertainMapping(db, {
      activityId: activity.id,
      provider: 'health_connect',
      syncState: 'uncertain',
    });
    expect((await HealthSyncRepository.findMapping(db, activity.id, 'health_connect'))?.syncState).toBe('uncertain');

    await HealthSyncRepository.upsertMapping(db, {
      activityId: activity.id,
      provider: 'health_connect',
      externalRecordId: 'hc-123',
    });

    const mapping = await HealthSyncRepository.findMapping(db, activity.id, 'health_connect');
    expect(mapping?.syncState).toBe('synced');
    expect(mapping?.externalRecordId).toBe('hc-123');
    expect(mapping?.lastSyncedAt).not.toBeNull();
  });
});

describe('upsertDeclinedOrUncertainMapping (D-51 discard flow)', () => {
  it('inserts a fresh row with NULL external_record_id/last_synced_at — nothing to preserve yet', async () => {
    const activity = await makeActivity();
    await HealthSyncRepository.upsertDeclinedOrUncertainMapping(db, {
      activityId: activity.id,
      provider: 'health_connect',
      syncState: 'declined',
    });

    const mapping = await HealthSyncRepository.findMapping(db, activity.id, 'health_connect');
    expect(mapping).toEqual({
      activityId: activity.id,
      provider: 'health_connect',
      externalRecordId: null,
      syncState: 'declined',
      lastSyncedAt: null,
    });
  });

  it('preserves an existing external_record_id/last_synced_at from a prior synced mapping — only sync_state changes', async () => {
    const activity = await makeActivity();
    await HealthSyncRepository.upsertMapping(db, {
      activityId: activity.id,
      provider: 'health_connect',
      externalRecordId: 'hc-456',
    });
    const before = await HealthSyncRepository.findMapping(db, activity.id, 'health_connect');

    await HealthSyncRepository.upsertDeclinedOrUncertainMapping(db, {
      activityId: activity.id,
      provider: 'health_connect',
      syncState: 'uncertain',
    });

    const after = await HealthSyncRepository.findMapping(db, activity.id, 'health_connect');
    expect(after?.syncState).toBe('uncertain');
    expect(after?.externalRecordId).toBe('hc-456'); // preserved — a future defensive delete may need it (§5.4)
    expect(after?.lastSyncedAt).toBe(before?.lastSyncedAt); // preserved — historically true fact
  });

  it('can move from declined to uncertain and back — sync_state alone tracks the latest discard outcome', async () => {
    const activity = await makeActivity();
    await HealthSyncRepository.upsertDeclinedOrUncertainMapping(db, {
      activityId: activity.id,
      provider: 'health_connect',
      syncState: 'declined',
    });
    await HealthSyncRepository.upsertDeclinedOrUncertainMapping(db, {
      activityId: activity.id,
      provider: 'health_connect',
      syncState: 'uncertain',
    });

    expect((await HealthSyncRepository.findMapping(db, activity.id, 'health_connect'))?.syncState).toBe('uncertain');
  });
});
