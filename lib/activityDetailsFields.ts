/**
 * 要件定義書 §6.3／UI/UX Screen 04・07a — Activity Details の表示項目
 * カスタマイズ。設定は「未記録の項目を編集画面に出すかどうか」だけを
 * 制御する不変条件があるため（§6.3「記録済みの値は、表示項目の設定に
 * 関わらず常に表示する」）、可視性の判定を設定値だけでなく Activity の
 * 実データからも決める必要がある——ここを1箇所に集約し、
 * `app/settings/activity-details.tsx`（設定一覧のラベル）と
 * `app/activity/[id].tsx`（実際の出し分け）の両方から参照する。
 */
import type { Activity } from '../types/Activity';
import type { SettingsMap } from '../types/Settings';

export type ActivityDetailField = 'orgasm' | 'ejaculation' | 'protection' | 'duration' | 'mood' | 'note';

export const ACTIVITY_DETAIL_FIELDS: readonly {
  field: ActivityDetailField;
  settingKey: Extract<keyof SettingsMap, `activityDetails.${string}`>;
  label: string;
}[] = [
  { field: 'orgasm', settingKey: 'activityDetails.orgasm', label: 'Orgasm' },
  { field: 'ejaculation', settingKey: 'activityDetails.ejaculation', label: 'Ejaculation' },
  { field: 'protection', settingKey: 'activityDetails.protection', label: 'Protection' },
  { field: 'duration', settingKey: 'activityDetails.duration', label: 'Duration' },
  // Screen 07a shows one row for both Mood rows — a single setting key gates them together.
  { field: 'mood', settingKey: 'activityDetails.mood', label: 'Mood before / after' },
  { field: 'note', settingKey: 'activityDetails.note', label: 'Notes' },
] as const;

type RecordedCheckSource = Pick<
  Activity,
  'orgasm' | 'ejaculation' | 'protectionUsed' | 'durationSeconds' | 'moodBefore' | 'moodAfter' | 'note'
>;

/** §6.3 invariant source of truth: does this Activity already have a value for `field`? */
export function hasRecordedValue(field: ActivityDetailField, activity: RecordedCheckSource): boolean {
  switch (field) {
    case 'orgasm':
      return activity.orgasm !== null;
    case 'ejaculation':
      return activity.ejaculation !== null;
    case 'protection':
      return activity.protectionUsed !== null;
    case 'duration':
      return activity.durationSeconds !== null;
    case 'mood':
      return activity.moodBefore !== null || activity.moodAfter !== null;
    case 'note':
      return activity.note !== null;
  }
}

/**
 * `revealed` is the per-visit "Add more details" selection (`AddMoreDetailsSheet`)
 * — never persisted, so re-opening the screen later falls back to settings +
 * recorded values only.
 */
export function isFieldVisible(
  field: ActivityDetailField,
  settingOn: boolean,
  activity: RecordedCheckSource,
  revealed: ReadonlySet<ActivityDetailField>,
): boolean {
  return settingOn || hasRecordedValue(field, activity) || revealed.has(field);
}
