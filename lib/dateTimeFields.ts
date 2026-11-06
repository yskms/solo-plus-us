/**
 * The arithmetic behind `components/DateTimeSelector.tsx` (Add Activity's
 * year / month / day / hour / minute chooser, §11.4). Kept free of React so
 * the rules can be unit-tested.
 *
 * The value is the five numbers (`DateTimeFields`), not a `Date`: setting
 * "Nov" on a `Date` that holds the 31st rolls it over to Dec 1, and the day
 * has to be pulled back to the end of the month instead (`setDateTimeField`).
 *
 * Every change is a tap (an arrow, or a row picked from a list), never a
 * scrolling finger, so correcting the value on the spot is safe. The old
 * scrolling wheels could not do that: a correction under the finger fought
 * it and froze the screen (D-56, D-57). The rules:
 *
 * - no "not in the future" rule: a future time can be chosen, and
 *   `app/record.tsx` asks for a confirmation when it is saved (D-56);
 * - the day always exists: the day list is built from the month, and the
 *   one place a field moves another is here: changing the year or the month
 *   pulls a day past the end of the new month back to its last day (Mar 31
 *   -> Nov gives Nov 30, Feb 29 -> a common year gives Feb 28). Nothing else
 *   is linked: wrapping the hour never changes the day;
 * - the minute moves in steps of `MINUTE_STEP`. A minute that is not on a
 *   step (the 37 of a "Just now" at 14:37) is shown as it is; the first arrow
 *   or list pick moves it onto the steps.
 *
 * `fromDateTimeFields` builds the `Date` via the runtime's *local*
 * constructor: the chooser shows the wall-clock digits in the device's
 * current zone; nothing here knows about zones.
 *
 * Known limitation (same as the old Android time dialog): a wall-clock time
 * that a DST transition skips over is shifted forward by the `Date`
 * constructor rather than rejected.
 */
export type DateTimeField = 'year' | 'month' | 'day' | 'hour' | 'minute';

/** Oldest year offered (earlier values extend the range, so an existing value is never off the list). */
export const MIN_YEAR = 2000;

/** How many years after the current one are offered. */
export const YEARS_AHEAD = 10;

/** The minute moves in steps of this many minutes. */
export const MINUTE_STEP = 5;

export interface DateTimeFields {
  year: number;
  month: number; // 1-12
  day: number; // 1-31, never past the end of the month
  hour: number; // 0-23
  minute: number; // 0-59
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function toDateTimeFields(date: Date): DateTimeFields {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
}

/** The `Date` for the fields, in the device's current zone. */
export function fromDateTimeFields(fields: DateTimeFields): Date {
  return new Date(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, 0, 0);
}

/**
 * The value after `field` is set to `n`. Changing the year or the month pulls
 * a day past the end of the new month back to its last day; nothing else moves.
 */
export function setDateTimeField(fields: DateTimeFields, field: DateTimeField, n: number): DateTimeFields {
  const next = { ...fields, [field]: n };
  if (field === 'year' || field === 'month') {
    next.day = Math.min(next.day, daysInMonth(next.year, next.month));
  }
  return next;
}

export function sameDateTimeFields(a: DateTimeFields, b: DateTimeFields): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute;
}

/**
 * Every field but the year wraps around with the arrows (12 -> 1, the last day
 * of the month -> 1, 23 -> 0, 55 -> 0). Nothing is linked: wrapping the hour
 * never changes the day. The year stops at both ends of its list.
 */
export function isLoopingDateTimeField(field: DateTimeField): boolean {
  return field !== 'year';
}

/**
 * The numbers each field offers, in order (top to bottom of the list). `now`
 * only decides where the year list ends. The day list is as long as the month
 * (`fields.year` / `fields.month` are read for it).
 */
export function dateTimeFieldValues(field: DateTimeField, fields: DateTimeFields, now: Date): number[] {
  switch (field) {
    case 'year': {
      const first = Math.min(MIN_YEAR, fields.year);
      const last = Math.max(now.getFullYear() + YEARS_AHEAD, fields.year);
      return range(first, last, 1);
    }
    case 'month':
      return range(1, 12, 1);
    case 'day':
      return range(1, daysInMonth(fields.year, fields.month), 1);
    case 'hour':
      return range(0, 23, 1);
    case 'minute':
      return range(0, 59, MINUTE_STEP);
  }
}

/**
 * The value after an arrow tap: the next number in the field's list above
 * (`direction` 1) or below (-1) the current one. It looks for the next number
 * rather than adding one, so a minute that is off the steps (37) goes to the
 * nearest step in that direction (40 up, 35 down). At the end of a looping
 * field it wraps without touching any other field; the year stays where it is.
 */
export function stepDateTimeField(
  fields: DateTimeFields,
  field: DateTimeField,
  direction: 1 | -1,
  now: Date,
): DateTimeFields {
  const values = dateTimeFieldValues(field, fields, now);
  const current = fields[field];
  const wraps = isLoopingDateTimeField(field);
  let target: number | undefined;
  if (direction === 1) {
    target = values.find((v) => v > current);
    if (target === undefined) target = wraps ? values[0] : current;
  } else {
    for (const v of values) if (v < current) target = v;
    if (target === undefined) target = wraps ? values[values.length - 1] : current;
  }
  return setDateTimeField(fields, field, target);
}

function range(first: number, last: number, step: number): number[] {
  return Array.from({ length: Math.floor((last - first) / step) + 1 }, (_, i) => first + i * step);
}
