/**
 * 基本設計 v0.11 §14 "平均間隔" — pure calculation, no DB access, so it's
 * unit-testable independent of the Repository query that supplies its
 * inputs (`ActivityRepository.getActivityTimeSpan`/`countAllActivities`).
 *
 * §14: `(最新 − 最古) ÷ (件数 − 1)` の実時間差。§14.2: UTC の差分で計算する
 * ("実時間差" — a DST-crossing period can be a day off from the person's
 * felt sense of the gap, which is the definition, not an error).
 */
import { parseStrictUtcIso } from './datetime';

const MS_PER_DAY = 86_400_000;

/** `null` when there are fewer than 2 activities (§14: "2件未満は「—」" — the caller renders that dash). */
export function averageIntervalDays(count: number, oldestOccurredAtUtc: string, newestOccurredAtUtc: string): number | null {
  if (count < 2) return null;
  const oldest = parseStrictUtcIso(oldestOccurredAtUtc);
  const newest = parseStrictUtcIso(newestOccurredAtUtc);
  return (newest.getTime() - oldest.getTime()) / (count - 1) / MS_PER_DAY;
}

/** §14 UI display rule: never blank, "—" for "not enough data" rather than an evaluative placeholder. */
export function formatAverageIntervalDays(days: number | null): string {
  if (days === null) return '—';
  return `${days.toFixed(1)} days`;
}
