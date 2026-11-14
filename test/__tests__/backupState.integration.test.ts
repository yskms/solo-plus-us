/**
 * D-58: the device-local "last export" record and the data the Home reminder
 * card reads. Real SQLite, so the SQL (MIN(created_at)) and the settings round
 * trip are exercised, not just the pure rule in lib/backupReminder.ts.
 */
import { createTestDb, type TestDb } from '../support/sqliteTestDb';
import * as ActivityRepository from '../../repositories/ActivityRepository';
import { deleteAllActivities } from '../../services/ActivityService';
import { buildExportPayload, serializeExportFile } from '../../services/ExportService';
import { performReplaceImport } from '../../services/ImportService';
import { validateExportFile } from '../../services/importValidation';
import { getSetting, setSetting } from '../../services/SettingsRepository';
import { loadBackupState, recordBackupReminderHandled, recordJsonExport } from '../../services/BackupStateService';
import { isValidUtcIso } from '../../lib/datetime';

let db: TestDb;
let otherDb: TestDb;

beforeEach(() => {
  db = createTestDb();
  otherDb = createTestDb();
});

afterEach(() => {
  db.close();
  otherDb.close();
});

async function addActivity(target: TestDb): Promise<void> {
  await ActivityRepository.createActivity(target, {
    context: 'solo',
    occurredAtUtc: '2026-09-14T14:42:00Z',
    occurredLocalDate: '2026-09-14',
    occurredLocalTime: '23:42',
    timezoneOffsetMinutes: 540,
    timezoneId: 'Asia/Tokyo',
  });
}

describe('BackupStateService', () => {
  it('starts as never exported, never handled, and no records', async () => {
    expect(await loadBackupState(db)).toEqual({ lastExportedAt: null, reminderDismissedAt: null, oldestRecordCreatedAt: null });
  });

  it('stamps the last JSON export as a UTC ISO time', async () => {
    await recordJsonExport(db);
    const { lastExportedAt, reminderDismissedAt } = await loadBackupState(db);
    expect(isValidUtcIso(lastExportedAt)).toBe(true);
    expect(reminderDismissedAt).toBeNull();
  });

  it('stamps the reminder as handled without touching the export time', async () => {
    await recordBackupReminderHandled(db);
    const { lastExportedAt, reminderDismissedAt } = await loadBackupState(db);
    expect(lastExportedAt).toBeNull();
    expect(isValidUtcIso(reminderDismissedAt)).toBe(true);
  });

  it('reports when the oldest record was created', async () => {
    await addActivity(db);
    const { oldestRecordCreatedAt } = await loadBackupState(db);
    expect(isValidUtcIso(oldestRecordCreatedAt)).toBe(true);
  });
});

describe('backup.* settings are device-owned', () => {
  it('are not written into an export file', async () => {
    await recordJsonExport(db);
    await recordBackupReminderHandled(db);
    const file = await buildExportPayload(db);
    expect(Object.keys(file.settings).filter((key) => key.startsWith('backup.'))).toEqual([]);
  });

  it('survive a replace-restore untouched', async () => {
    await setSetting(otherDb, 'backup.lastExportedAt', '2026-01-01T00:00:00Z');
    await setSetting(otherDb, 'backup.reminderDismissedAt', '2026-02-02T00:00:00Z');

    const exportFile = await buildExportPayload(db);
    const validated = validateExportFile(JSON.parse(serializeExportFile(exportFile)));
    if (!validated.valid) throw new Error('unexpected invalid export');
    await performReplaceImport(otherDb, validated.file);

    expect(await getSetting(otherDb, 'backup.lastExportedAt')).toBe('2026-01-01T00:00:00Z');
    expect(await getSetting(otherDb, 'backup.reminderDismissedAt')).toBe('2026-02-02T00:00:00Z');
  });

  it('survive delete-all (D-58: kept on purpose; the reminder floors its baseline at the oldest record instead)', async () => {
    await addActivity(db);
    await setSetting(db, 'backup.lastExportedAt', '2026-01-01T00:00:00Z');
    await setSetting(db, 'backup.reminderDismissedAt', '2026-02-02T00:00:00Z');

    await deleteAllActivities(db);

    expect(await getSetting(db, 'backup.lastExportedAt')).toBe('2026-01-01T00:00:00Z');
    expect(await getSetting(db, 'backup.reminderDismissedAt')).toBe('2026-02-02T00:00:00Z');
    expect((await loadBackupState(db)).oldestRecordCreatedAt).toBeNull();
  });
});
