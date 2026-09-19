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
 * Minute-level identity check — used by the date/time pickers in
 * `app/record.tsx` and `app/activity/[id].tsx` (via
 * `hooks/useNativeDateTimePicker.ts` and `resolveOccurredAtEdit` below) to
 * tell "opened and confirmed without actually changing anything" apart
 * from a real edit, since `occurred_at_utc` is minute precision anyway
 * (§4.2).
 */
export function sameMinute(a: Date, b: Date): boolean {
  return Math.floor(a.getTime() / 60_000) === Math.floor(b.getTime() / 60_000);
}

/**
 * Generic upper-bound clamp. `clampToNow` below is the common case
 * (`clampTo(date, new Date())`), but the date/time pickers' own internal
 * future-guard (`hooks/useNativeDateTimePicker.ts`,
 * `lib/androidDateTimePicker.ts`) needs a boundary that isn't necessarily
 * *real* "now" — see `nowAsZonedDigits`'s doc comment for why.
 */
export function clampTo(date: Date, max: Date): Date {
  return date.getTime() > max.getTime() ? max : date;
}

/** Never allow a future recorded time (the date/time pickers in `app/record.tsx` and `app/activity/[id].tsx`), regardless of what a platform picker itself enforces — Android's `maximumDate` only constrains the date dialog, not the time dialog that follows it. */
export function clampToNow(date: Date): Date {
  return clampTo(date, new Date());
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

/**
 * Inverse of `resolveOffsetMinutesForZone`: the UTC instant whose
 * wall-clock reads back as `year`/`month0`/`day`/`hour`/`minute` when
 * formatted in `timeZoneId`. Two-pass approximation — guess the offset
 * from a same-digits-as-UTC candidate, then re-resolve once more against
 * that candidate's actual instant, which is enough to converge except
 * exactly at a DST transition (same known, undefended edge case as
 * `resolveOffsetMinutesForZone`'s own callers elsewhere in this file).
 */
export function zonedComponentsToUtc(
  year: number,
  month0: number,
  day: number,
  hour: number,
  minute: number,
  timeZoneId: string,
): Date {
  const naiveUtcMs = Date.UTC(year, month0, day, hour, minute, 0, 0);
  const firstGuessOffset = resolveOffsetMinutesForZone(timeZoneId, new Date(naiveUtcMs));
  const candidateMs = naiveUtcMs - firstGuessOffset * 60_000;
  const secondGuessOffset = resolveOffsetMinutesForZone(timeZoneId, new Date(candidateMs));
  return new Date(naiveUtcMs - secondGuessOffset * 60_000);
}

/**
 * "Now", expressed as a digit carrier (see `resolveOccurredAtEdit`'s doc
 * comment for what that means) whose Y/M/D/H/Min — read via *local*
 * (device-zone) getters — are what the wall clock currently reads in
 * `timeZoneId`. `atInstant` defaults to the real current instant; the
 * parameter exists so this is testable without depending on wall-clock
 * time.
 *
 * This is `hooks/useNativeDateTimePicker.ts`'s own future-time boundary
 * (its `getMax`) when editing a record in `app/activity/[id].tsx` —
 * comparing a picked digit carrier against *real* "now" would judge
 * "future-ness" using the device's own zone, which is wrong once the
 * record's zone differs from the device's: a genuinely past moment in a
 * zone *east* of the device's can read as numerically later than the
 * device's own current wall clock (review finding, D-50, 3rd round — e.g.
 * editing a Tokyo-recorded entry from a device currently in
 * America/Los_Angeles: 05:00 JST tomorrow-device's-date is a perfectly
 * valid *past* Tokyo moment whenever it's already past 05:00 JST "today",
 * even though LA's own wall clock hasn't reached tomorrow yet). Comparing
 * two digit carriers *both* expressed in the record's own zone — the
 * picked value against this function's result — is the correct,
 * apples-to-apples comparison. The *authoritative* clamp against a real
 * instant still happens in `resolveOccurredAtEdit`; this is only the
 * picker's own live, pre-Save guard (native `maximumDate` props, and the
 * chained-dialog combine-then-clamp in `lib/androidDateTimePicker.ts`).
 */
export function nowAsZonedDigits(timeZoneId: string, atInstant: Date = new Date()): Date {
  const offset = resolveOffsetMinutesForZone(timeZoneId, atInstant);
  const { localDate, localTime } = deriveLocalDateTime(atInstant, offset);
  const [y, m, d] = localDate.split('-').map(Number);
  const [hh, mm] = localTime.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

/**
 * Resolves what (if anything) `app/activity/[id].tsx`'s date/time picker
 * should patch on Save (D-50, review findings #1/#2 — see the design
 * decision record for the two wrong approaches this replaced). Returns
 * `{}` — no patch at all — when the picker was never opened
 * (`pickedLocalDigits` is `null`) or was opened and confirmed without
 * actually changing the recorded minute: either way, the exact original
 * `occurred_*` values must pass through unchanged rather than being
 * recomputed from a "changed" value that isn't really different, which
 * would otherwise bump `sync_version` (D-19) for a no-op edit and could
 * queue a needless Health Connect update job.
 *
 * `pickedLocalDigits` is treated purely as a carrier for the Y/M/D/H/Min
 * digits the picker displayed and the person edited — read via `Date`'s
 * *local* (device-zone) getters, exactly as `app/activity/[id].tsx`'s
 * `toLocalDate` constructs it and as the native picker components display
 * and edit it (there being no timezone-aware picker, §4.4's known v1
 * limitation). Those digits are then resolved into a real UTC instant as
 * wall-clock time *in the record's own `recordedTimezoneId`* (falling
 * back to the device's current zone only if it's `null`) — deliberately
 * NOT the device's current zone unconditionally, and deliberately NOT by
 * trusting `pickedLocalDigits.getTime()` directly (that epoch is
 * meaningless here — it's whatever the device's *current* zone happens to
 * make of those digits, which is only correct when the device's current
 * zone equals `recordedTimezoneId`).
 *
 * This two-step split (read digits → resolve in the record's own zone) is
 * what keeps the DATE & TIME text, the picker, and the saved value all
 * showing/producing the *same* wall-clock time throughout an edit — an
 * earlier version instead fed the picker a real parsed instant, which
 * looked internally consistent but showed a *different* wall-clock number
 * than the DATE & TIME text whenever the device's current zone differed
 * from the record's — e.g. a 14:00 JST entry opened from a device
 * currently in America/Los_Angeles showed "14:00" as static text but the
 * picker itself opened already showing a different hour. `clampToNow` is
 * applied to the *resolved* instant, not to `pickedLocalDigits` itself —
 * this is the authoritative check. The picker's own live guard before
 * Save (native `maximumDate` props, and `lib/androidDateTimePicker.ts`'s
 * chained-dialog clamp) is a separate, zone-consistent comparison against
 * `nowAsZonedDigits(recordedTimezoneId)` (see that function's doc
 * comment) — the two only diverge right at a DST transition in the
 * record's zone, which neither this function nor that one specially
 * handles (same known, undefended edge case noted elsewhere in this
 * file).
 */
export function resolveOccurredAtEdit(
  recordedAtUtc: string,
  recordedTimezoneId: string | null,
  pickedLocalDigits: Date | null,
): Partial<OccurredAtFields & { timezoneId: string }> {
  if (!pickedLocalDigits) return {};
  const timezoneId = recordedTimezoneId ?? getDeviceTimeZoneId();
  const resolvedInstant = zonedComponentsToUtc(
    pickedLocalDigits.getFullYear(),
    pickedLocalDigits.getMonth(),
    pickedLocalDigits.getDate(),
    pickedLocalDigits.getHours(),
    pickedLocalDigits.getMinutes(),
    timezoneId,
  );
  const clamped = clampToNow(resolvedInstant);
  const original = parseStrictUtcIso(recordedAtUtc);
  if (sameMinute(clamped, original)) return {};
  return { ...buildOccurredAtFields(clamped, timezoneId), timezoneId };
}
