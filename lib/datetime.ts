/**
 * Date/time handling for Solo + Us.
 *
 * This file is the single place that understands the invariant from
 * 基本設計 v0.11 §4: every stored instant is `YYYY-MM-DDTHH:MM:SSZ`
 * (fixed 20 chars, UTC), so string comparison == chronological comparison.
 *
 * `occurred_at_utc` additionally always has seconds `00` (§4.2) — input and
 * display precision is minute-level. `created_at` / `updated_at` and job
 * timestamps keep real second precision but use the same fixed format.
 *
 * Local date/time (`occurred_local_date` / `occurred_local_time`) are
 * ALWAYS derived by pure arithmetic (`local = utc + offset`, §4.1) rather
 * than by reading a JS Date's local getters — those depend on the runtime's
 * configured timezone, which we never want to rely on for stored data.
 */
import { ValidationError } from './errors';

const ISO_UTC_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;
const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME_RE = /^\d{2}:\d{2}$/;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** §4.3: fixed-length UTC string for any instant, e.g. created_at / updated_at / job timestamps. */
export function formatUtcIso(date: Date): string {
  return (
    `${date.getUTCFullYear().toString().padStart(4, '0')}-` +
    `${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}T` +
    `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}Z`
  );
}

/** Current instant, full second precision, in the fixed UTC format. */
export function nowUtcIso(): string {
  return formatUtcIso(new Date());
}

/** §4.2: occurred_at_utc always has seconds truncated to 00. */
export function truncateToMinute(date: Date): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    0,
    0,
  ));
}

/**
 * Strictly parses `YYYY-MM-DDTHH:MM:SSZ`.
 *
 * §5.1: `length(x) = 20` is "a guard on length, not a format check". This
 * is the actual format check the design docs require Repository/Import to
 * perform. Rejects out-of-range components (e.g. month 13, Feb 30) instead
 * of letting them silently overflow into the next month, which is what
 * `new Date(string)` would otherwise do.
 */
export function parseStrictUtcIso(value: string): Date {
  const m = ISO_UTC_RE.exec(value);
  if (!m) {
    throw new ValidationError(`Not a valid UTC instant: ${JSON.stringify(value)}`);
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  // Date.UTC() silently normalizes overflow (e.g. day 32 -> next month).
  // Re-reading and comparing components catches that.
  const valid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second;

  if (!valid) {
    throw new ValidationError(`Not a real calendar instant: ${JSON.stringify(value)}`);
  }
  return date;
}

/** Non-throwing version, for Import validation where we collect all errors instead of stopping at the first. */
export function isValidUtcIso(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    parseStrictUtcIso(value);
    return true;
  } catch {
    return false;
  }
}

export function isValidLocalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !LOCAL_DATE_RE.test(value)) return false;
  const [y, mo, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export function isValidLocalTime(value: unknown): value is string {
  if (typeof value !== 'string' || !LOCAL_TIME_RE.test(value)) return false;
  const [h, mi] = value.split(':').map(Number);
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59;
}

export interface OccurredAtFields {
  occurredAtUtc: string;
  occurredLocalDate: string;
  occurredLocalTime: string;
  timezoneOffsetMinutes: number;
}

/**
 * §4.1: local = utc + offset, computed by arithmetic — never by reading a
 * Date's local getters (which depend on the runtime's configured TZ).
 */
export function deriveLocalDateTime(instantUtc: Date, offsetMinutes: number): {
  localDate: string;
  localTime: string;
} {
  const shifted = new Date(instantUtc.getTime() + offsetMinutes * 60_000);
  const localDate =
    `${shifted.getUTCFullYear().toString().padStart(4, '0')}-` +
    `${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
  const localTime = `${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}`;
  return { localDate, localTime };
}

/**
 * §4.4: the offset to store for a past/future edit is the offset that
 * `timezoneId` actually had AT `atUtc` — not today's offset. This is what
 * makes edits correct across a DST boundary.
 *
 * Implementation: format `atUtc` into `timeZoneId`'s wall-clock components,
 * then measure how far that wall clock (read back as if it were UTC) is
 * from the real UTC instant. That difference, in minutes, is the offset.
 */
export function resolveOffsetMinutesForZone(timeZoneId: string, atUtc: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZoneId,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = formatter.formatToParts(atUtc);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');

  const wallAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') === 24 ? 0 : get('hour'),
    get('minute'),
    get('second'),
  );

  return Math.round((wallAsUtc - atUtc.getTime()) / 60_000);
}

/** The device's current IANA zone, e.g. `Asia/Tokyo`. */
export function getDeviceTimeZoneId(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Builds all four `occurred_*` columns for a newly recorded or edited
 * Activity from a single instant.
 *
 * v1 has no timezone picker (known limitation, §4.4 / §4.6): the offset
 * used is always the device's *current* IANA zone's offset at `instantUtc`,
 * which is correct for "now" and for edits made from the same device/
 * region, but not for entering a past event that happened while traveling.
 */
export function buildOccurredAtFields(instantUtc: Date, timezoneId: string = getDeviceTimeZoneId()): OccurredAtFields {
  const truncated = truncateToMinute(instantUtc);
  const offsetMinutes = resolveOffsetMinutesForZone(timezoneId, truncated);
  const { localDate, localTime } = deriveLocalDateTime(truncated, offsetMinutes);
  return {
    occurredAtUtc: formatUtcIso(truncated),
    occurredLocalDate: localDate,
    occurredLocalTime: localTime,
    timezoneOffsetMinutes: offsetMinutes,
  };
}

/**
 * §13.4: Import must verify `occurredLocalDate` / `occurredLocalTime` were
 * actually derived from `occurredAtUtc + offset`, not just well-formed.
 */
export function isLocalDateTimeConsistent(
  occurredAtUtc: string,
  offsetMinutes: number,
  occurredLocalDate: string,
  occurredLocalTime: string,
): boolean {
  const instant = parseStrictUtcIso(occurredAtUtc);
  const derived = deriveLocalDateTime(instant, offsetMinutes);
  return derived.localDate === occurredLocalDate && derived.localTime === occurredLocalTime;
}

/** For job scheduling (`not_before`), e.g. "record time + 5s" (D-15/D-44). `created_at`/`updated_at`/job timestamps keep real seconds, so this accepts any valid instant. */
export function addSecondsIso(iso: string, seconds: number): string {
  const date = parseStrictUtcIso(iso);
  return formatUtcIso(new Date(date.getTime() + seconds * 1000));
}

/**
 * §4.2: `occurred_at_utc` specifically must always have `:00` seconds —
 * unlike `created_at`/`updated_at`, which keep real second precision.
 * `parseStrictUtcIso` alone only checks the format is well-formed; this is
 * the additional, narrower check that's only correct to apply to
 * `occurred_at_utc`.
 */
export function hasZeroSeconds(utcIso: string): boolean {
  return utcIso.slice(17, 19) === '00';
}

/** Combines format validation with the `occurred_at_utc`-specific seconds rule (§4.2/§13.4). */
export function isValidOccurredAtUtc(value: unknown): value is string {
  return isValidUtcIso(value) && hasZeroSeconds(value);
}
