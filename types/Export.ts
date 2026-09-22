/**
 * 基本設計 v0.11 §12 — the JSON backup format. This is the actual product
 * safety mechanism (D-05/D-07: the DB is encrypted and excluded from OS
 * backup, so this file is the only way to recover from a lost device).
 *
 * `version` is the *export schema* version, tracked separately from the DB
 * `user_version` (§13.2) — they evolve independently and old export files
 * must remain readable by migrating them forward (D-24), not just accepted
 * as-is.
 */
import type { ActivityContext } from './Activity';
import type { SettingsMap } from './Settings';

export const CURRENT_EXPORT_VERSION = 1;

/**
 * One Activity as it appears in an export file. Same fields as `Activity`,
 * with the same `| null` contract (D-23: missing key = invalid, unrecorded
 * = explicit null) and JSON-native types, never stringified (D-42/I16 —
 * `"false"` is truthy in JS; an Export is an external contract and must not
 * carry that footgun).
 */
export interface ExportActivityV1 {
  id: string;
  context: ActivityContext;

  occurredAtUtc: string;
  occurredLocalDate: string;
  occurredLocalTime: string;
  timezoneOffsetMinutes: number;
  timezoneId: string | null;

  orgasm: boolean | null;
  ejaculation: boolean | null;
  protectionUsed: boolean | null;

  durationSeconds: number | null;
  moodBefore: number | null;
  moodAfter: number | null;
  note: string | null;

  syncVersion: number;

  createdAt: string;
  updatedAt: string;
}

/** Settings block is a partial map limited to `EXPORTABLE_SETTING_KEYS` (D-42). */
export type ExportSettingsV1 = Partial<
  Pick<
    SettingsMap,
    | 'activityDetails.orgasm'
    | 'activityDetails.ejaculation'
    | 'activityDetails.protection'
    | 'activityDetails.duration'
    | 'activityDetails.mood'
    | 'activityDetails.note'
    | 'activityDetails.orgasmDefault'
    | 'activityDetails.ejaculationDefault'
    | 'activityDetails.protectionDefault'
    | 'preferences.firstDayOfWeek'
    | 'preferences.timeFormat'
    | 'preferences.appearance'
  >
>;

export interface ExportFileV1 {
  version: 1;
  exportedAt: string;
  settings: ExportSettingsV1;
  activities: ExportActivityV1[];
}

/** Loosened shape for a file we haven't validated yet (§13.1/§13.4). */
export interface UnknownExportFile {
  version?: unknown;
  exportedAt?: unknown;
  settings?: unknown;
  activities?: unknown;
}
