/**
 * 基本設計 v0.11 §13.1/§13.4 (D-10) — strict restore validation.
 *
 * Pure: takes parsed JSON, returns a verdict. No DB access, so this can be
 * (and is) tested exhaustively without a database — the highest-value
 * place to catch a malformed backup, long before any transaction opens.
 *
 * The core rule (§13.1): "1件でもあれば確定しない" — a single invalid
 * Activity invalidates the whole file. This validator reflects that by
 * collecting *every* error it finds (for a useful report) while still
 * treating the result as all-or-nothing: `valid` is only ever `true` when
 * `errors` is empty.
 */
import {
  isLocalDateTimeConsistent,
  isValidLocalDate,
  isValidLocalTime,
  isValidOccurredAtUtc,
  isValidUtcIso,
} from '../lib/datetime';
import { isUuidV4 } from '../lib/id';
import { CURRENT_EXPORT_VERSION, type ExportActivityV1, type ExportFileV1, type ExportSettingsV1 } from '../types/Export';
import { EXPORTABLE_SETTING_KEYS, type SettingKey, type SettingsMap } from '../types/Settings';

export interface ImportValidationError {
  /** JSON-pointer-ish location, e.g. `activities[3].occurredAtUtc`, for a human-readable report. */
  path: string;
  message: string;
}

export type ImportValidationResult =
  | { valid: true; file: ExportFileV1; activityCount: number }
  | { valid: false; errors: ImportValidationError[] };

const REQUIRED_ACTIVITY_KEYS = [
  'id',
  'context',
  'occurredAtUtc',
  'occurredLocalDate',
  'occurredLocalTime',
  'timezoneOffsetMinutes',
  'timezoneId',
  'orgasm',
  'ejaculation',
  'protectionUsed',
  'durationSeconds',
  'moodBefore',
  'moodAfter',
  'note',
  'syncVersion',
  'createdAt',
  'updatedAt',
] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isBooleanOrNull(v: unknown): v is boolean | null {
  return v === null || typeof v === 'boolean';
}

/**
 * §D-23: "キーの欠落は不正。未記録は null。" — a missing key is a
 * different, invalid thing from a present key whose value is `null`. This
 * checks exactly that: every required key must be *present* (regardless
 * of value), and no unrecognized keys (§13's "現行 version" contract —
 * an unknown key at version 1 most likely means the file isn't really a
 * version-1 file, which the `version` field check should already have
 * caught, but this is a second line of defense).
 */
function validateActivityKeys(raw: Record<string, unknown>, path: string, errors: ImportValidationError[]): void {
  for (const key of REQUIRED_ACTIVITY_KEYS) {
    if (!(key in raw)) {
      errors.push({ path: `${path}.${key}`, message: 'missing key (§D-23: unrecorded values must be explicit null)' });
    }
  }
  const knownKeys = new Set<string>(REQUIRED_ACTIVITY_KEYS);
  for (const key of Object.keys(raw)) {
    if (!knownKeys.has(key)) {
      errors.push({ path: `${path}.${key}`, message: 'unrecognized key for export version 1' });
    }
  }
}

function validateActivity(raw: unknown, index: number, seenIds: Set<string>, errors: ImportValidationError[]): void {
  const path = `activities[${index}]`;
  if (!isPlainObject(raw)) {
    errors.push({ path, message: 'must be an object' });
    return;
  }

  validateActivityKeys(raw, path, errors);

  const id = raw.id;
  if (!isUuidV4(id)) {
    errors.push({ path: `${path}.id`, message: 'must be a UUID v4' });
  } else if (seenIds.has(id)) {
    errors.push({ path: `${path}.id`, message: `duplicate id within the file: ${id}` });
  } else {
    seenIds.add(id);
  }

  if (raw.context !== 'solo' && raw.context !== 'partnered') {
    errors.push({ path: `${path}.context`, message: `must be "solo" or "partnered", got ${JSON.stringify(raw.context)}` });
  }

  const occurredAtUtc = raw.occurredAtUtc;
  if (!isValidOccurredAtUtc(occurredAtUtc)) {
    errors.push({
      path: `${path}.occurredAtUtc`,
      message: 'not a valid UTC instant with :00 seconds (YYYY-MM-DDTHH:MM:00Z, §4.2)',
    });
  }

  const occurredLocalDate = raw.occurredLocalDate;
  if (!isValidLocalDate(occurredLocalDate)) {
    errors.push({ path: `${path}.occurredLocalDate`, message: 'not a valid YYYY-MM-DD' });
  }

  const occurredLocalTime = raw.occurredLocalTime;
  if (!isValidLocalTime(occurredLocalTime)) {
    errors.push({ path: `${path}.occurredLocalTime`, message: 'not a valid HH:MM' });
  }

  const offset = raw.timezoneOffsetMinutes;
  const offsetValid = typeof offset === 'number' && Number.isInteger(offset) && offset >= -840 && offset <= 840;
  if (!offsetValid) {
    errors.push({ path: `${path}.timezoneOffsetMinutes`, message: 'must be an integer between -840 and 840' });
  }

  if (
    offsetValid &&
    isValidOccurredAtUtc(occurredAtUtc) &&
    isValidLocalDate(occurredLocalDate) &&
    isValidLocalTime(occurredLocalTime) &&
    !isLocalDateTimeConsistent(occurredAtUtc as string, offset as number, occurredLocalDate as string, occurredLocalTime as string)
  ) {
    errors.push({
      path,
      message: 'occurredLocalDate/occurredLocalTime is not consistent with occurredAtUtc + timezoneOffsetMinutes (§4.1)',
    });
  }

  if (raw.timezoneId !== null && typeof raw.timezoneId !== 'string') {
    errors.push({ path: `${path}.timezoneId`, message: 'must be a string or null' });
  }

  for (const key of ['orgasm', 'ejaculation', 'protectionUsed'] as const) {
    if (!isBooleanOrNull(raw[key])) {
      errors.push({ path: `${path}.${key}`, message: 'must be boolean or null' });
    }
  }

  const duration = raw.durationSeconds;
  if (duration !== null && !(typeof duration === 'number' && Number.isInteger(duration) && duration > 0 && duration <= 86_400)) {
    errors.push({ path: `${path}.durationSeconds`, message: 'must be null or an integer in (0, 86400]' });
  }

  for (const key of ['moodBefore', 'moodAfter'] as const) {
    const v = raw[key];
    if (v !== null && !(typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5)) {
      errors.push({ path: `${path}.${key}`, message: 'must be null or an integer 1–5' });
    }
  }

  const note = raw.note;
  if (note !== null && !(typeof note === 'string' && note.length <= 2000)) {
    errors.push({ path: `${path}.note`, message: 'must be null or a string of at most 2000 characters' });
  }

  const syncVersion = raw.syncVersion;
  if (!(typeof syncVersion === 'number' && Number.isInteger(syncVersion) && syncVersion >= 1)) {
    errors.push({ path: `${path}.syncVersion`, message: 'must be an integer >= 1' });
  }

  const createdAt = raw.createdAt;
  const updatedAt = raw.updatedAt;
  if (!isValidUtcIso(createdAt)) {
    errors.push({ path: `${path}.createdAt`, message: 'not a valid UTC instant' });
  }
  if (!isValidUtcIso(updatedAt)) {
    errors.push({ path: `${path}.updatedAt`, message: 'not a valid UTC instant' });
  }
  if (isValidUtcIso(createdAt) && isValidUtcIso(updatedAt) && (updatedAt as string) < (createdAt as string)) {
    errors.push({ path, message: 'updatedAt is before createdAt' });
  }
}

/**
 * §13.3: unlike Activities, a bad settings value doesn't invalidate the
 * import — it's dropped, and the default is used instead (checked by
 * `services/ImportService`, not here). This function only narrows the
 * *type-valid* subset; it never itself fails the whole import.
 */
export function sanitizeImportedSettings(raw: unknown): ExportSettingsV1 {
  if (!isPlainObject(raw)) return {};
  const out: Partial<SettingsMap> = {};
  for (const key of EXPORTABLE_SETTING_KEYS) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (isSettingValueValid(key, value)) {
      (out as Record<SettingKey, unknown>)[key] = value;
    }
  }
  return out;
}

function isSettingValueValid(key: SettingKey, value: unknown): boolean {
  switch (key) {
    case 'activityDetails.orgasm':
    case 'activityDetails.ejaculation':
    case 'activityDetails.protection':
    case 'activityDetails.duration':
    case 'activityDetails.mood':
    case 'activityDetails.note':
      return typeof value === 'boolean';
    case 'preferences.firstDayOfWeek':
      return value === 'monday' || value === 'sunday';
    case 'preferences.timeFormat':
      return value === '12h' || value === '24h';
    case 'preferences.appearance':
      return value === 'system' || value === 'light' || value === 'dark';
    default:
      return false;
  }
}

export function validateExportFile(raw: unknown): ImportValidationResult {
  const errors: ImportValidationError[] = [];

  if (!isPlainObject(raw)) {
    return { valid: false, errors: [{ path: '', message: 'root must be an object' }] };
  }

  if (raw.version !== CURRENT_EXPORT_VERSION) {
    // D-24: an older version would need forward migration first (not
    // implemented — no older version exists yet); a newer version must be
    // rejected outright.
    return {
      valid: false,
      errors: [{ path: 'version', message: `unsupported export version: ${JSON.stringify(raw.version)} (expected ${CURRENT_EXPORT_VERSION})` }],
    };
  }

  if (!isValidUtcIso(raw.exportedAt)) {
    errors.push({ path: 'exportedAt', message: 'not a valid UTC instant' });
  }

  if (!Array.isArray(raw.activities)) {
    errors.push({ path: 'activities', message: 'must be an array' });
  } else {
    const seenIds = new Set<string>();
    raw.activities.forEach((activity, index) => validateActivity(activity, index, seenIds, errors));
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const activities = raw.activities as ExportActivityV1[];
  return {
    valid: true,
    file: {
      version: 1,
      exportedAt: raw.exportedAt as string,
      settings: sanitizeImportedSettings(raw.settings),
      activities,
    },
    activityCount: activities.length,
  };
}
