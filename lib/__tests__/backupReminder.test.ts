import { BACKUP_REMINDER_INTERVAL_DAYS, shouldShowBackupReminder } from '../backupReminder';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-14T00:00:00Z');
const daysAgo = (days: number) => new Date(NOW - days * DAY).toISOString();

describe('shouldShowBackupReminder', () => {
  const base = { nowMs: NOW, lastExportedAt: null, reminderDismissedAt: null, oldestRecordCreatedAt: daysAgo(400) };

  it('uses a 180 day interval', () => {
    expect(BACKUP_REMINDER_INTERVAL_DAYS).toBe(180);
  });

  it('shows nothing when there are no records', () => {
    expect(shouldShowBackupReminder({ ...base, oldestRecordCreatedAt: null })).toBe(false);
  });

  it('shows right away for a long-time user who never exported or dismissed it', () => {
    expect(shouldShowBackupReminder(base)).toBe(true);
  });

  it('does not nag a new user: the oldest record stands in as the baseline', () => {
    expect(shouldShowBackupReminder({ ...base, oldestRecordCreatedAt: daysAgo(3) })).toBe(false);
    expect(shouldShowBackupReminder({ ...base, oldestRecordCreatedAt: daysAgo(179) })).toBe(false);
    expect(shouldShowBackupReminder({ ...base, oldestRecordCreatedAt: daysAgo(180) })).toBe(true);
  });

  it('counts from the oldest record when it is newer than the last export (everything was deleted and started again)', () => {
    // Exported 300 days ago, then deleted all and recorded again 3 days ago.
    expect(shouldShowBackupReminder({ ...base, lastExportedAt: daysAgo(300), oldestRecordCreatedAt: daysAgo(3) })).toBe(false);
    expect(shouldShowBackupReminder({ ...base, lastExportedAt: daysAgo(300), oldestRecordCreatedAt: daysAgo(179) })).toBe(false);
    expect(shouldShowBackupReminder({ ...base, lastExportedAt: daysAgo(300), oldestRecordCreatedAt: daysAgo(180) })).toBe(true);
    expect(shouldShowBackupReminder({ ...base, reminderDismissedAt: daysAgo(300), oldestRecordCreatedAt: daysAgo(3) })).toBe(false);
  });

  it('waits 180 days after the last export', () => {
    expect(shouldShowBackupReminder({ ...base, lastExportedAt: daysAgo(10) })).toBe(false);
    expect(shouldShowBackupReminder({ ...base, lastExportedAt: daysAgo(179) })).toBe(false);
    expect(shouldShowBackupReminder({ ...base, lastExportedAt: daysAgo(181) })).toBe(true);
  });

  it('waits 180 days after the card was dismissed', () => {
    expect(shouldShowBackupReminder({ ...base, reminderDismissedAt: daysAgo(1) })).toBe(false);
    expect(shouldShowBackupReminder({ ...base, reminderDismissedAt: daysAgo(181) })).toBe(true);
  });

  it('counts from the more recent of export and dismissal', () => {
    expect(shouldShowBackupReminder({ ...base, lastExportedAt: daysAgo(400), reminderDismissedAt: daysAgo(5) })).toBe(false);
    expect(shouldShowBackupReminder({ ...base, lastExportedAt: daysAgo(5), reminderDismissedAt: daysAgo(400) })).toBe(false);
    expect(shouldShowBackupReminder({ ...base, lastExportedAt: daysAgo(300), reminderDismissedAt: daysAgo(200) })).toBe(true);
  });

  it('ignores an unparseable timestamp (treated as never)', () => {
    expect(shouldShowBackupReminder({ ...base, lastExportedAt: 'not a date' })).toBe(true);
    expect(shouldShowBackupReminder({ ...base, oldestRecordCreatedAt: 'not a date' })).toBe(false);
  });

  it('ignores an event dated in the future instead of hiding the card until then', () => {
    const future = new Date(NOW + 400 * DAY).toISOString();
    expect(shouldShowBackupReminder({ ...base, lastExportedAt: future })).toBe(true);
    expect(shouldShowBackupReminder({ ...base, reminderDismissedAt: future })).toBe(true);
  });

  it('ignores a future-dated oldest record when an older event gives a usable baseline', () => {
    const future = new Date(NOW + 400 * DAY).toISOString();
    expect(shouldShowBackupReminder({ ...base, oldestRecordCreatedAt: future, lastExportedAt: daysAgo(300) })).toBe(true);
    expect(shouldShowBackupReminder({ ...base, oldestRecordCreatedAt: future })).toBe(false);
  });
});
