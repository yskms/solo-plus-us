/**
 * The arithmetic behind `components/DateTimeWheel.tsx` (Add Activity's
 * year / month / day / hour / minute wheels, §11.4). Kept free of React so
 * the clamping rules can be unit-tested.
 *
 * Like `instantForPastLocalDateAtNow`, this reads and builds `Date`s via
 * the runtime's *local* getters/constructor: the wheel shows the wall-clock
 * digits of whatever `Date` it's given, in the device's current zone. That's
 * also what makes it usable with a "digit carrier" (`nowAsZonedDigits`) if a
 * caller ever needs another zone's digits — nothing here knows about zones.
 *
 * Known limitation (same as the old Android time dialog): a wall-clock time
 * that a DST transition skips over is shifted forward by the `Date`
 * constructor rather than rejected.
 */
import { clampTo, truncateToMinute } from './datetime';

export type WheelField = 'year' | 'month' | 'day' | 'hour' | 'minute';

/** Oldest year the year wheel offers (earlier `value`s extend it, so an existing value is never off the wheel). */
export const MIN_WHEEL_YEAR = 2000;

export interface WheelFields {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
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

/** Builds the `Date`; a `day` past the end of the month (31 after switching to Feb) lands on the month's last day. */
export function fromWheelFields(fields: WheelFields): Date {
  const day = Math.min(fields.day, daysInMonth(fields.year, fields.month));
  return new Date(fields.year, fields.month - 1, day, fields.hour, fields.minute, 0, 0);
}

/**
 * The wheel value after one column settles on `n`. The result is never past
 * `max`: choosing a future year/month/day/hour/minute pulls the whole value
 * back to `max` (to the minute), and the wheels follow it.
 */
export function setWheelField(value: Date, field: WheelField, n: number, max: Date): Date {
  const next = fromWheelFields({ ...toWheelFields(value), [field]: n });
  return clampTo(next, truncateToMinute(max));
}

/**
 * Whether choosing `n` in `field` (with the other columns as in `value`) can
 * still lead to a time that isn't in the future: true when the *earliest*
 * moment of that period is not after `max`. Used to dim items that would
 * just snap back; an out-of-month day is never selectable.
 */
export function isWheelItemSelectable(value: Date, field: WheelField, n: number, max: Date): boolean {
  const f = toWheelFields(value);
  switch (field) {
    case 'year':
      return new Date(n, 0, 1).getTime() <= max.getTime();
    case 'month':
      return new Date(f.year, n - 1, 1).getTime() <= max.getTime();
    case 'day':
      if (n > daysInMonth(f.year, f.month)) return false;
      return new Date(f.year, f.month - 1, n).getTime() <= max.getTime();
    case 'hour':
      return new Date(f.year, f.month - 1, f.day, n).getTime() <= max.getTime();
    case 'minute':
      return new Date(f.year, f.month - 1, f.day, f.hour, n).getTime() <= max.getTime();
  }
}

/** The numbers each column offers, in wheel order (top to bottom). */
export function wheelFieldValues(field: WheelField, value: Date, max: Date): number[] {
  switch (field) {
    case 'year': {
      const first = Math.min(MIN_WHEEL_YEAR, value.getFullYear());
      const last = Math.max(max.getFullYear(), value.getFullYear());
      return range(first, last);
    }
    case 'month':
      return range(1, 12);
    case 'day':
      return range(1, 31);
    case 'hour':
      return range(0, 23);
    case 'minute':
      return range(0, 59);
  }
}

function range(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}
