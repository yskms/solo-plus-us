/**
 * §5.5 `preferences.timeFormat` display — the persisted setting decides
 * 12h vs 24h, never a hardcoded choice (v1 has no per-screen override).
 *
 * Every function here takes a `TFunction` (react-i18next's `t`, from the
 * calling component's `useTranslation()`) rather than importing the
 * `lib/i18n` singleton directly — this `lib/` module stays free of a
 * framework dependency, matching this codebase's habit of passing
 * dependencies explicitly (e.g. `SqlExecutor`). The month/AM-PM words
 * AND the surrounding format (word order, punctuation) both live in the
 * translation resources (`locales/*.json`'s `dateFormat.*`/`common.*`)
 * rather than a fixed English sentence with substituted words — Japanese
 * orders these differently (e.g. the period comes before the time).
 */
import type { TFunction } from 'i18next';
import { isValidLocalTime } from './datetime';
import { ValidationError } from './errors';
import type { TimeFormat } from '../types/Settings';

export function formatLocalTime(t: TFunction, localTime: string, format: TimeFormat): string {
  if (!isValidLocalTime(localTime)) {
    throw new ValidationError(`Not a valid local time: ${localTime}`);
  }
  const [h, m] = localTime.split(':').map(Number);
  const mm = String(m).padStart(2, '0');
  if (format === '24h') {
    return t('dateFormat.time24h', { hour: String(h).padStart(2, '0'), minute: mm });
  }
  const period = h < 12 ? t('common.am') : t('common.pm');
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return t('dateFormat.time12h', { hour: hour12, minute: mm, period });
}

/** Shared "Mon D, YYYY · time" display used by both Activity Detail (from stored `occurredLocalDate`/`occurredLocalTime`) and Add Activity's date/time picker (from a raw local `Date`) — kept as one function so the format only needs changing in one place. */
export function formatCalendarDateTime(t: TFunction, year: number, month0: number, day: number, localTime: string, format: TimeFormat): string {
  const months = t('common.months', { returnObjects: true }) as unknown as string[];
  const time = formatLocalTime(t, localTime, format);
  return t('dateFormat.calendarDateTime', { month: months[month0], day, year, time });
}

/** Same display as `formatCalendarDateTime`, but from a raw local `Date` (a date/time picker's in-progress value, not yet persisted as `occurredLocalDate`/`occurredLocalTime`) — used by both `app/record.tsx` and `app/activity/[id].tsx`'s pickers. */
export function formatPickedDateTime(t: TFunction, date: Date, format: TimeFormat): string {
  const localTime = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return formatCalendarDateTime(t, date.getFullYear(), date.getMonth(), date.getDate(), localTime, format);
}
