/**
 * A strict `CustomTypeOptions` module augmentation (typing `t()`'s key
 * argument against `locales/en.json`) was tried here and reverted:
 * react-i18next's overload resolution for a resource tree this size
 * (150+ leaf keys, growing) started silently mis-resolving `t()` calls
 * added later in the JSON to the wrong overload — a plain interpolated
 * key like `components.activityRow.a11yLabel` (`"{{context}} activity,
 * {{date}}"`) got typed as if it took no interpolation object at all,
 * rejecting perfectly valid `t(key, { context, date })` calls, while an
 * earlier-declared sibling key with the identical shape (`calendar.
 * dayCellA11y.withActivities`) kept working — a TS instantiation-depth
 * artifact, not a real type error. Key-typo safety instead comes from a
 * grep-based check (script run manually, comparing every `t('...')`
 * call site in the app against `locales/en.json`/`locales/ja.json`) — see
 * the i18n section of this project's docs/CLAUDE.md rather than the
 * compiler.
 */
export {};
