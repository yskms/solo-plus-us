/**
 * UI/UX §13 Calendar — pure month-grid math, no DB/native dependency so
 * it's fully unit-testable (mirrors `services/syncJobPlanner.ts`'s
 * pattern of keeping the parts that don't need I/O separately testable).
 *
 * Leading/trailing cells are `null` (blank), not adjacent-month dates —
 * the §13 mockup shows blank cells before day 1, not August's tail end.
 */
import type { FirstDayOfWeek } from '../types/Settings';

export interface CalendarCell {
  localDate: string; // 'YYYY-MM-DD'
  dayOfMonth: number;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Column index (0-6) of `localDate`'s weekday, given which weekday starts the grid. */
function columnIndexForWeekday(jsWeekday: number, firstDayOfWeek: FirstDayOfWeek): number {
  // Date.getUTCDay(): 0=Sunday..6=Saturday.
  return firstDayOfWeek === 'sunday' ? jsWeekday : (jsWeekday + 6) % 7;
}

/** `month` is 1-12. Every row has exactly 7 columns; the grid is padded with `null` at both ends. */
export function buildMonthGrid(year: number, month: number, firstDayOfWeek: FirstDayOfWeek): (CalendarCell | null)[] {
  const total = daysInMonth(year, month);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const leadingBlanks = columnIndexForWeekday(firstWeekday, firstDayOfWeek);

  const cells: (CalendarCell | null)[] = [];
  for (let i = 0; i < leadingBlanks; i++) cells.push(null);
  for (let day = 1; day <= total; day++) {
    cells.push({ localDate: `${year}-${pad2(month)}-${pad2(day)}`, dayOfMonth: day });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function weekdayHeaderLabels(firstDayOfWeek: FirstDayOfWeek): string[] {
  const mondayFirst = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const sundayFirst = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  return firstDayOfWeek === 'sunday' ? sundayFirst : mondayFirst;
}

/** `month` is 1-12; `delta` may be any integer (e.g. -1/+1 for prev/next, or a larger jump). Wraps the year correctly in both directions. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const zeroBasedTotal = year * 12 + (month - 1) + delta;
  const newYear = Math.floor(zeroBasedTotal / 12);
  const newMonth = ((zeroBasedTotal % 12) + 12) % 12;
  return { year: newYear, month: newMonth + 1 };
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export function localDateRangeForMonth(year: number, month: number): { fromLocalDate: string; toLocalDate: string } {
  const mm = pad2(month);
  return {
    fromLocalDate: `${year}-${mm}-01`,
    toLocalDate: `${year}-${mm}-${pad2(daysInMonth(year, month))}`,
  };
}
