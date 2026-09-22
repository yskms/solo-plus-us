/**
 * 基本設計 v0.11 §5.5 — `app_settings`.
 *
 * Stored encrypted (D-37): what a person tracks (e.g. "shows Ejaculation")
 * is itself sensitive, close to the record content, so it doesn't belong in
 * plaintext AsyncStorage.
 *
 * DB storage is TEXT key/value; this file is the only place that knows the
 * real type of each key (D-42 type boundary) and which keys are allowed
 * into an Export (D-42/D-44 — an explicit list, never a wildcard, because a
 * wildcard silently admits future device-local keys).
 */

export type FirstDayOfWeek = 'monday' | 'sunday';
export type TimeFormat = '12h' | '24h';
export type Appearance = 'system' | 'light' | 'dark';
export type Language = 'system' | 'ja' | 'en';
export type AppLockTiming = 'immediately' | '1m' | '5m';

export interface SettingsMap {
  'activityDetails.orgasm': boolean;
  'activityDetails.ejaculation': boolean;
  'activityDetails.protection': boolean;
  'activityDetails.duration': boolean;
  'activityDetails.mood': boolean;
  'activityDetails.note': boolean;

  /**
   * Quick Record (`app/record.tsx`) never asks about these fields (§6.4),
   * so a new Activity is always created with `null` for them unless a
   * default is configured here. `null` = no default configured, i.e. the
   * original "always unrecorded" behavior.
   *
   * orgasmDefault/ejaculationDefault are only applied by
   * `ActivityService.recordActivity` when the matching `activityDetails.*`
   * visibility key above is also `true` — a default left over from a field
   * that's since been turned off must not silently resurrect it (the
   * §6.3 invariant treats any non-null value as "recorded", which would
   * force the field visible again).
   *
   * protectionDefault is different (D-54): it's applied only when the new
   * Activity's context is `'partnered'`, entirely independent of
   * `activityDetails.protection` — that toggle governs Solo's visibility,
   * while D-52 already makes Protection force-visible for Partnered
   * regardless of it. Solo never gets an automatic Protection value.
   */
  'activityDetails.orgasmDefault': boolean | null;
  'activityDetails.ejaculationDefault': boolean | null;
  'activityDetails.protectionDefault': boolean | null;

  'preferences.firstDayOfWeek': FirstDayOfWeek;
  'preferences.timeFormat': TimeFormat;
  'preferences.appearance': Appearance;
  'preferences.language': Language;

  'appLock.enabled': boolean;
  'appLock.timing': AppLockTiming;

  /** §18/D-47: screenshot/screen-recording block is opt-in (default off) — Recent Apps preview hiding is the only always-on protection. See lib/screenMask.ts. */
  'privacy.blockScreenshots': boolean;

  'healthConnect.enabled': boolean;
  /** null = never synced. Reset on replace-restore (D-42) — see ImportService. */
  'healthConnect.lastSyncedAt': string | null;
}

export type SettingKey = keyof SettingsMap;

/**
 * §5.5 static defaults. `firstDayOfWeek` / `timeFormat` are resolved from
 * locale *once*, at first launch, and stored as a concrete value — never
 * `'locale'` as a literal setting value (D-42: a locale change on the
 * device must not silently reorder ten years of calendar history).
 */
export const STATIC_DEFAULTS: Pick<
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
  | 'preferences.appearance'
  | 'preferences.language'
  | 'appLock.enabled'
  | 'appLock.timing'
  | 'privacy.blockScreenshots'
  | 'healthConnect.enabled'
  | 'healthConnect.lastSyncedAt'
> = {
  'activityDetails.orgasm': true,
  'activityDetails.ejaculation': false,
  'activityDetails.protection': false,
  'activityDetails.duration': false,
  'activityDetails.mood': false,
  'activityDetails.note': true,

  'activityDetails.orgasmDefault': null,
  'activityDetails.ejaculationDefault': null,
  'activityDetails.protectionDefault': null,

  'preferences.appearance': 'system',
  'preferences.language': 'system',

  'appLock.enabled': false,
  'appLock.timing': 'immediately',

  'privacy.blockScreenshots': false,

  'healthConnect.enabled': false,
  'healthConnect.lastSyncedAt': null,
};

/**
 * §12.2.1/D-42: the explicit Export allowlist. `preferences.firstDayOfWeek`
 * and `preferences.timeFormat` are resolved at first launch (not statically
 * defaulted here) but are still exportable.
 */
export const EXPORTABLE_SETTING_KEYS: readonly SettingKey[] = [
  'activityDetails.orgasm',
  'activityDetails.ejaculation',
  'activityDetails.protection',
  'activityDetails.duration',
  'activityDetails.mood',
  'activityDetails.note',
  'activityDetails.orgasmDefault',
  'activityDetails.ejaculationDefault',
  'activityDetails.protectionDefault',
  'preferences.firstDayOfWeek',
  'preferences.timeFormat',
  'preferences.appearance',
  'preferences.language',
] as const;

/**
 * §13.3.1: on replace-restore, keys NOT in the export are handled per this
 * split — device-owned settings are kept, sync-state-derived values are
 * reset (keeping them would recreate exactly the misleading display the
 * allowlist was meant to avoid, e.g. a stale "Last synced").
 */
export const DEVICE_OWNED_SETTING_KEYS: readonly SettingKey[] = [
  'appLock.enabled',
  'appLock.timing',
  'privacy.blockScreenshots',
  'healthConnect.enabled',
] as const;

export const SYNC_DERIVED_SETTING_KEYS: readonly SettingKey[] = [
  'healthConnect.lastSyncedAt',
] as const;
