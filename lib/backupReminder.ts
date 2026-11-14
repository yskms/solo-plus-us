/**
 * D-58 - when to show the Home card that says "records do not move to a new
 * phone by themselves, export before you switch".
 *
 * Pure on purpose (no DB, no clock): the caller passes `now` and the three
 * timestamps, so the rule is testable and the screen only decides how to draw.
 *
 * The rule: show it when the user has records and the last "backup-ish" event
 * is at least `BACKUP_REMINDER_INTERVAL_DAYS` old. That event is the latest of
 * the last JSON export and the last time the card was dismissed or followed;
 * when neither ever happened, the oldest record's creation time stands in, so
 * a new user is not nagged on day one but a long-time user who never exported
 * sees it right away.
 */

export const BACKUP_REMINDER_INTERVAL_DAYS = 180;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface BackupReminderInput {
  nowMs: number;
  /** `backup.lastExportedAt` (UTC ISO, or null). */
  lastExportedAt: string | null;
  /** `backup.reminderDismissedAt` (UTC ISO, or null). */
  reminderDismissedAt: string | null;
  /** Creation time of the oldest record (UTC ISO), or null when there are no records. */
  oldestRecordCreatedAt: string | null;
}

/** An unparseable or missing timestamp counts as "never". */
function toMs(value: string | null): number | null {
  if (value === null) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export function shouldShowBackupReminder(input: BackupReminderInput): boolean {
  const oldest = toMs(input.oldestRecordCreatedAt);
  if (oldest === null) return false; // no records: nothing to back up yet

  // An event dated in the future (the clock was wrong when it was saved) is
  // ignored, so it cannot hide the card until that date finally arrives.
  const events = [toMs(input.lastExportedAt), toMs(input.reminderDismissedAt)].filter(
    (ms): ms is number => ms !== null && ms <= input.nowMs,
  );
  const baseline = events.length > 0 ? Math.max(...events) : oldest;

  return input.nowMs - baseline >= BACKUP_REMINDER_INTERVAL_DAYS * MS_PER_DAY;
}
