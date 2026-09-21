/**
 * 基本設計 v0.11 §14 "平均間隔" — pure calculation, no DB access, so it's
 * unit-testable independent of the Repository query that supplies its
 * inputs (`ActivityRepository.getActivityTimeSpan`/`countAllActivities`).
 *
 * §14: `(最新 − 最古) ÷ (件数 − 1)` の実時間差。§14.2: UTC の差分で計算する
 * ("実時間差" — a DST-crossing period can be a day off from the person's
 * felt sense of the gap, which is the definition, not an error).
 */
import type { TFunction } from 'i18next';
import { parseStrictUtcIso } from './datetime';

const MS_PER_DAY = 86_400_000;

/** `null` when there are fewer than 2 activities (§14: "2件未満は「—」" — the caller renders that dash). */
export function averageIntervalDays(count: number, oldestOccurredAtUtc: string, newestOccurredAtUtc: string): number | null {
  if (count < 2) return null;
  const oldest = parseStrictUtcIso(oldestOccurredAtUtc);
  const newest = parseStrictUtcIso(newestOccurredAtUtc);
  return (newest.getTime() - oldest.getTime()) / (count - 1) / MS_PER_DAY;
}

/**
 * §14 UI display rule: never blank, "—" for "not enough data" rather than
 * an evaluative placeholder. Below 1 day, switches to hours, and below 1
 * hour, to minutes — "0.0 days" (or, one tier down, "0.0 hours") for two
 * records a few minutes apart reads as "recorded at the same instant,"
 * which isn't what happened. Minutes is as fine as this needs to go:
 * `occurred_at_utc` is itself minute-precision (§4.2, seconds always
 * `:00`), so a "seconds" tier below this would only ever show noise from
 * the division, not a real recorded distinction. Singular "day"/"hour"/
 * "minute" only for a value that rounds to exactly 1.0, matching how the
 * rounded number reads ("1.0 day", not "1.0 days") — delegated to
 * `t()`'s `count`-based plural selection (`Intl.PluralRules`), same as
 * this file's `count === '1.0'` check used to do by hand. `t` is passed
 * in (react-i18next's `TFunction`) rather than imported — see
 * `lib/timeFormat.ts`'s doc comment for why.
 */
export function formatAverageIntervalDays(t: TFunction, days: number | null): string {
  if (days === null) return '—';

  const hours = days * 24;
  if (hours < 1) {
    const value = (hours * 60).toFixed(1);
    return t('statistics.minutes', { count: Number(value), value });
  }
  if (days < 1) {
    const value = hours.toFixed(1);
    return t('statistics.hours', { count: Number(value), value });
  }
  const value = days.toFixed(1);
  return t('statistics.days', { count: Number(value), value });
}
