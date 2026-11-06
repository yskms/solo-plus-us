import {
  MAX_WHEEL_DAY,
  MIN_WHEEL_YEAR,
  WHEEL_YEARS_AHEAD,
  daysInMonth,
  fromWheelFields,
  isLoopingWheelField,
  isValidWheelDate,
  sameWheelFields,
  setWheelField,
  toWheelFields,
  wheelFieldValues,
  type WheelFields,
} from '../dateTimeWheel';

// All Dates are built with the local constructor on purpose: the wheel works
// in the device's local wall-clock digits, whatever zone the test runs in.
const NOW = new Date(2026, 10, 4, 1, 5, 30); // 2026-11-04 01:05:30
const NOW_FIELDS: WheelFields = { year: 2026, month: 11, day: 4, hour: 1, minute: 5 };

describe('daysInMonth', () => {
  it('handles 30/31-day months and leap years', () => {
    expect(daysInMonth(2026, 11)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
  });
});

describe('toWheelFields / fromWheelFields', () => {
  it('round-trips and drops seconds', () => {
    expect(toWheelFields(NOW)).toEqual(NOW_FIELDS);
    expect(fromWheelFields(NOW_FIELDS)).toEqual(new Date(2026, 10, 4, 1, 5, 0, 0));
  });
});

describe('isValidWheelDate', () => {
  it('accepts the days a month has', () => {
    expect(isValidWheelDate({ ...NOW_FIELDS, day: 30 })).toBe(true); // Nov 30
    expect(isValidWheelDate({ ...NOW_FIELDS, month: 12, day: 31 })).toBe(true);
    expect(isValidWheelDate({ ...NOW_FIELDS, year: 2028, month: 2, day: 29 })).toBe(true);
  });

  it('rejects a day past the end of the month (the case the wheel now leaves to the save step)', () => {
    expect(isValidWheelDate({ ...NOW_FIELDS, day: 31 })).toBe(false); // Nov 31
    expect(isValidWheelDate({ ...NOW_FIELDS, month: 2, day: 30 })).toBe(false);
    expect(isValidWheelDate({ ...NOW_FIELDS, year: 2026, month: 2, day: 29 })).toBe(false);
  });
});

describe('setWheelField', () => {
  it('the case this wheel exists for: 01:05 on the 4th -> yesterday 23:00', () => {
    const day = setWheelField(NOW_FIELDS, 'day', 3);
    const hour = setWheelField(day, 'hour', 23);
    const minute = setWheelField(hour, 'minute', 0);
    expect(fromWheelFields(minute)).toEqual(new Date(2026, 10, 3, 23, 0));
  });

  it('changes one field and leaves the others alone', () => {
    expect(setWheelField(NOW_FIELDS, 'hour', 23)).toEqual({ ...NOW_FIELDS, hour: 23 });
    expect(setWheelField(NOW_FIELDS, 'minute', 40)).toEqual({ ...NOW_FIELDS, minute: 40 });
    expect(setWheelField(NOW_FIELDS, 'year', 2025)).toEqual({ ...NOW_FIELDS, year: 2025 });
  });

  it('does not move the day to fit the month: Nov 31 stays Nov 31 (it is checked at save time)', () => {
    const day31 = setWheelField(NOW_FIELDS, 'day', 31);
    expect(day31.day).toBe(31);
    expect(isValidWheelDate(day31)).toBe(false);
    // switching to a shorter month doesn't pull the day back either
    const march31: WheelFields = { year: 2026, month: 3, day: 31, hour: 12, minute: 0 };
    expect(setWheelField(march31, 'month', 2)).toEqual({ year: 2026, month: 2, day: 31, hour: 12, minute: 0 });
  });

  it('does not clamp: a time after "now" stays as picked (the case that used to freeze the reel)', () => {
    // 01:05 on the 4th, hour turned to 23 before the day was changed
    expect(fromWheelFields(setWheelField(NOW_FIELDS, 'hour', 23))).toEqual(new Date(2026, 10, 4, 23, 5));
    expect(fromWheelFields(setWheelField(NOW_FIELDS, 'month', 12))).toEqual(new Date(2026, 11, 4, 1, 5));
  });

  it('then changing the day gives yesterday 23:05', () => {
    const hour = setWheelField(NOW_FIELDS, 'hour', 23);
    expect(fromWheelFields(setWheelField(hour, 'day', 3))).toEqual(new Date(2026, 10, 3, 23, 5));
  });
});

describe('sameWheelFields', () => {
  it('compares all five numbers', () => {
    expect(sameWheelFields(NOW_FIELDS, { ...NOW_FIELDS })).toBe(true);
    expect(sameWheelFields(NOW_FIELDS, { ...NOW_FIELDS, minute: 6 })).toBe(false);
    expect(sameWheelFields(NOW_FIELDS, { ...NOW_FIELDS, day: 5 })).toBe(false);
  });
});

describe('isLoopingWheelField', () => {
  it('every column but the year wraps around', () => {
    expect(isLoopingWheelField('month')).toBe(true);
    expect(isLoopingWheelField('day')).toBe(true);
    expect(isLoopingWheelField('hour')).toBe(true);
    expect(isLoopingWheelField('minute')).toBe(true);
    expect(isLoopingWheelField('year')).toBe(false);
  });
});

describe('wheelFieldValues', () => {
  it('year runs from MIN_WHEEL_YEAR to WHEEL_YEARS_AHEAD past the current year', () => {
    const years = wheelFieldValues('year', NOW_FIELDS, NOW);
    expect(years[0]).toBe(MIN_WHEEL_YEAR);
    expect(years[years.length - 1]).toBe(2026 + WHEEL_YEARS_AHEAD);
    expect(years).toContain(2027); // later years than "now" can be picked
  });

  it('year extends below the minimum and above the end so the current value stays on the wheel', () => {
    expect(wheelFieldValues('year', { ...NOW_FIELDS, year: 1999 }, NOW)[0]).toBe(1999);
    const years = wheelFieldValues('year', { ...NOW_FIELDS, year: 2050 }, NOW);
    expect(years[years.length - 1]).toBe(2050);
  });

  it('the day column always has 1-31, whatever the month (so it never changes under the finger)', () => {
    const days = Array.from({ length: MAX_WHEEL_DAY }, (_, i) => i + 1);
    expect(wheelFieldValues('day', NOW_FIELDS, NOW)).toEqual(days); // November
    expect(wheelFieldValues('day', { ...NOW_FIELDS, month: 12 }, NOW)).toEqual(days);
    expect(wheelFieldValues('day', { ...NOW_FIELDS, month: 2 }, NOW)).toEqual(days);
  });

  it('fixed ranges for the other columns', () => {
    expect(wheelFieldValues('month', NOW_FIELDS, NOW)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(wheelFieldValues('hour', NOW_FIELDS, NOW)).toEqual(Array.from({ length: 24 }, (_, i) => i));
    expect(wheelFieldValues('minute', NOW_FIELDS, NOW)).toHaveLength(60);
  });
});
