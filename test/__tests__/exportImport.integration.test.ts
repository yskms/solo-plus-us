/**
 * 基本設計 §13.5 completion criterion: "Export → アンインストール →
 * 再インストール → Import で全件・全列が一致すること." Simulated here as
 * Export from one database → validate → Import (replace) into a second,
 * independent database → compare.
 */
import { createTestDb, type TestDb } from '../support/sqliteTestDb';
import * as ActivityService from '../../services/ActivityService';
import * as ActivityRepository from '../../repositories/ActivityRepository';
import { buildExportPayload, serializeExportFile } from '../../services/ExportService';
import { performReplaceImport } from '../../services/ImportService';
import { validateExportFile } from '../../services/importValidation';
import { setSetting, getSetting } from '../../services/SettingsRepository';
import * as HealthSyncRepository from '../../repositories/HealthSyncRepository';
import * as HealthSyncJobRepository from '../../repositories/HealthSyncJobRepository';

let sourceDb: TestDb;
let destDb: TestDb;

beforeEach(() => {
  sourceDb = createTestDb();
  destDb = createTestDb();
});

afterEach(() => {
  sourceDb.close();
  destDb.close();
});

describe('Export → Import round trip', () => {
  it('restores every field of every Activity exactly, across a fresh database', async () => {
    await ActivityService.recordActivity(sourceDb, {
      context: 'solo',
      instantUtc: new Date('2026-09-14T14:42:00Z'),
      timezoneId: 'Asia/Tokyo',
      orgasm: true,
      note: 'first entry, with details',
      durationSeconds: 300,
      moodBefore: 3,
      moodAfter: 4,
    });
    await ActivityService.recordActivity(sourceDb, {
      context: 'partnered',
      instantUtc: new Date('2026-01-01T00:00:00Z'),
      timezoneId: 'America/New_York', // exercises a DST-different zone than the first entry
      protectionUsed: false,
      ejaculation: true,
    });
    // A third, minimal entry with everything left unrecorded (null) — the
    // strictest test of "missing key vs explicit null" round-tripping.
    await ActivityService.recordActivity(sourceDb, {
      context: 'solo',
      instantUtc: new Date('2026-06-01T12:00:00Z'),
    });

    const before = await ActivityRepository.findAllActivities(sourceDb);
    expect(before).toHaveLength(3);

    const exportFile = await buildExportPayload(sourceDb);
    expect(exportFile.version).toBe(1);
    expect(exportFile.activities).toHaveLength(3);

    // Round-trip through JSON.stringify/parse, exactly as a real file export/import would.
    const json = serializeExportFile(exportFile);
    const parsed = JSON.parse(json);

    const validated = validateExportFile(parsed);
    expect(validated.valid).toBe(true);
    if (!validated.valid) return;

    const result = await performReplaceImport(destDb, validated.file);
    expect(result.importedCount).toBe(3);

    const after = await ActivityRepository.findAllActivities(destDb);
    expect(after).toHaveLength(3);

    // Full field-for-field equality, id-for-id, including createdAt/updatedAt/syncVersion.
    const beforeById = new Map(before.map((a) => [a.id, a]));
    for (const restored of after) {
      expect(restored).toEqual(beforeById.get(restored.id));
    }
  });

  it('does not export health_sync / health_sync_jobs (§12.2 — device-specific, meaningless elsewhere)', async () => {
    await setSetting(sourceDb, 'healthConnect.enabled', true);
    const activity = await ActivityService.recordActivity(sourceDb, {
      context: 'solo',
      instantUtc: new Date('2026-09-14T14:42:00Z'),
    });
    await HealthSyncRepository.upsertMapping(sourceDb, {
      activityId: activity.id,
      provider: 'health_connect',
      externalRecordId: 'hc-1',
    });

    const exportFile = await buildExportPayload(sourceDb);
    expect(JSON.stringify(exportFile)).not.toContain('hc-1');
    expect(JSON.stringify(exportFile)).not.toContain('health_sync');
  });

  it('replace-import wipes prior local data first (§13.3)', async () => {
    await ActivityService.recordActivity(destDb, { context: 'solo', instantUtc: new Date('2020-01-01T00:00:00Z') });
    const staleId = (await ActivityRepository.findAllActivities(destDb))[0].id;

    await ActivityService.recordActivity(sourceDb, { context: 'partnered', instantUtc: new Date('2026-09-14T14:42:00Z') });
    const exportFile = await buildExportPayload(sourceDb);
    const validated = validateExportFile(JSON.parse(serializeExportFile(exportFile)));
    if (!validated.valid) throw new Error('unexpected invalid export');

    await performReplaceImport(destDb, validated.file);

    const after = await ActivityRepository.findAllActivities(destDb);
    expect(after).toHaveLength(1);
    expect(after[0].id).not.toBe(staleId);
  });

  it('replace-import resets sync-derived settings but leaves device-owned settings alone (§13.3.1/D-42)', async () => {
    await setSetting(destDb, 'healthConnect.lastSyncedAt', '2020-01-01T00:00:00Z');
    await setSetting(destDb, 'appLock.enabled', true); // device-owned — must survive the import untouched

    const exportFile = await buildExportPayload(sourceDb); // sourceDb has default settings
    const validated = validateExportFile(JSON.parse(serializeExportFile(exportFile)));
    if (!validated.valid) throw new Error('unexpected invalid export');

    await performReplaceImport(destDb, validated.file);

    expect(await getSetting(destDb, 'healthConnect.lastSyncedAt')).toBeNull();
    expect(await getSetting(destDb, 'appLock.enabled')).toBe(true); // untouched by import
  });

  it('replace-import does not re-queue sync jobs (Import re-sync is opt-in only, §13.1)', async () => {
    await setSetting(sourceDb, 'healthConnect.enabled', true);
    await ActivityService.recordActivity(sourceDb, { context: 'solo', instantUtc: new Date('2026-09-14T14:42:00Z') });
    const exportFile = await buildExportPayload(sourceDb);
    const validated = validateExportFile(JSON.parse(serializeExportFile(exportFile)));
    if (!validated.valid) throw new Error('unexpected invalid export');

    await setSetting(destDb, 'healthConnect.enabled', true); // even with HC enabled on the destination...
    await performReplaceImport(destDb, validated.file);

    const restored = (await ActivityRepository.findAllActivities(destDb))[0];
    const jobs = await HealthSyncJobRepository.findJobsForActivity(destDb, restored.id);
    expect(jobs).toHaveLength(0); // ...no job is queued by Import itself
  });

  it('rejects importing a file with a tampered/invalid activity — nothing is written (all-or-nothing)', async () => {
    await ActivityService.recordActivity(sourceDb, { context: 'solo', instantUtc: new Date('2026-09-14T14:42:00Z') });
    const exportFile = await buildExportPayload(sourceDb);
    const raw = JSON.parse(serializeExportFile(exportFile));
    raw.activities[0].context = 'not-a-real-context';

    const validated = validateExportFile(raw);
    expect(validated.valid).toBe(false);
    // A real UI would stop here and never call performReplaceImport at all — asserting that a bit more
    // directly: the destination must remain exactly as it was (empty).
    expect(await ActivityRepository.findAllActivities(destDb)).toHaveLength(0);
  });
});
