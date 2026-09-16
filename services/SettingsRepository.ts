/**
 * 基本設計 v0.11 §5.5 (D-37) — typed access to `app_settings`.
 *
 * This is the *only* place that knows how each `SettingKey` round-trips to
 * the TEXT column (`value`) and what its default is. UI code and other
 * services import from here, never touch `app_settings` via raw SQL.
 */
import { nowUtcIso } from '../lib/datetime';
import type { SqlExecutor } from '../database/SqlExecutor';
import { STATIC_DEFAULTS, type SettingKey, type SettingsMap } from '../types/Settings';

function encode<K extends SettingKey>(value: SettingsMap[K]): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function decode<K extends SettingKey>(key: K, raw: string): SettingsMap[K] {
  if (raw === 'null') return null as SettingsMap[K];
  if (raw === 'true') return true as SettingsMap[K];
  if (raw === 'false') return false as SettingsMap[K];
  return raw as SettingsMap[K];
}

/** Resolves `firstDayOfWeek`/`timeFormat` from locale *once* — never stored as the literal string `'locale'` (§5.5: a later locale change must not reorder existing history). */
function resolveLocaleDefaults(): Pick<SettingsMap, 'preferences.firstDayOfWeek' | 'preferences.timeFormat'> {
  let region: string | undefined;
  let hourCycle: string | undefined;
  try {
    const resolved = new Intl.DateTimeFormat().resolvedOptions();
    region = new Intl.Locale(resolved.locale).maximize().region;
    hourCycle = resolved.hourCycle;
  } catch {
    // Intl.Locale unsupported/region unavailable — fall through to defaults below.
  }

  // Countries where Monday is the conventional first day of the week are the
  // majority globally; Sunday-first is the narrower exception.
  const sundayFirstRegions = new Set(['US', 'CA', 'MX', 'JP', 'KR', 'BR', 'PH', 'TW', 'HK', 'IL']);
  const firstDayOfWeek = region && sundayFirstRegions.has(region) ? 'sunday' : 'monday';
  const timeFormat = hourCycle === 'h11' || hourCycle === 'h12' ? '12h' : '24h';

  return { 'preferences.firstDayOfWeek': firstDayOfWeek, 'preferences.timeFormat': timeFormat };
}

export async function getSetting<K extends SettingKey>(
  executor: SqlExecutor,
  key: K,
): Promise<SettingsMap[K]> {
  const result = await executor.execute('SELECT value FROM app_settings WHERE key = ?', [key]);
  const row = result.rows?.[0] as { value?: string } | undefined;
  if (row?.value !== undefined) {
    return decode(key, row.value);
  }

  const localeDefaults = resolveLocaleDefaults();
  if (key in localeDefaults) {
    return (localeDefaults as SettingsMap)[key];
  }
  return STATIC_DEFAULTS[key as keyof typeof STATIC_DEFAULTS] as SettingsMap[K];
}

export async function setSetting<K extends SettingKey>(
  executor: SqlExecutor,
  key: K,
  value: SettingsMap[K],
): Promise<void> {
  await executor.execute(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, encode(value), nowUtcIso()],
  );
}

/**
 * Called once at first launch (before any screen reads settings) so that
 * `firstDayOfWeek`/`timeFormat` are persisted as concrete values rather
 * than re-resolved from locale on every read.
 */
export async function ensureLocaleDefaultsPersisted(executor: SqlExecutor): Promise<void> {
  const existing = await executor.execute(
    "SELECT key FROM app_settings WHERE key IN ('preferences.firstDayOfWeek', 'preferences.timeFormat')",
  );
  if ((existing.rows ?? []).length > 0) return;

  const defaults = resolveLocaleDefaults();
  await setSetting(executor, 'preferences.firstDayOfWeek', defaults['preferences.firstDayOfWeek']);
  await setSetting(executor, 'preferences.timeFormat', defaults['preferences.timeFormat']);
}

export async function getAllSettings(executor: SqlExecutor): Promise<SettingsMap> {
  const keys: SettingKey[] = [
    'activityDetails.orgasm',
    'activityDetails.ejaculation',
    'activityDetails.protection',
    'activityDetails.duration',
    'activityDetails.mood',
    'activityDetails.note',
    'preferences.firstDayOfWeek',
    'preferences.timeFormat',
    'preferences.appearance',
    'appLock.enabled',
    'appLock.timing',
    'healthConnect.enabled',
    'healthConnect.lastSyncedAt',
  ];
  const entries = await Promise.all(keys.map(async (key) => [key, await getSetting(executor, key)] as const));
  return Object.fromEntries(entries) as unknown as SettingsMap;
}
