/**
 * UI/UX §2/§7 — "Last activity · 2 days ago". Pure day-difference math on
 * two `YYYY-MM-DD` local-date strings (never on UTC instants — §14 "曜日・
 * 時間帯は occurred_local_* 列で判定").
 *
 * `t` is passed in (react-i18next's `TFunction`) rather than imported —
 * see `lib/timeFormat.ts`'s doc comment for why.
 */
import type { TFunction } from 'i18next';
import { isValidLocalDate } from './datetime';
import { ValidationError } from './errors';

function toEpochDay(localDate: string): number {
  if (!isValidLocalDate(localDate)) {
    throw new ValidationError(`Not a valid local date: ${localDate}`);
  }
  const [y, m, d] = localDate.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** §19: strictly factual, never evaluative — "7 days ago" is fine, "Great job!" is not. */
export function formatRelativeLocalDate(t: TFunction, activityLocalDate: string, todayLocalDate: string): string {
  const diff = toEpochDay(todayLocalDate) - toEpochDay(activityLocalDate);
  if (diff <= 0) return t('relativeDate.today');
  if (diff === 1) return t('relativeDate.yesterday');
  return t('relativeDate.daysAgo', { count: diff });
}

/** e.g. "Sep 14" — no year, for compact lists (Recent, Calendar's day panel). */
export function formatMonthDay(t: TFunction, localDate: string): string {
  if (!isValidLocalDate(localDate)) {
    throw new ValidationError(`Not a valid local date: ${localDate}`);
  }
  const [, m, d] = localDate.split('-').map(Number);
  const months = t('common.months', { returnObjects: true }) as unknown as string[];
  return t('dateFormat.monthDay', { month: months[m - 1], day: d });
}
