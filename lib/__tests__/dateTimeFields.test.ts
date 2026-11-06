import {
  MIN_YEAR,
  MINUTE_STEP,
  YEARS_AHEAD,
  dateTimeFieldValues,
  daysInMonth,
  fromDateTimeFields,
  isLoopingDateTimeField,
  sameDateTimeFields,
  setDateTimeField,
  stepDateTimeField,
  toDateTimeFields,
  type DateTimeFields,
} from '../dateTimeFields';

// All Dates are built with the local constructor on purpose: the chooser works
// in the device's local wall-clock digits, whatever zone the test runs in.
const NOW = new Date(2026, 10, 4, 1, 5, 30); // 2026-11-04 01:05:30
const NOW_FIELDS: DateTimeFields = { year: 2026, month: 11, day: 4, hour: 1, minute: 5 };

describe('daysInMonth', () => {
  it('handles 30/31-day months and leap years', () => {
    expect(daysInMonth(2026, 11)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
  });
});

describe('toDateTimeFields / fromDateTimeFields', () => {
  it('round-trips and drops seconds', () => {
    expect(toDateTimeFields(NOW)).toEqual(NOW_FIELDS);
    expect(fromDateTimeFields(NOW_FIELDS)).toEqual(new Date(2026, 10, 4, 1, 5, 0, 0));
  });
});

describe('setDateTimeField', () => {
  it('the case this chooser exists for: 01:05 on the 4th -> yesterday 23:00', () => {
    const day = setDateTimeField(NOW_FIELDS, 'day', 3);
    const hour = setDateTimeField(day, 'hour', 23);
    const minute = setDateTimeField(hour, 'minute', 0);
    expect(fromDateTimeFields(minute)).toEqual(new Date(2026, 10, 3, 23, 0));
  });

  it('changes one field and leaves the others alone', () => {
    expect(setDateTimeField(NOW_FIELDS, 'hour', 23)).toEqual({ ...NOW_FIELDS, hour: 23 });
    expect(setDateTimeField(NOW_FIELDS, 'day', 31 - 1)).toEqual({ ...NOW_FIELDS, day: 30 });
  });

  it('does not correct a future time', () => {
    const future = setDateTimeField(NOW_FIELDS, 'year', 2030);
    expect(future.year).toBe(2030);
    expect(fromDateTimeFields(future).getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('pulls a day past the end of the new month back to its last day', () => {
    // Dec 31 -> Nov: 30 days
    expect(setDateTimeField({ ...NOW_FIELDS, month: 12, day: 31 }, 'month', 11)).toEqual({
      ...NOW_FIELDS,
      month: 11,
      day: 30,
    });
    // Mar 31 -> Feb of a common year: 28 days
    expect(setDateTimeField({ ...NOW_FIELDS, month: 3, day: 31 }, 'month', 2)).toEqual({
      ...NOW_FIELDS,
      month: 2,
      day: 28,
    });
  });

  it('pulls Feb 29 back to Feb 28 when the year is not a leap year', () => {
    const leapDay: DateTimeFields = { ...NOW_FIELDS, year: 2028, month: 2, day: 29 };
    expect(setDateTimeField(leapDay, 'year', 2027)).toEqual({ ...leapDay, year: 2027, day: 28 });
    expect(setDateTimeField(leapDay, 'year', 2032)).toEqual({ ...leapDay, year: 2032 }); // still a leap year
  });

  it('leaves a day that still exists alone when the month changes', () => {
    expect(setDateTimeField({ ...NOW_FIELDS, day: 15 }, 'month', 2)).toEqual({ ...NOW_FIELDS, month: 2, day: 15 });
  });

  it('only the year and the month move the day', () => {
    // Setting the day, hour or minute never touches another field.
    expect(setDateTimeField({ ...NOW_FIELDS, day: 30 }, 'hour', 23)).toEqual({ ...NOW_FIELDS, day: 30, hour: 23 });
  });
});

describe('sameDateTimeFields', () => {
  it('compares all five numbers', () => {
    expect(sameDateTimeFields(NOW_FIELDS, { ...NOW_FIELDS })).toBe(true);
    for (const field of ['year', 'month', 'day', 'hour', 'minute'] as const) {
      expect(sameDateTimeFields(NOW_FIELDS, { ...NOW_FIELDS, [field]: NOW_FIELDS[field] + 1 })).toBe(false);
    }
  });
});

describe('isLoopingDateTimeField', () => {
  it('every field but the year wraps', () => {
    expect(isLoopingDateTimeField('year')).toBe(false);
    for (const field of ['month', 'day', 'hour', 'minute'] as const) {
      expect(isLoopingDateTimeField(field)).toBe(true);
    }
  });
});

describe('dateTimeFieldValues', () => {
  it('offers the years from MIN_YEAR to YEARS_AHEAD after the current one', () => {
    const years = dateTimeFieldValues('year', NOW_FIELDS, NOW);
    expect(years[0]).toBe(MIN_YEAR);
    expect(years[years.length - 1]).toBe(2026 + YEARS_AHEAD);
    expect(years.length).toBe(2026 + YEARS_AHEAD - MIN_YEAR + 1);
  });

  it('extends the year range so the current value is never off the list', () => {
    const years = dateTimeFieldValues('year', { ...NOW_FIELDS, year: 1999 }, NOW);
    expect(years[0]).toBe(1999);
    const far = dateTimeFieldValues('year', { ...NOW_FIELDS, year: 2060 }, NOW);
    expect(far[far.length - 1]).toBe(2060);
  });

  it('month and hour have fixed lengths', () => {
    expect(dateTimeFieldValues('month', NOW_FIELDS, NOW)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const hours = dateTimeFieldValues('hour', NOW_FIELDS, NOW);
    expect(hours[0]).toBe(0);
    expect(hours[hours.length - 1]).toBe(23);
    expect(hours.length).toBe(24);
  });

  it('the day list is as long as the month', () => {
    expect(dateTimeFieldValues('day', NOW_FIELDS, NOW)).toHaveLength(30); // Nov
    expect(dateTimeFieldValues('day', { ...NOW_FIELDS, month: 12 }, NOW)).toHaveLength(31);
    expect(dateTimeFieldValues('day', { ...NOW_FIELDS, month: 2 }, NOW)).toHaveLength(28);
    expect(dateTimeFieldValues('day', { ...NOW_FIELDS, year: 2028, month: 2 }, NOW)).toHaveLength(29);
  });

  it('the minute list moves in steps', () => {
    const minutes = dateTimeFieldValues('minute', NOW_FIELDS, NOW);
    expect(minutes[0]).toBe(0);
    expect(minutes[1]).toBe(MINUTE_STEP);
    expect(minutes[minutes.length - 1]).toBe(60 - MINUTE_STEP);
    expect(minutes.length).toBe(60 / MINUTE_STEP);
  });
});

describe('stepDateTimeField', () => {
  it('moves hour, month and day by one', () => {
    expect(stepDateTimeField(NOW_FIELDS, 'hour', -1, NOW).hour).toBe(0);
    expect(stepDateTimeField(NOW_FIELDS, 'hour', 1, NOW).hour).toBe(2);
    expect(stepDateTimeField(NOW_FIELDS, 'day', -1, NOW).day).toBe(3);
    expect(stepDateTimeField(NOW_FIELDS, 'month', 1, NOW).month).toBe(12);
  });

  it('the "yesterday 23:00" case is four taps: day -1, hour -2, minute -1 step', () => {
    let fields = NOW_FIELDS; // 2026-11-04 01:05
    fields = stepDateTimeField(fields, 'day', -1, NOW);
    fields = stepDateTimeField(fields, 'hour', -1, NOW);
    fields = stepDateTimeField(fields, 'hour', -1, NOW);
    fields = stepDateTimeField(fields, 'minute', -1, NOW);
    expect(fromDateTimeFields(fields)).toEqual(new Date(2026, 10, 3, 23, 0));
  });

  it('wraps the hour without touching the day', () => {
    expect(stepDateTimeField({ ...NOW_FIELDS, hour: 23 }, 'hour', 1, NOW)).toEqual({ ...NOW_FIELDS, hour: 0 });
    expect(stepDateTimeField({ ...NOW_FIELDS, hour: 0 }, 'hour', -1, NOW)).toEqual({ ...NOW_FIELDS, hour: 23 });
  });

  it('wraps the minute without touching the hour', () => {
    const late = { ...NOW_FIELDS, minute: 55 };
    expect(stepDateTimeField(late, 'minute', 1, NOW)).toEqual({ ...late, minute: 0 });
    const early = { ...NOW_FIELDS, minute: 0 };
    expect(stepDateTimeField(early, 'minute', -1, NOW)).toEqual({ ...early, minute: 55 });
  });

  it('wraps the day within the month without touching the month', () => {
    // Nov has 30 days
    expect(stepDateTimeField({ ...NOW_FIELDS, day: 30 }, 'day', 1, NOW)).toEqual({ ...NOW_FIELDS, day: 1 });
    expect(stepDateTimeField({ ...NOW_FIELDS, day: 1 }, 'day', -1, NOW)).toEqual({ ...NOW_FIELDS, day: 30 });
    // Dec has 31
    const dec = { ...NOW_FIELDS, month: 12, day: 31 };
    expect(stepDateTimeField(dec, 'day', 1, NOW)).toEqual({ ...dec, day: 1 });
  });

  it('wraps the month and pulls the day back when the new month is shorter', () => {
    expect(stepDateTimeField({ ...NOW_FIELDS, month: 12, day: 31 }, 'month', 1, NOW)).toEqual({
      ...NOW_FIELDS,
      month: 1,
      day: 31,
    });
    // Dec 31 -> Nov: 30 days
    expect(stepDateTimeField({ ...NOW_FIELDS, month: 12, day: 31 }, 'month', -1, NOW)).toEqual({
      ...NOW_FIELDS,
      month: 11,
      day: 30,
    });
    // Jan 30 -> Feb: 28 days
    expect(stepDateTimeField({ ...NOW_FIELDS, month: 1, day: 30 }, 'month', 1, NOW)).toEqual({
      ...NOW_FIELDS,
      month: 2,
      day: 28,
    });
  });

  it('the year moves by one and pulls Feb 29 back', () => {
    expect(stepDateTimeField(NOW_FIELDS, 'year', 1, NOW).year).toBe(2027);
    const leapDay: DateTimeFields = { ...NOW_FIELDS, year: 2028, month: 2, day: 29 };
    expect(stepDateTimeField(leapDay, 'year', 1, NOW)).toEqual({ ...leapDay, year: 2029, day: 28 });
  });

  it('the year stops at the ends of its list', () => {
    const last = { ...NOW_FIELDS, year: 2026 + YEARS_AHEAD };
    expect(stepDateTimeField(last, 'year', 1, NOW)).toEqual(last);
    const first = { ...NOW_FIELDS, year: MIN_YEAR };
    expect(stepDateTimeField(first, 'year', -1, NOW)).toEqual(first);
  });

  describe('a minute that is not on a step (the 37 of "Just now" at 14:37)', () => {
    const off = { ...NOW_FIELDS, hour: 14, minute: 37 };

    it('goes to the nearest step in the direction of the arrow', () => {
      expect(stepDateTimeField(off, 'minute', 1, NOW).minute).toBe(40);
      expect(stepDateTimeField(off, 'minute', -1, NOW).minute).toBe(35);
    });

    it('wraps past the last step without changing the hour', () => {
      const late = { ...off, minute: 57 };
      expect(stepDateTimeField(late, 'minute', 1, NOW)).toEqual({ ...late, minute: 0 });
      const early = { ...off, minute: 2 };
      expect(stepDateTimeField(early, 'minute', -1, NOW)).toEqual({ ...early, minute: 0 });
    });

    it('on a step, a tap moves a whole step', () => {
      expect(stepDateTimeField({ ...off, minute: 40 }, 'minute', 1, NOW).minute).toBe(45);
      expect(stepDateTimeField({ ...off, minute: 40 }, 'minute', -1, NOW).minute).toBe(35);
    });
  });
});
