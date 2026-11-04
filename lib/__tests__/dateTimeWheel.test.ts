import {
  MIN_WHEEL_YEAR,
  daysInMonth,
  fromWheelFields,
  isWheelItemSelectable,
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
    const day = setWheelField(NOW, 'day', 3, NOW);
    const hour = setWheelField(day, 'hour', 23, NOW);
    const minute = setWheelField(hour, 'minute', 0, NOW);
    expect(minute).toEqual(new Date(2026, 10, 3, 23, 0));
  });

  it('switching to a shorter month shortens the day instead of overflowing', () => {
    const value = new Date(2026, 2, 31, 12, 0); // Mar 31
    expect(setWheelField(value, 'month', 2, NOW)).toEqual(new Date(2026, 1, 28, 12, 0));
  });

  it('never goes past max: a future minute snaps back to max (to the minute)', () => {
    expect(setWheelField(NOW, 'minute', 40, NOW)).toEqual(new Date(2026, 10, 4, 1, 5));
  });

  it('a future month in the current year snaps back to max', () => {
    expect(setWheelField(NOW, 'month', 12, NOW)).toEqual(new Date(2026, 10, 4, 1, 5));
  });

  it('moving the year back keeps the other digits, moving to the max year clamps them', () => {
    const lastYear = setWheelField(new Date(2026, 5, 15, 8, 30), 'year', 2025, NOW);
    expect(lastYear).toEqual(new Date(2025, 5, 15, 8, 30));
    const dec = new Date(2025, 11, 20, 22, 0);
    expect(setWheelField(dec, 'year', 2026, NOW)).toEqual(new Date(2026, 10, 4, 1, 5));
  });

  it('allows exactly max', () => {
    expect(setWheelField(NOW, 'minute', 5, NOW)).toEqual(new Date(2026, 10, 4, 1, 5));
  });
});

describe('isWheelItemSelectable', () => {
  const value = new Date(2026, 10, 3, 23, 0); // Nov 3 23:00

  it('years after max are not selectable, max year is', () => {
    expect(isWheelItemSelectable(value, 'year', 2026, NOW)).toBe(true);
    expect(isWheelItemSelectable(value, 'year', 2027, NOW)).toBe(false);
  });

  it('months after max month are not selectable in the max year, but are in earlier years', () => {
    expect(isWheelItemSelectable(value, 'month', 11, NOW)).toBe(true);
    expect(isWheelItemSelectable(value, 'month', 12, NOW)).toBe(false);
    expect(isWheelItemSelectable(new Date(2025, 10, 3), 'month', 12, NOW)).toBe(true);
  });

  it('days after max day are not selectable; days beyond the month are never selectable', () => {
    expect(isWheelItemSelectable(value, 'day', 4, NOW)).toBe(true);
    expect(isWheelItemSelectable(value, 'day', 5, NOW)).toBe(false);
    expect(isWheelItemSelectable(new Date(2026, 9, 3), 'day', 31, NOW)).toBe(true);
    expect(isWheelItemSelectable(new Date(2026, 8, 3), 'day', 31, NOW)).toBe(false); // September
  });

  it('hours and minutes are only limited on the max day / max hour', () => {
    expect(isWheelItemSelectable(value, 'hour', 23, NOW)).toBe(true); // Nov 3
    const today = new Date(2026, 10, 4, 0, 0);
    expect(isWheelItemSelectable(today, 'hour', 1, NOW)).toBe(true);
    expect(isWheelItemSelectable(today, 'hour', 2, NOW)).toBe(false);
    const thisHour = new Date(2026, 10, 4, 1, 0);
    expect(isWheelItemSelectable(thisHour, 'minute', 5, NOW)).toBe(true);
    expect(isWheelItemSelectable(thisHour, 'minute', 6, NOW)).toBe(false);
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

  it('fixed ranges for the other columns', () => {
    expect(wheelFieldValues('month', NOW, NOW)).toHaveLength(12);
    expect(wheelFieldValues('day', NOW, NOW)).toHaveLength(31);
    expect(wheelFieldValues('hour', NOW, NOW)).toEqual(Array.from({ length: 24 }, (_, i) => i));
    expect(wheelFieldValues('minute', NOW, NOW)).toHaveLength(60);
  });
});
