/**
 * 基本設計 v0.11 §9.12・§17.3 I12/I13 — `SyncCoordinator.runExclusive` を
 * 実際の破壊的操作（`ImportService.performReplaceImport`）と `SyncWorker`
 * の組み合わせで、real SQLite に対して検証する。
 *
 * `performReplaceImport` 自身は Coordinator を意識しない
 * （`services/ImportService.ts` のコメント参照——`RecoveryService` が
 * 一時 DB に対して同じ関数を呼ぶため）。実際に Coordinator を通すのは
 * 呼び出し側（`app/settings/data.tsx`）の責務なので、ここでもそれと
 * 同じ形——`SyncCoordinator.runExclusive(() => performReplaceImport(db,
 * file))`——で呼び出す。
 *
 * `SyncCoordinator` 単体の mutex の性質そのものは
 * `services/__tests__/SyncCoordinator.test.ts`（DB非依存）で検証済み。
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
import { performReplaceImport } from '../../services/ImportService';
import { setSetting } from '../../services/SettingsRepository';
import { processNextDueJob } from '../../services/SyncWorker';
import * as SyncCoordinator from '../../services/SyncCoordinator';
import type { ExportFileV1 } from '../../types/Export';
import type { SqlExecutor } from '../../database/SqlExecutor';

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

const emptyImportFile: ExportFileV1 = {
  version: 1,
  exportedAt: '2026-09-20T00:00:00Z',
  activities: [],
  settings: {},
};

describe('SyncCoordinator.runExclusive(performReplaceImport) × SyncWorker (§9.12, I12/I13)', () => {
  it('waits for an in-flight SyncWorker external call before wiping health_sync_jobs/health_sync/activities', async () => {
    const activity = await ActivityService.recordActivity(db, {
      context: 'solo',
      instantUtc: new Date('2026-09-14T14:42:00Z'),
    });
    const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    await db.execute('UPDATE health_sync_jobs SET not_before = ? WHERE id = ?', ['2000-01-01T00:00:00Z', job!.id]);

    let resolveUpsert!: (value: { ok: true; externalRecordId: null }) => void;
    let reachedExternalCall!: () => void;
    const reachedExternalCallPromise = new Promise<void>((resolve) => {
      reachedExternalCall = resolve;
    });
    mockUpsertActivity.mockImplementation(() => {
      reachedExternalCall();
      return new Promise((resolve) => {
        resolveUpsert = resolve;
      });
    });

    const processing = processNextDueJob(db, 'health_connect');
    await reachedExternalCallPromise;

    let importResolved = false;
    const importing = SyncCoordinator.runExclusive(() => performReplaceImport(db, emptyImportFile)).then(() => {
      importResolved = true;
    });

    await Promise.resolve();
    expect(importResolved).toBe(false); // I12: must not proceed while the create job's external call is in flight

    // The Activity table has NOT been wiped yet.
    expect(await db.execute('SELECT COUNT(*) as n FROM activities')).toMatchObject({
      rows: [{ n: 1 }],
    });

    resolveUpsert({ ok: true, externalRecordId: null });
    await processing;
    await importing;

    expect(importResolved).toBe(true);
    // Now the replace-import actually ran, wiping the Activity it raced against.
    expect(await db.execute('SELECT COUNT(*) as n FROM activities')).toMatchObject({
      rows: [{ n: 0 }],
    });
  });

  it('leaves the Coordinator resumed (not stuck suspended) after a successful replace-import, so the worker can claim again afterwards', async () => {
    await SyncCoordinator.runExclusive(() => performReplaceImport(db, emptyImportFile));
    expect(SyncCoordinator.isSuspended()).toBe(false);
  });

  it('blocks the worker from claiming a NEW job while a replace-import is in progress (I13-adjacent: no new claim mid-destructive-operation)', async () => {
    // A destructive op that never returns on its own — we control when it "finishes" via resolveTransaction.
    let resolveTransaction!: () => void;
    let transactionStarted!: () => void;
    const transactionStartedPromise = new Promise<void>((resolve) => {
      transactionStarted = resolve;
    });
    const dbWithSlowTransaction: TestDb = {
      execute: (query, params) => db.execute(query, params),
      raw: db.raw,
      close: () => db.close(),
      transaction: async (fn: (tx: SqlExecutor) => Promise<void>) => {
        transactionStarted();
        await new Promise<void>((resolve) => {
          resolveTransaction = resolve;
        });
        await db.transaction(fn);
      },
    };

    const activity = await ActivityService.recordActivity(db, {
      context: 'solo',
      instantUtc: new Date('2026-09-14T14:42:00Z'),
    });
    const job = await HealthSyncJobRepository.findJob(db, activity.id, 'health_connect');
    await db.execute('UPDATE health_sync_jobs SET not_before = ? WHERE id = ?', ['2000-01-01T00:00:00Z', job!.id]);

    const importing = SyncCoordinator.runExclusive(() => performReplaceImport(dbWithSlowTransaction, emptyImportFile));
    // Wait for an actual signal that runExclusive reached the transaction,
    // rather than guessing a microtask-tick count (runExclusive's internal
    // queue chain now takes more than one tick to reach the operation).
    await transactionStartedPromise;

    expect(SyncCoordinator.isSuspended()).toBe(true);
    const result = await processNextDueJob(db, 'health_connect');
    expect(result).toEqual({ status: 'suspended' });
    expect(mockUpsertActivity).not.toHaveBeenCalled();

    resolveTransaction();
    await importing;
    expect(SyncCoordinator.isSuspended()).toBe(false);
  });

  it('does not deadlock or corrupt state when two runExclusive(performReplaceImport) calls happen back to back (serialization, finding 3)', async () => {
    const first = SyncCoordinator.runExclusive(() => performReplaceImport(db, emptyImportFile));
    const second = SyncCoordinator.runExclusive(() => performReplaceImport(db, emptyImportFile));

    await expect(Promise.all([first, second])).resolves.toBeDefined();
    expect(SyncCoordinator.isSuspended()).toBe(false);
  });
});
