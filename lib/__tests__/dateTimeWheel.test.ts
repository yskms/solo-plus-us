import {
  MIN_WHEEL_YEAR,
  daysInMonth,
  fromWheelFields,
  isLoopingWheelField,
  setWheelField,
  toWheelFields,
  wheelFieldValues,
} from '../dateTimeWheel';

// All Dates are built with the local constructor on purpose: the wheel works
// in the device's local wall-clock digits, whatever zone the test runs in.
const NOW = new Date(2026, 10, 4, 1, 5, 30); // 2026-11-04 01:05:30

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
    const fields = toWheelFields(NOW);
    expect(fields).toEqual({ year: 2026, month: 11, day: 4, hour: 1, minute: 5 });
    expect(fromWheelFields(fields)).toEqual(new Date(2026, 10, 4, 1, 5, 0, 0));
  });

  it('moves a day past the end of the month onto its last day', () => {
    expect(fromWheelFields({ year: 2026, month: 2, day: 31, hour: 9, minute: 0 })).toEqual(new Date(2026, 1, 28, 9, 0));
    expect(fromWheelFields({ year: 2028, month: 2, day: 31, hour: 9, minute: 0 })).toEqual(new Date(2028, 1, 29, 9, 0));
  });
});

describe('setWheelField', () => {
  it('the case this wheel exists for: 01:05 on the 4th -> yesterday 23:00', () => {
    const day = setWheelField(NOW, 'day', 3);
    const hour = setWheelField(day, 'hour', 23);
    const minute = setWheelField(hour, 'minute', 0);
    expect(minute).toEqual(new Date(2026, 10, 3, 23, 0));
  });

  it('switching to a shorter month shortens the day instead of overflowing', () => {
    const value = new Date(2026, 2, 31, 12, 0); // Mar 31
    expect(setWheelField(value, 'month', 2)).toEqual(new Date(2026, 1, 28, 12, 0));
  });

  it('does not clamp: a time after "now" stays as picked (the case that used to freeze the reel)', () => {
    // 01:05 on the 4th, hour turned to 23 before the day was changed
    expect(setWheelField(NOW, 'hour', 23)).toEqual(new Date(2026, 10, 4, 23, 5));
    expect(setWheelField(NOW, 'minute', 40)).toEqual(new Date(2026, 10, 4, 1, 40));
    expect(setWheelField(NOW, 'month', 12)).toEqual(new Date(2026, 11, 4, 1, 5));
  });

  it('then changing the day gives yesterday 23:05', () => {
    const hour = setWheelField(NOW, 'hour', 23);
    expect(setWheelField(hour, 'day', 3)).toEqual(new Date(2026, 10, 3, 23, 5));
  });

  it('moving the year back keeps the other digits', () => {
    expect(setWheelField(new Date(2026, 5, 15, 8, 30), 'year', 2025)).toEqual(new Date(2025, 5, 15, 8, 30));
  });
});

describe('isLoopingWheelField', () => {
  it('only hour and minute wrap around', () => {
    expect(isLoopingWheelField('hour')).toBe(true);
    expect(isLoopingWheelField('minute')).toBe(true);
    expect(isLoopingWheelField('year')).toBe(false);
    expect(isLoopingWheelField('month')).toBe(false);
    expect(isLoopingWheelField('day')).toBe(false);
  });
});

describe('wheelFieldValues', () => {
  it('year runs from MIN_WHEEL_YEAR to max year', () => {
    const years = wheelFieldValues('year', NOW, NOW);
    expect(years[0]).toBe(MIN_WHEEL_YEAR);
    expect(years[years.length - 1]).toBe(2026);
  });

  it('year extends below the minimum so an older value stays on the wheel', () => {
    expect(wheelFieldValues('year', new Date(1999, 0, 1), NOW)[0]).toBe(1999);
  });

  it('the day column has exactly the days of the month shown', () => {
    expect(wheelFieldValues('day', new Date(2026, 10, 4), NOW)).toHaveLength(30); // November
    expect(wheelFieldValues('day', new Date(2026, 11, 4), NOW)).toHaveLength(31);
    expect(wheelFieldValues('day', new Date(2026, 1, 4), NOW)).toHaveLength(28);
    expect(wheelFieldValues('day', new Date(2028, 1, 4), NOW)).toHaveLength(29);
  });

  it('fixed ranges for the other columns', () => {
    expect(wheelFieldValues('month', NOW, NOW)).toHaveLength(12);
    expect(wheelFieldValues('hour', NOW, NOW)).toEqual(Array.from({ length: 24 }, (_, i) => i));
    expect(wheelFieldValues('minute', NOW, NOW)).toHaveLength(60);
  });
});
