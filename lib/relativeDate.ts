/**
 * UI/UX §2/§7 — "Last activity · 2 days ago". Pure day-difference math on
 * two `YYYY-MM-DD` local-date strings (never on UTC instants — §14 "曜日・
 * 時間帯は occurred_local_* 列で判定").
 */
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
export function formatRelativeLocalDate(activityLocalDate: string, todayLocalDate: string): string {
  const diff = toEpochDay(todayLocalDate) - toEpochDay(activityLocalDate);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return `${diff} days ago`;
}

const MONTH_ABBREVIATIONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** e.g. "Sep 14" — no year, for compact lists (Recent, Calendar's day panel). */
export function formatMonthDay(localDate: string): string {
  if (!isValidLocalDate(localDate)) {
    throw new ValidationError(`Not a valid local date: ${localDate}`);
  }
  const [, m, d] = localDate.split('-').map(Number);
  return `${MONTH_ABBREVIATIONS[m - 1]} ${d}`;
}
