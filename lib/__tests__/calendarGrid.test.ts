import i18n from '../i18n';
import { buildMonthGrid, weekdayHeaderLabels, shiftMonth, monthLabel, localDateRangeForMonth } from '../calendarGrid';

const en = i18n.getFixedT('en');
const ja = i18n.getFixedT('ja');

describe('buildMonthGrid', () => {
  it('pads leading blanks so day 1 lands in the correct Monday-first column', () => {
    // Sep 1, 2026 is a Tuesday -> 1 leading blank when the week starts on Monday.
    const grid = buildMonthGrid(2026, 9, 'monday');
    expect(grid[0]).toBeNull();
    expect(grid[1]).toEqual({ localDate: '2026-09-01', dayOfMonth: 1 });
  });

  it('pads leading blanks so day 1 lands in the correct Sunday-first column', () => {
    // Sep 1, 2026 is a Tuesday -> 2 leading blanks when the week starts on Sunday.
    const grid = buildMonthGrid(2026, 9, 'sunday');
    expect(grid[0]).toBeNull();
    expect(grid[1]).toBeNull();
    expect(grid[2]).toEqual({ localDate: '2026-09-01', dayOfMonth: 1 });
  });

  it('has zero leading blanks when the 1st already falls on the grid start', () => {
    // Nov 1, 2026 is a Sunday -> 0 leading blanks when the week starts on Sunday.
    const grid = buildMonthGrid(2026, 11, 'sunday');
    expect(grid[0]).toEqual({ localDate: '2026-11-01', dayOfMonth: 1 });
  });

  it('includes every day of the month in order', () => {
    const grid = buildMonthGrid(2026, 9, 'monday');
    const days = grid.filter((c) => c !== null).map((c) => c!.dayOfMonth);
    expect(days).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it('handles February in a leap year', () => {
    const grid = buildMonthGrid(2028, 2, 'monday');
    const days = grid.filter((c) => c !== null);
    expect(days).toHaveLength(29);
    expect(days[days.length - 1]).toEqual({ localDate: '2028-02-29', dayOfMonth: 29 });
  });

  it('handles February in a non-leap year', () => {
    const grid = buildMonthGrid(2026, 2, 'monday');
    const days = grid.filter((c) => c !== null);
    expect(days).toHaveLength(28);
  });

  it('pads trailing blanks so every row has exactly 7 columns', () => {
    const grid = buildMonthGrid(2026, 9, 'monday');
    expect(grid.length % 7).toBe(0);
    const lastDayIndex = grid.findIndex((c) => c?.localDate === '2026-09-30');
    expect(lastDayIndex).toBeGreaterThan(-1);
    // Everything after the last real day is a trailing blank, and there's at
    // least one (Sep 30, 2026 is a Wednesday, not a Sunday/Saturday).
    expect(grid.slice(lastDayIndex + 1).every((c) => c === null)).toBe(true);
    expect(grid.length - 1).toBeGreaterThan(lastDayIndex);
  });
});

describe('weekdayHeaderLabels', () => {
  it('starts with M for Monday-first', () => {
    expect(weekdayHeaderLabels(en, 'monday')).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
  });
  it('starts with S for Sunday-first', () => {
    expect(weekdayHeaderLabels(en, 'sunday')).toEqual(['S', 'M', 'T', 'W', 'T', 'F', 'S']);
  });
  it('translates to Japanese single-kanji weekday initials', () => {
    expect(weekdayHeaderLabels(ja, 'sunday')).toEqual(['日', '月', '火', '水', '木', '金', '土']);
    expect(weekdayHeaderLabels(ja, 'monday')).toEqual(['月', '火', '水', '木', '金', '土', '日']);
  });
});

describe('shiftMonth', () => {
  it('moves forward within the same year', () => {
    expect(shiftMonth(2026, 9, 1)).toEqual({ year: 2026, month: 10 });
  });
  it('moves backward within the same year', () => {
    expect(shiftMonth(2026, 9, -1)).toEqual({ year: 2026, month: 8 });
  });
  it('wraps forward into the next year', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });
  it('wraps backward into the previous year', () => {
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });
  it('handles a multi-year jump', () => {
    expect(shiftMonth(2026, 1, -14)).toEqual({ year: 2024, month: 11 });
  });
});

describe('monthLabel', () => {
  it('formats the full month name and year', () => {
    expect(monthLabel(en, 2026, 9)).toBe('September 2026');
  });
  it('formats year-first with 月 in Japanese', () => {
    expect(monthLabel(ja, 2026, 9)).toBe('2026年9月');
  });
});

describe('localDateRangeForMonth', () => {
  it('spans the first to last day of a 30-day month', () => {
    expect(localDateRangeForMonth(2026, 9)).toEqual({ fromLocalDate: '2026-09-01', toLocalDate: '2026-09-30' });
  });
  it('spans the first to last day of a leap February', () => {
    expect(localDateRangeForMonth(2028, 2)).toEqual({ fromLocalDate: '2028-02-01', toLocalDate: '2028-02-29' });
  });
});
