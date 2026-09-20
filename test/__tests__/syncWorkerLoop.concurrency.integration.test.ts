/**
 * 基本設計 v0.11 §6.2/D-36「v1 はプロセス内単一ワーカー」— この前提が
 * 崩れた場合（`drainDueJobs` が2本同時に走った場合）でも、
 * `services/SyncWorker` 自身が状態を破損させず、claim を握ったまま
 * 永久に残すこともないことを実 SQLite で検証する。
 *
 * `contexts/SyncWorkerLoop.tsx` の多重実行防止（drainingRef/rerunRef）が
 * 通常この状況自体を作らせないが（`contexts/__tests__/SyncWorkerLoop.
 * test.tsx` 参照）、ここでは「防止策の外側」——サービス層自体の
 * 防御力——を直接検証する。3回目のレビューで実際に "cannot start a
 * transaction within a transaction" を再現・報告された経路。
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
import * as HealthSyncJobRepository from '../../repositories/HealthSyncJobRepository';
import * as HealthSyncRepository from '../../repositories/HealthSyncRepository';
import { setSetting } from '../../services/SettingsRepository';
import { drainDueJobs } from '../../services/SyncWorker';
import * as SyncCoordinator from '../../services/SyncCoordinator';

let db: TestDb;

beforeEach(async () => {
  db = createTestDb();
  jest.clearAllMocks();
  await setSetting(db, 'healthConnect.enabled', true);
  SyncCoordinator.__resetSyncCoordinatorForTests();
});

afterEach(() => {
  db.close();
});

async function recordDueActivity() {
  const activity = await ActivityService.recordActivity(db, {
    context: 'solo',
    instantUtc: new Date('2026-09-14T14:42:00Z'),
  });
  const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
  await db.execute('UPDATE health_sync_jobs SET not_before = ? WHERE id = ?', ['2000-01-01T00:00:00Z', job!.id]);
  return activity;
}

it('two concurrent drainDueJobs calls against the same connection never leave a job permanently claimed, even if their native calls overlap long enough to collide at finalize', async () => {
  const a = await recordDueActivity();
  const b = await recordDueActivity();

  // Both native calls resolve at roughly the same time, so both drains'
  // finalize steps race for the same connection's transaction — this is
  // the exact shape of the race a 10s-apart periodic timer could produce
  // in production if a call runs long (D-41: no cancel, no timeout).
  let resolveA!: () => void;
  let resolveB!: () => void;
  let callCount = 0;
  mockUpsertActivity.mockImplementation(() => {
    callCount++;
    return new Promise((resolve) => {
      if (callCount === 1) resolveA = () => resolve({ ok: true, externalRecordId: null });
      else resolveB = () => resolve({ ok: true, externalRecordId: null });
    });
  });

  const drain1 = drainDueJobs(db, 'health_connect');
  const drain2 = drainDueJobs(db, 'health_connect');

  // Let both drains reach their respective claimed jobs' native calls.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  resolveA();
  resolveB();

  await Promise.all([drain1, drain2]);

  // No job may remain claimed — either it finalized successfully, or the
  // §9.6 failure-backoff path released it (SyncWorker.ts's per-job
  // try/catch, added for this exact scenario).
  for (const activity of [a, b]) {
    const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    if (job) {
      expect(job.claimedAt).toBeNull();
    }
  }

  // Every Activity ended up either fully synced (mapping recorded, job
  // gone) or queued for a normal retry (job present, not claimed) — never
  // "vanished" from both without a trace.
  for (const activity of [a, b]) {
    const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    const mapping = await HealthSyncRepository.findMapping(db, activity.id, 'health_connect');
    expect(job !== null || mapping !== null).toBe(true);
  }
});
