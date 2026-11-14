/**
 * D-58 - the device-local record of "when did this person last export", used
 * by the Settings and Export screens (to show it) and by the Home reminder
 * card (to decide whether to show it).
 *
 * `backup.lastExportedAt` is stamped when the share sheet is opened for a JSON
 * export. The share sheet does not report whether the file was saved or the
 * sheet was cancelled (§12.4), so this can say "an export was started", not
 * "a backup exists". The reminder is a nudge, not a guarantee, so that is
 * accepted; screens must not word it as proof of a backup.
 *
 * Only JSON counts: CSV is one-way and cannot be imported (D-09).
 */
import type { SqlExecutor } from '../database/SqlExecutor';
import { nowUtcIso } from '../lib/datetime';
import { getOldestActivityCreatedAt } from '../repositories/ActivityRepository';
import { getSetting, setSetting } from './SettingsRepository';

export interface BackupState {
  lastExportedAt: string | null;
  reminderDismissedAt: string | null;
  oldestRecordCreatedAt: string | null;
}

export async function recordJsonExport(executor: SqlExecutor): Promise<void> {
  await setSetting(executor, 'backup.lastExportedAt', nowUtcIso());
}

/** For both "Close" and "Open Export" on the Home card: either way, ask again only after the interval. */
export async function recordBackupReminderHandled(executor: SqlExecutor): Promise<void> {
  await setSetting(executor, 'backup.reminderDismissedAt', nowUtcIso());
}

export async function loadBackupState(executor: SqlExecutor): Promise<BackupState> {
  const [lastExportedAt, reminderDismissedAt, oldestRecordCreatedAt] = await Promise.all([
    getSetting(executor, 'backup.lastExportedAt'),
    getSetting(executor, 'backup.reminderDismissedAt'),
    getOldestActivityCreatedAt(executor),
  ]);
  return { lastExportedAt, reminderDismissedAt, oldestRecordCreatedAt };
}
