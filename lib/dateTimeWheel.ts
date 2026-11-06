/**
 * The arithmetic behind `components/DateTimeWheel.tsx` (Add Activity's
 * year / month / day / hour / minute wheels, §11.4). Kept free of React so
 * the rules can be unit-tested.
 *
 * The wheel's value is the five numbers (`WheelFields`), not a `Date`, on
 * purpose: a `Date` can't hold "Nov 31" (it rolls over to Dec 1), and the
 * wheel must let the user park on it. Nothing is corrected while turning:
 *
 * - no "not in the future" rule: the wheel used to pull a future pick back
 *   to "now", which made the reel jump back under the finger (the case this
 *   wheel exists for, "just after midnight, record 23:xx of the day before",
 *   passes through a future time on the way, since the hour is turned
 *   before the day);
 * - no "day follows the month" rule: the day column always offers 1-31 and a
 *   day past the end of the month (31 in November) is left as it is. The
 *   old version shortened the column and moved the value, which was one more
 *   thing scrolling under the finger.
 *
 * `app/record.tsx` checks both at save time instead (`isValidWheelDate`, and
 * a confirmation for a future time). Don't put a clamp back.
 *
 * `fromWheelFields` builds the `Date` via the runtime's *local* constructor:
 * the wheel shows the wall-clock digits in the device's current zone. That's
 * also what makes it usable with a "digit carrier" (`nowAsZonedDigits`) if a
 * caller ever needs another zone's digits; nothing here knows about zones.
 *
 * Known limitation (same as the old Android time dialog): a wall-clock time
 * that a DST transition skips over is shifted forward by the `Date`
 * constructor rather than rejected.
 */
export type WheelField = 'year' | 'month' | 'day' | 'hour' | 'minute';

/** Oldest year the year wheel offers (earlier values extend it, so an existing value is never off the wheel). */
export const MIN_WHEEL_YEAR = 2000;

/** How many years after the current one the year wheel offers. */
export const WHEEL_YEARS_AHEAD = 10;

/** The day column always has this many rows, whatever the month. */
export const MAX_WHEEL_DAY = 31;

export interface WheelFields {
  year: number;
  month: number; // 1-12
  day: number; // 1-31 (may be past the end of the month, see `isValidWheelDate`)
  hour: number; // 0-23
  minute: number; // 0-59
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function toWheelFields(date: Date): WheelFields {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
}

/** False for a day the month doesn't have (Nov 31, Feb 30, Feb 29 in a common year). */
export function isValidWheelDate(fields: WheelFields): boolean {
  return fields.day >= 1 && fields.day <= daysInMonth(fields.year, fields.month);
}

/**
 * The `Date` for the fields, in the device's current zone. An invalid date
 * rolls over (Nov 31 becomes Dec 1), so check `isValidWheelDate` first.
 */
export function fromWheelFields(fields: WheelFields): Date {
  return new Date(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, 0, 0);
}

/** The wheel value after one column settles on `n`. Nothing else changes and nothing is clamped (see the file comment). */
export function setWheelField(fields: WheelFields, field: WheelField, n: number): WheelFields {
  return { ...fields, [field]: n };
}

export function sameWheelFields(a: WheelFields, b: WheelFields): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute;
}

/**
 * Every column but the year wraps around (12 above 1, 31 above 1, 23 above 0,
 * 59 above 0), so the last row is one turn away from the first. Nothing is
 * linked: wrapping the hour never changes the day, wrapping the day never
 * changes the month. The year stays linear: it has no natural end to wrap at.
 */
export function isLoopingWheelField(field: WheelField): boolean {
  return field !== 'year';
}

/**
 * The numbers each column offers, in wheel order (top to bottom). `now` only
 * decides where the year column ends. The lengths of month / day / hour /
 * minute never change, which is what lets a looping column keep its rows.
 */
export function wheelFieldValues(field: WheelField, fields: WheelFields, now: Date): number[] {
  switch (field) {
    case 'year': {
      const first = Math.min(MIN_WHEEL_YEAR, fields.year);
      const last = Math.max(now.getFullYear() + WHEEL_YEARS_AHEAD, fields.year);
      return range(first, last);
    }
    case 'month':
      return range(1, 12);
    case 'day':
      return range(1, MAX_WHEEL_DAY);
    case 'hour':
      return range(0, 23);
    case 'minute':
      return range(0, 59);
  }
}

function range(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}
