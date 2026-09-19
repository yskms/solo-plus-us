/**
 * §5.5 `preferences.timeFormat` display — the persisted setting decides
 * 12h vs 24h, never a hardcoded choice (v1 has no per-screen override).
 */
import { isValidLocalTime } from './datetime';
import { ValidationError } from './errors';
import type { TimeFormat } from '../types/Settings';

export function formatLocalTime(localTime: string, format: TimeFormat): string {
  if (!isValidLocalTime(localTime)) {
    throw new ValidationError(`Not a valid local time: ${localTime}`);
  }
  const [h, m] = localTime.split(':').map(Number);
  const mm = String(m).padStart(2, '0');
  if (format === '24h') {
    return `${String(h).padStart(2, '0')}:${mm}`;
  }
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${mm} ${period}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Shared "Mon D, YYYY · time" display used by both Activity Detail (from stored `occurredLocalDate`/`occurredLocalTime`) and Add Activity's date/time picker (from a raw local `Date`) — kept as one function so the format only needs changing in one place. */
export function formatCalendarDateTime(year: number, month0: number, day: number, localTime: string, format: TimeFormat): string {
  return `${MONTHS[month0]} ${day}, ${year} · ${formatLocalTime(localTime, format)}`;
}

/** Same display as `formatCalendarDateTime`, but from a raw local `Date` (a date/time picker's in-progress value, not yet persisted as `occurredLocalDate`/`occurredLocalTime`) — used by both `app/record.tsx` and `app/activity/[id].tsx`'s pickers. */
export function formatPickedDateTime(date: Date, format: TimeFormat): string {
  const localTime = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return formatCalendarDateTime(date.getFullYear(), date.getMonth(), date.getDate(), localTime, format);
}
