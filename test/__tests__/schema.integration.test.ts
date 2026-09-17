/**
 * Runs the actual DDL from `database/schema.ts` against real SQLite
 * (via `test/support/sqliteTestDb.ts`) — catches SQL syntax errors and
 * verifies the CHECK/FK constraints the design docs rely on actually do
 * what they're supposed to.
 */
import { createTestDb, type TestDb } from '../support/sqliteTestDb';

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  db.close();
});

function insertActivity(overrides: Record<string, unknown> = {}) {
  const base = {
    id: '11111111-1111-4111-8111-111111111111',
    context: 'solo',
    occurred_at_utc: '2026-09-14T14:42:00Z',
    occurred_local_date: '2026-09-14',
    occurred_local_time: '23:42',
    timezone_offset_minutes: 540,
    timezone_id: 'Asia/Tokyo',
    orgasm: null,
    ejaculation: null,
    protection_used: null,
    duration_seconds: null,
    mood_before: null,
    mood_after: null,
    note: null,
    sync_version: 1,
    created_at: '2026-09-14T14:42:03Z',
    updated_at: '2026-09-14T14:42:03Z',
    ...overrides,
  };
  const cols = Object.keys(base);
  return db.execute(
    `INSERT INTO activities (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    Object.values(base) as never[],
  );
}

describe('activities CHECK constraints', () => {
  it('accepts a well-formed row', async () => {
    await expect(insertActivity()).resolves.toBeDefined();
  });

  it('rejects an unknown context', async () => {
    await expect(insertActivity({ context: 'both' })).rejects.toThrow();
  });

  it('rejects mood_before out of 1–5', async () => {
    await expect(insertActivity({ mood_before: 6 })).rejects.toThrow();
  });

  it('rejects a negative duration', async () => {
    await expect(insertActivity({ duration_seconds: -1 })).rejects.toThrow();
  });

  it('rejects duration over 86400', async () => {
    await expect(insertActivity({ duration_seconds: 86_401 })).rejects.toThrow();
  });

  it('rejects an out-of-range timezone offset', async () => {
    await expect(insertActivity({ timezone_offset_minutes: 900 })).rejects.toThrow();
  });

  it('rejects orgasm values other than 0/1/NULL', async () => {
    await expect(insertActivity({ orgasm: 2 })).rejects.toThrow();
  });

  it('accepts orgasm = 0 distinctly from NULL (§5.3 NULL vs false)', async () => {
    await insertActivity({ id: '11111111-1111-4111-8111-111111111111', orgasm: 0 });
    const result = await db.execute('SELECT orgasm FROM activities WHERE id = ?', [
      '11111111-1111-4111-8111-111111111111',
    ]);
    expect(result.rows[0].orgasm).toBe(0);
  });

  it('rejects updated_at before created_at', async () => {
    await expect(
      insertActivity({ created_at: '2026-09-14T14:42:03Z', updated_at: '2026-09-14T14:42:02Z' }),
    ).rejects.toThrow();
  });

  it('enforces primary key uniqueness on id', async () => {
    await insertActivity();
    await expect(insertActivity()).rejects.toThrow();
  });
});

describe('health_sync foreign key (ON DELETE RESTRICT, §5)', () => {
  it('blocks deleting an Activity that still has a mapping', async () => {
    await insertActivity();
    await db.execute(
      `INSERT INTO health_sync (activity_id, provider, external_record_id, last_synced_at)
       VALUES (?, 'health_connect', NULL, ?)`,
      ['11111111-1111-4111-8111-111111111111', '2026-09-14T14:42:03Z'],
    );

    await expect(db.execute('DELETE FROM activities WHERE id = ?', ['11111111-1111-4111-8111-111111111111'])).rejects.toThrow();
  });

  it('allows the delete once the mapping is removed first (§10.2 ordering)', async () => {
    await insertActivity();
    await db.execute(
      `INSERT INTO health_sync (activity_id, provider, external_record_id, last_synced_at)
       VALUES (?, 'health_connect', NULL, ?)`,
      ['11111111-1111-4111-8111-111111111111', '2026-09-14T14:42:03Z'],
    );
    await db.execute('DELETE FROM health_sync WHERE activity_id = ?', ['11111111-1111-4111-8111-111111111111']);
    await expect(
      db.execute('DELETE FROM activities WHERE id = ?', ['11111111-1111-4111-8111-111111111111']),
    ).resolves.toBeDefined();
  });
});

describe('health_sync_jobs (D-03/D-18)', () => {
  it('enforces at most one pending job per (activity_id, provider) — uq_health_sync_jobs', async () => {
    await insertActivity();
    const jobCols = 'id, activity_id, provider, operation, revision, attempts, created_at';
    await db.execute(
      `INSERT INTO health_sync_jobs (${jobCols}) VALUES (?, ?, 'health_connect', 'create', 1, 0, ?)`,
      ['22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', '2026-09-14T14:42:03Z'],
    );
    await expect(
      db.execute(`INSERT INTO health_sync_jobs (${jobCols}) VALUES (?, ?, 'health_connect', 'update', 1, 0, ?)`, [
        '33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111',
        '2026-09-14T14:42:04Z',
      ]),
    ).rejects.toThrow();
  });

  it('accepts the `recreate` operation (D-34)', async () => {
    await insertActivity();
    await expect(
      db.execute(
        `INSERT INTO health_sync_jobs (id, activity_id, provider, operation, revision, attempts, created_at)
         VALUES (?, ?, 'health_connect', 'recreate', 1, 0, ?)`,
        ['22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', '2026-09-14T14:42:03Z'],
      ),
    ).resolves.toBeDefined();
  });

  it('does NOT enforce a foreign key to activities (a job can outlive its Activity, D-03)', async () => {
    // No Activity row inserted at all.
    await expect(
      db.execute(
        `INSERT INTO health_sync_jobs (id, activity_id, provider, operation, revision, attempts, created_at)
         VALUES (?, ?, 'health_connect', 'delete', 1, 0, ?)`,
        ['22222222-2222-4222-8222-222222222222', 'ffffffff-ffff-4fff-8fff-ffffffffffff', '2026-09-14T14:42:03Z'],
      ),
    ).resolves.toBeDefined();
  });
});

describe('app_settings', () => {
  it('upserts via ON CONFLICT DO UPDATE (used by SettingsRepository.setSetting)', async () => {
    await db.execute('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)', [
      'activityDetails.orgasm',
      'true',
      '2026-09-14T14:42:03Z',
    ]);
    await db.execute(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ['activityDetails.orgasm', 'false', '2026-09-14T14:42:05Z'],
    );
    const result = await db.execute('SELECT value FROM app_settings WHERE key = ?', ['activityDetails.orgasm']);
    expect(result.rows[0].value).toBe('false');
  });
});
