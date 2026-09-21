/**
 * 基本設計 v0.11 §17 — the only code in this app allowed to touch the
 * `activities` table directly (Rule: "Repository を DB への唯一の入口とする",
 * §5.1). ISO-8601 parsing, UUID checks, and range validation all happen
 * here — the DB's CHECK constraints are a last-resort guard, not a
 * substitute for this.
 *
 * Every function takes a `SqlExecutor` (either a `DB` or a `Transaction`)
 * as its first argument rather than importing a singleton connection, so
 * `ActivityService` can compose several of these calls inside one
 * `db.transaction()` for §10.2's all-or-nothing delete.
 */
import { generateId, isUuidV4 } from '../lib/id';
import { isValidLocalDate, isValidLocalTime, isLocalDateTimeConsistent, hasZeroSeconds, nowUtcIso, parseStrictUtcIso } from '../lib/datetime';
import { ValidationError, NotFoundError } from '../lib/errors';
import type { SqlExecutor } from '../database/SqlExecutor';
import type {
  Activity,
  ActivityContext,
  ActivityDateRangeQuery,
  ActivityUpdateInput,
  NewActivityInput,
} from '../types/Activity';

const CONTEXTS: readonly ActivityContext[] = ['solo', 'partnered'];

interface ActivityRow {
  id: string;
  context: string;
  occurred_at_utc: string;
  occurred_local_date: string;
  occurred_local_time: string;
  timezone_offset_minutes: number;
  timezone_id: string | null;
  orgasm: number | null;
  ejaculation: number | null;
  protection_used: number | null;
  duration_seconds: number | null;
  mood_before: number | null;
  mood_after: number | null;
  note: string | null;
  sync_version: number;
  created_at: string;
  updated_at: string;
}

function toBoolOrNull(v: number | null): boolean | null {
  return v === null ? null : v === 1;
}

function toIntOrNull(v: boolean | null | undefined): number | null {
  if (v === undefined || v === null) return null;
  return v ? 1 : 0;
}

function rowToActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    context: row.context as ActivityContext,
    occurredAtUtc: row.occurred_at_utc,
    occurredLocalDate: row.occurred_local_date,
    occurredLocalTime: row.occurred_local_time,
    timezoneOffsetMinutes: row.timezone_offset_minutes,
    timezoneId: row.timezone_id,
    orgasm: toBoolOrNull(row.orgasm),
    ejaculation: toBoolOrNull(row.ejaculation),
    protectionUsed: toBoolOrNull(row.protection_used),
    durationSeconds: row.duration_seconds,
    moodBefore: row.mood_before,
    moodAfter: row.mood_after,
    note: row.note,
    syncVersion: row.sync_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Validates the occurred_* fields the same way regardless of caller (defense in depth, §5.1). */
function assertValidOccurredFields(input: {
  occurredAtUtc: string;
  occurredLocalDate: string;
  occurredLocalTime: string;
  timezoneOffsetMinutes: number;
}): void {
  parseStrictUtcIso(input.occurredAtUtc); // throws ValidationError if malformed
  if (!hasZeroSeconds(input.occurredAtUtc)) {
    throw new ValidationError(`occurredAtUtc must have :00 seconds (§4.2): ${input.occurredAtUtc}`);
  }
  if (!isValidLocalDate(input.occurredLocalDate)) {
    throw new ValidationError(`Invalid occurredLocalDate: ${input.occurredLocalDate}`);
  }
  if (!isValidLocalTime(input.occurredLocalTime)) {
    throw new ValidationError(`Invalid occurredLocalTime: ${input.occurredLocalTime}`);
  }
  if (input.timezoneOffsetMinutes < -840 || input.timezoneOffsetMinutes > 840) {
    throw new ValidationError(`timezoneOffsetMinutes out of range: ${input.timezoneOffsetMinutes}`);
  }
  if (
    !isLocalDateTimeConsistent(
      input.occurredAtUtc,
      input.timezoneOffsetMinutes,
      input.occurredLocalDate,
      input.occurredLocalTime,
    )
  ) {
    throw new ValidationError(
      'occurredLocalDate/occurredLocalTime do not match occurredAtUtc + timezoneOffsetMinutes (§4.1 invariant)',
    );
  }
}

function assertValidOutcomeAndContext(input: {
  context: string;
  moodBefore?: number | null;
  moodAfter?: number | null;
  durationSeconds?: number | null;
  note?: string | null;
}): void {
  if (!CONTEXTS.includes(input.context as ActivityContext)) {
    throw new ValidationError(`Invalid context: ${input.context}`);
  }
  for (const [name, value] of [
    ['moodBefore', input.moodBefore],
    ['moodAfter', input.moodAfter],
  ] as const) {
    if (value != null && (value < 1 || value > 5)) {
      throw new ValidationError(`${name} must be between 1 and 5, got ${value}`);
    }
  }
  if (input.durationSeconds != null && (input.durationSeconds <= 0 || input.durationSeconds > 86_400)) {
    throw new ValidationError(`durationSeconds out of range: ${input.durationSeconds}`);
  }
  if (input.note != null && input.note.length > 2000) {
    throw new ValidationError('note exceeds 2000 characters');
  }
}

export async function createActivity(executor: SqlExecutor, input: NewActivityInput): Promise<Activity> {
  assertValidOccurredFields(input);
  assertValidOutcomeAndContext(input);

  const id = generateId();
  const now = nowUtcIso();

  await executor.execute(
    `INSERT INTO activities (
       id, context,
       occurred_at_utc, occurred_local_date, occurred_local_time, timezone_offset_minutes, timezone_id,
       orgasm, ejaculation, protection_used,
       duration_seconds, mood_before, mood_after, note,
       sync_version, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.context,
      input.occurredAtUtc,
      input.occurredLocalDate,
      input.occurredLocalTime,
      input.timezoneOffsetMinutes,
      input.timezoneId,
      toIntOrNull(input.orgasm ?? null),
      toIntOrNull(input.ejaculation ?? null),
      toIntOrNull(input.protectionUsed ?? null),
      input.durationSeconds ?? null,
      input.moodBefore ?? null,
      input.moodAfter ?? null,
      input.note ?? null,
      1,
      now,
      now,
    ],
  );

  const created = await findActivityById(executor, id);
  if (!created) {
    throw new Error('createActivity: insert succeeded but row is not readable back');
  }
  return created;
}

export async function findActivityById(executor: SqlExecutor, id: string): Promise<Activity | null> {
  const result = await executor.execute('SELECT * FROM activities WHERE id = ?', [id]);
  const row = result.rows?.[0] as unknown as ActivityRow | undefined;
  return row ? rowToActivity(row) : null;
}

async function requireActivity(executor: SqlExecutor, id: string): Promise<Activity> {
  const existing = await findActivityById(executor, id);
  if (!existing) {
    throw new NotFoundError(`Activity not found: ${id}`);
  }
  return existing;
}

/**
 * §9.4: `sync_version` is bumped on *every* edit (D-19 "単純性優先" —
 * see 基本設計 §9.4 / 設計判断記録 D-19), regardless of which fields
 * changed, so it always maps 1:1 to Health Connect's `clientRecordVersion`.
 */
export async function updateActivity(
  executor: SqlExecutor,
  id: string,
  patch: ActivityUpdateInput,
): Promise<Activity> {
  const existing = await requireActivity(executor, id);

  const merged = {
    context: patch.context ?? existing.context,
    occurredAtUtc: patch.occurredAtUtc ?? existing.occurredAtUtc,
    occurredLocalDate: patch.occurredLocalDate ?? existing.occurredLocalDate,
    occurredLocalTime: patch.occurredLocalTime ?? existing.occurredLocalTime,
    timezoneOffsetMinutes: patch.timezoneOffsetMinutes ?? existing.timezoneOffsetMinutes,
    timezoneId: 'timezoneId' in patch ? patch.timezoneId ?? null : existing.timezoneId,
    orgasm: 'orgasm' in patch ? patch.orgasm ?? null : existing.orgasm,
    ejaculation: 'ejaculation' in patch ? patch.ejaculation ?? null : existing.ejaculation,
    protectionUsed: 'protectionUsed' in patch ? patch.protectionUsed ?? null : existing.protectionUsed,
    durationSeconds: 'durationSeconds' in patch ? patch.durationSeconds ?? null : existing.durationSeconds,
    moodBefore: 'moodBefore' in patch ? patch.moodBefore ?? null : existing.moodBefore,
    moodAfter: 'moodAfter' in patch ? patch.moodAfter ?? null : existing.moodAfter,
    note: 'note' in patch ? patch.note ?? null : existing.note,
  };

  assertValidOccurredFields(merged);
  assertValidOutcomeAndContext(merged);

  const now = nowUtcIso();
  const nextSyncVersion = existing.syncVersion + 1;

  await executor.execute(
    `UPDATE activities SET
       context = ?, occurred_at_utc = ?, occurred_local_date = ?, occurred_local_time = ?,
       timezone_offset_minutes = ?, timezone_id = ?,
       orgasm = ?, ejaculation = ?, protection_used = ?,
       duration_seconds = ?, mood_before = ?, mood_after = ?, note = ?,
       sync_version = ?, updated_at = ?
     WHERE id = ?`,
    [
      merged.context,
      merged.occurredAtUtc,
      merged.occurredLocalDate,
      merged.occurredLocalTime,
      merged.timezoneOffsetMinutes,
      merged.timezoneId,
      toIntOrNull(merged.orgasm),
      toIntOrNull(merged.ejaculation),
      toIntOrNull(merged.protectionUsed),
      merged.durationSeconds,
      merged.moodBefore,
      merged.moodAfter,
      merged.note,
      nextSyncVersion,
      now,
      id,
    ],
  );

  return requireActivity(executor, id);
}

/**
 * Deletes only the `activities` row. Callers that need the full §10.1/§10.2
 * delete flow (health_sync / health_sync_jobs handling inside one
 * transaction) belong in `services/ActivityService`, not here — this stays
 * a single-table primitive so it composes cleanly inside that transaction.
 */
export async function deleteActivityRow(executor: SqlExecutor, id: string): Promise<void> {
  await executor.execute('DELETE FROM activities WHERE id = ?', [id]);
}

export async function findAllActivities(executor: SqlExecutor): Promise<Activity[]> {
  const result = await executor.execute('SELECT * FROM activities ORDER BY occurred_at_utc ASC');
  return ((result.rows ?? []) as unknown as ActivityRow[]).map(rowToActivity);
}

/**
 * §13 (Import/strict restore): writes a row with the *exact* id/timestamps/
 * sync_version from a validated export file, instead of generating fresh
 * ones like `createActivity` does — this is what makes a restore faithful
 * to the original history rather than a copy with new metadata.
 *
 * Still runs the same field validation as `createActivity` (defense in
 * depth, §5.1) even though `services/importValidation` should already have
 * rejected anything invalid before this is called.
 */
export async function restoreActivityRow(executor: SqlExecutor, activity: Activity): Promise<void> {
  if (!isUuidV4(activity.id)) {
    throw new ValidationError(`restoreActivityRow: not a UUID v4: ${activity.id}`);
  }
  assertValidOccurredFields(activity);
  assertValidOutcomeAndContext(activity);
  if (activity.updatedAt < activity.createdAt) {
    throw new ValidationError('restoreActivityRow: updatedAt is before createdAt');
  }
  if (activity.syncVersion < 1) {
    throw new ValidationError('restoreActivityRow: syncVersion must be >= 1');
  }

  await executor.execute(
    `INSERT INTO activities (
       id, context,
       occurred_at_utc, occurred_local_date, occurred_local_time, timezone_offset_minutes, timezone_id,
       orgasm, ejaculation, protection_used,
       duration_seconds, mood_before, mood_after, note,
       sync_version, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      activity.id,
      activity.context,
      activity.occurredAtUtc,
      activity.occurredLocalDate,
      activity.occurredLocalTime,
      activity.timezoneOffsetMinutes,
      activity.timezoneId,
      toIntOrNull(activity.orgasm),
      toIntOrNull(activity.ejaculation),
      toIntOrNull(activity.protectionUsed),
      activity.durationSeconds,
      activity.moodBefore,
      activity.moodAfter,
      activity.note,
      activity.syncVersion,
      activity.createdAt,
      activity.updatedAt,
    ],
  );
}

/**
 * Wipes every Activity — the caller is expected to have already cleared
 * health_sync/health_sync_jobs first (FK RESTRICT), by whatever ordering
 * fits its own transaction. Two callers, both after they've resolved
 * health_sync_jobs their own way: `ImportService.performReplaceImport`
 * (§13.3 — clears jobs outright, no delete jobs) and `ActivityService.
 * deleteAllActivities` (§10.6 — resolves jobs into `delete` jobs first).
 */
export async function deleteAllActivities(executor: SqlExecutor): Promise<void> {
  await executor.execute('DELETE FROM activities');
}

export async function findActivitiesByDateRange(
  executor: SqlExecutor,
  query: ActivityDateRangeQuery,
): Promise<Activity[]> {
  if (!isValidLocalDate(query.fromLocalDate) || !isValidLocalDate(query.toLocalDate)) {
    throw new ValidationError('fromLocalDate/toLocalDate must be YYYY-MM-DD');
  }
  const params: (string | number)[] = [query.fromLocalDate, query.toLocalDate];
  let sql =
    'SELECT * FROM activities WHERE occurred_local_date BETWEEN ? AND ?';
  if (query.context) {
    sql += ' AND context = ?';
    params.push(query.context);
  }
  sql += ' ORDER BY occurred_at_utc ASC';

  const result = await executor.execute(sql, params);
  return ((result.rows ?? []) as unknown as ActivityRow[]).map(rowToActivity);
}

export async function findRecentActivities(executor: SqlExecutor, limit: number): Promise<Activity[]> {
  const result = await executor.execute(
    'SELECT * FROM activities ORDER BY occurred_at_utc DESC LIMIT ?',
    [limit],
  );
  return ((result.rows ?? []) as unknown as ActivityRow[]).map(rowToActivity);
}

export interface ActivityCounts {
  total: number;
  solo: number;
  partnered: number;
}

export async function countActivitiesByDateRange(
  executor: SqlExecutor,
  query: ActivityDateRangeQuery,
): Promise<ActivityCounts> {
  if (!isValidLocalDate(query.fromLocalDate) || !isValidLocalDate(query.toLocalDate)) {
    throw new ValidationError('fromLocalDate/toLocalDate must be YYYY-MM-DD');
  }
  const result = await executor.execute(
    `SELECT context, COUNT(*) as n FROM activities
     WHERE occurred_local_date BETWEEN ? AND ?
     GROUP BY context`,
    [query.fromLocalDate, query.toLocalDate],
  );
  const rows = (result.rows ?? []) as unknown as { context: ActivityContext; n: number }[];
  const counts: ActivityCounts = { total: 0, solo: 0, partnered: 0 };
  for (const row of rows) {
    counts[row.context] = row.n;
    counts.total += row.n;
  }
  return counts;
}

/** §14 Insights "TOTAL ACTIVITIES": all-time count, no date range. */
export async function countAllActivities(executor: SqlExecutor): Promise<ActivityCounts> {
  const result = await executor.execute('SELECT context, COUNT(*) as n FROM activities GROUP BY context');
  const rows = (result.rows ?? []) as unknown as { context: ActivityContext; n: number }[];
  const counts: ActivityCounts = { total: 0, solo: 0, partnered: 0 };
  for (const row of rows) {
    counts[row.context] = row.n;
    counts.total += row.n;
  }
  return counts;
}

export interface ActivityTimeSpan {
  oldestOccurredAtUtc: string;
  newestOccurredAtUtc: string;
}

/**
 * §14 "平均間隔": the two instants needed for `(最新 − 最古) ÷ (件数 − 1)`.
 * `null` when there are no activities at all — the caller (Statistics
 * Service) is the one that knows the "fewer than 2 records → —" rule; this
 * just reports what's actually in the DB.
 */
export async function getActivityTimeSpan(executor: SqlExecutor): Promise<ActivityTimeSpan | null> {
  const result = await executor.execute(
    'SELECT MIN(occurred_at_utc) as oldest, MAX(occurred_at_utc) as newest FROM activities',
  );
  const row = result.rows?.[0] as { oldest: string | null; newest: string | null } | undefined;
  if (!row?.oldest || !row.newest) return null;
  return { oldestOccurredAtUtc: row.oldest, newestOccurredAtUtc: row.newest };
}
