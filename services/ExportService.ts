/**
 * 基本設計 v0.11 §12 — builds the JSON backup file.
 *
 * `health_sync` / `health_sync_jobs` are deliberately not exported (§12.2:
 * device-specific sync state, meaningless on another device/reinstall).
 * `settings` is limited to `EXPORTABLE_SETTING_KEYS` (D-42) — see
 * `types/Settings.ts` for why the rest (App Lock, Health Connect state)
 * stays out.
 */
import type { Transactor } from '../database/SqlExecutor';
import { findAllActivities } from '../repositories/ActivityRepository';
import { getSetting } from './SettingsRepository';
import { CURRENT_EXPORT_VERSION, type ExportActivityV1, type ExportFileV1 } from '../types/Export';
import { EXPORTABLE_SETTING_KEYS } from '../types/Settings';
import { nowUtcIso } from '../lib/datetime';

export async function buildExportPayload(db: Transactor): Promise<ExportFileV1> {
  let activities: Awaited<ReturnType<typeof findAllActivities>> = [];
  let settingsEntries: readonly (readonly [string, unknown])[] = [];

  // Reading Activities and settings as two separate, un-transacted calls
  // would let a write that happens in between produce an inconsistent
  // snapshot (activities from one moment, settings from another). Wrapping
  // the reads in a transaction — even though nothing is written — pins
  // both to one consistent point in time.
  await db.transaction(async (tx) => {
    activities = await findAllActivities(tx);
    settingsEntries = await Promise.all(
      EXPORTABLE_SETTING_KEYS.map(async (key) => [key, await getSetting(tx, key)] as const),
    );
  });

  return {
    version: CURRENT_EXPORT_VERSION,
    exportedAt: nowUtcIso(),
    settings: Object.fromEntries(settingsEntries) as ExportFileV1['settings'],
    activities: activities.map((activity) => ({
      id: activity.id,
      context: activity.context,
      occurredAtUtc: activity.occurredAtUtc,
      occurredLocalDate: activity.occurredLocalDate,
      occurredLocalTime: activity.occurredLocalTime,
      timezoneOffsetMinutes: activity.timezoneOffsetMinutes,
      timezoneId: activity.timezoneId,
      orgasm: activity.orgasm,
      ejaculation: activity.ejaculation,
      protectionUsed: activity.protectionUsed,
      durationSeconds: activity.durationSeconds,
      moodBefore: activity.moodBefore,
      moodAfter: activity.moodAfter,
      note: activity.note,
      syncVersion: activity.syncVersion,
      createdAt: activity.createdAt,
      updatedAt: activity.updatedAt,
    })),
  };
}

/** Pretty-printed — this file is meant to be human-inspectable, not just machine-readable (it's someone's only backup). */
export function serializeExportFile(file: ExportFileV1): string {
  return JSON.stringify(file, null, 2);
}

/**
 * §12.3 — CSV is a one-way export for spreadsheets/analysis, not an Import
 * target (§12.1: JSON alone is the recoverable/round-trip format). No
 * `settings`, `syncVersion`, `createdAt`/`updatedAt` — those exist for
 * restore fidelity, which CSV was never meant to provide.
 */
const CSV_COLUMNS = [
  'id',
  'context',
  'occurredLocalDate',
  'occurredLocalTime',
  'occurredAtUtc',
  'timezoneOffsetMinutes',
  'timezoneId',
  'orgasm',
  'ejaculation',
  'protectionUsed',
  'durationSeconds',
  'moodBefore',
  'moodAfter',
  'note',
] as const;

// OWASP CSV injection: a *string* field beginning with =, +, -, @ (or a
// tab/CR) can make spreadsheet software (Excel, Google Sheets) interpret
// it as a formula when the file is later opened. `note` is the only
// free-text field here, but this is scoped to `typeof value === 'string'`
// rather than to `note` specifically, since a couple of other columns
// (`id`, `occurredLocalDate`, `timezoneId`, ...) are also strings even
// though none of them could realistically start with these characters.
// Restricted to strings, not applied uniformly to every field's stringified
// form: `timezoneOffsetMinutes` is a *number* that is legitimately negative
// for every timezone west of UTC (e.g. -480 for Los Angeles) — `String(-480)`
// also matches this prefix, and prefixing a number with `'` turns it into
// text in every spreadsheet, breaking the numeric analysis §12.3 exists for.
const FORMULA_INJECTION_PREFIX = /^[=+\-@\t\r]/;

function csvField(value: string | number | boolean | null): string {
  if (value === null) return '';
  let text = String(value);
  if (typeof value === 'string' && FORMULA_INJECTION_PREFIX.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(activity: ExportActivityV1): string {
  return [
    activity.id,
    activity.context,
    activity.occurredLocalDate,
    activity.occurredLocalTime,
    activity.occurredAtUtc,
    activity.timezoneOffsetMinutes,
    activity.timezoneId,
    activity.orgasm,
    activity.ejaculation,
    activity.protectionUsed,
    activity.durationSeconds,
    activity.moodBefore,
    activity.moodAfter,
    activity.note,
  ]
    .map(csvField)
    .join(',');
}

export function serializeExportCsv(file: ExportFileV1): string {
  return [CSV_COLUMNS.join(','), ...file.activities.map(csvRow)].join('\r\n');
}
