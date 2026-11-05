/**
 * The arithmetic behind `components/DateTimeWheel.tsx` (Add Activity's
 * year / month / day / hour / minute wheels, §11.4). Kept free of React so
 * the rules can be unit-tested.
 *
 * There is deliberately no "not in the future" rule here: the wheel used to
 * pull a future pick back to "now", which made the reel jump back under the
 * finger (the case this wheel exists for, "just after midnight, record
 * 23:xx of the day before", passes through a future time on the way, since
 * the hour is turned before the day). `app/record.tsx` asks for a
 * confirmation at save time instead. Don't put a clamp back.
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
 * The wheel value after one column settles on `n`. Nothing is clamped (see
 * the file comment); a day past the end of the month lands on its last day.
 */
export function setWheelField(value: Date, field: WheelField, n: number): Date {
  return fromWheelFields({ ...toWheelFields(value), [field]: n });
}

/**
 * Hour and minute wrap around (23 sits above 0, 59 above 0), so the last
 * row of the previous period is one turn away. Nothing is linked: wrapping
 * the hour never changes the day, and wrapping the minute never changes the
 * hour. Year / month / day stay linear (days per month vary).
 */
export function isLoopingWheelField(field: WheelField): boolean {
  return field === 'hour' || field === 'minute';
}

/**
 * The numbers each column offers, in wheel order (top to bottom). `now` only
 * decides where the year column ends; the day column has exactly the days
 * of the month shown (no dimmed 31st in February).
 */
export function wheelFieldValues(field: WheelField, value: Date, now: Date): number[] {
  switch (field) {
    case 'year': {
      const first = Math.min(MIN_WHEEL_YEAR, value.getFullYear());
      const last = Math.max(now.getFullYear(), value.getFullYear());
      return range(first, last);
    }
    case 'month':
      return range(1, 12);
    case 'day':
      return range(1, daysInMonth(value.getFullYear(), value.getMonth() + 1));
    case 'hour':
      return range(0, 23);
    case 'minute':
      return range(0, 59);
  }
}

function range(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}
