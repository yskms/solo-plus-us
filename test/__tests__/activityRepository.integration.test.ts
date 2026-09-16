/**
 * §5.1: Repository is the DB's only entry point and does real ISO/format
 * validation beyond what CHECK constraints can express. This exercises
 * that directly against real SQLite, rather than only through
 * ActivityService's happy-path inputs (which always produce well-formed
 * values via `buildOccurredAtFields`).
 */
import { createTestDb, type TestDb } from '../support/sqliteTestDb';
import * as ActivityRepository from '../../repositories/ActivityRepository';
import { ValidationError } from '../../lib/errors';
import type { NewActivityInput, Activity } from '../../types/Activity';

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  db.close();
});

function validInput(overrides: Partial<NewActivityInput> = {}): NewActivityInput {
  return {
    context: 'solo',
    occurredAtUtc: '2026-09-14T14:42:00Z',
    occurredLocalDate: '2026-09-14',
    occurredLocalTime: '23:42',
    timezoneOffsetMinutes: 540,
    timezoneId: 'Asia/Tokyo',
    ...overrides,
  };
}

describe('ActivityRepository.createActivity — §4.2 occurred_at_utc seconds invariant', () => {
  it('accepts occurredAtUtc with :00 seconds', async () => {
    await expect(ActivityRepository.createActivity(db, validInput())).resolves.toBeDefined();
  });

  it('rejects occurredAtUtc with non-zero seconds, even though the DB CHECK alone would allow it', async () => {
    await expect(
      ActivityRepository.createActivity(db, validInput({ occurredAtUtc: '2026-09-14T14:42:37Z' })),
    ).rejects.toThrow(ValidationError);
  });
});

describe('ActivityRepository.restoreActivityRow — same rule applies to Import', () => {
  function activityWith(overrides: Partial<Activity> = {}): Activity {
    return {
      id: '11111111-1111-4111-8111-111111111111',
      context: 'solo',
      occurredAtUtc: '2026-09-14T14:42:00Z',
      occurredLocalDate: '2026-09-14',
      occurredLocalTime: '23:42',
      timezoneOffsetMinutes: 540,
      timezoneId: 'Asia/Tokyo',
      orgasm: null,
      ejaculation: null,
      protectionUsed: null,
      durationSeconds: null,
      moodBefore: null,
      moodAfter: null,
      note: null,
      syncVersion: 1,
      createdAt: '2026-09-14T14:42:03Z',
      updatedAt: '2026-09-14T14:42:03Z',
      ...overrides,
    };
  }

  it('rejects a restored row whose occurredAtUtc has non-zero seconds', async () => {
    await expect(
      ActivityRepository.restoreActivityRow(db, activityWith({ occurredAtUtc: '2026-09-14T14:42:37Z' })),
    ).rejects.toThrow(ValidationError);
  });

  it('createdAt/updatedAt are allowed to keep real seconds (only occurredAtUtc is restricted)', async () => {
    await expect(
      ActivityRepository.restoreActivityRow(
        db,
        activityWith({ createdAt: '2026-09-14T14:42:37Z', updatedAt: '2026-09-14T14:42:37Z' }),
      ),
    ).resolves.toBeUndefined();
  });
});
