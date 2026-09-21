/**
 * i18next singleton, imported once for its side effect (`app/_layout.tsx`,
 * same pattern as `import 'react-native-reanimated'` there) so it's
 * initialized before the first render.
 *
 * `contexts/Language.tsx` owns the *persisted* `preferences.language`
 * override and calls `i18n.changeLanguage()` once it has loaded that
 * setting from the DB — until then, this module's own `lng` (resolved
 * from the device locale) is what's shown, which is exactly what
 * `'system'` (the default) would resolve to anyway, so there's no
 * mismatch flash for the common case. See `contexts/Language.tsx`'s doc
 * comment for why no separate context-object file is needed here, unlike
 * `contexts/Appearance.tsx`/`constants/appearanceContext.ts`.
 *
 * **`Intl.PluralRules` polyfill is required, not optional, on this app's
 * actual Hermes runtime.** `lib/datetime.ts` already documents that
 * Hermes's `Intl` support has historically been partial — confirmed here
 * on-device (Pixel 11, 2026-09-21): `typeof Intl.PluralRules ===
 * 'undefined'`. i18next's plural key resolution (`_one`/`_other`
 * suffixes, used throughout `locales/*.json` — see the design decision
 * record) depends on `Intl.PluralRules` to pick the right suffix for the
 * active language; without it, i18next silently falls back to a
 * naive/English-shaped rule (`count === 1` selects `_one`) *regardless of
 * the active language*. Since `locales/ja.json` only defines `_other`
 * (CLDR: Japanese has no singular/plural distinction), that naive lookup
 * misses and i18next's `fallbackLng: 'en'` kicks in — the result was
 * every pluralized string showing its English `_one` text even with
 * Japanese selected, but only ever for count === 1 (other counts happened
 * to still land on `_other` in both languages, so this was easy to miss
 * casually — caught here only by checking "1 activity" specifically
 * on-device, not by `tsc`/`jest`, which don't exercise the real Hermes
 * runtime).
 *
 * Guarded behind a runtime check (and plain `require`, not a static
 * `import`) rather than always loading the polyfill:
 * - Node (Jest) already has `Intl.PluralRules`, and `@formatjs/intl-
 *   pluralrules`'s `polyfill.js` ships as unbuilt ESM — a static import
 *   of it fails Jest's default (non-node_modules-transforming) transform
 *   outright ("Cannot use import statement outside a module"). Since the
 *   `require` calls below are then simply never reached under Jest, this
 *   sidesteps that without touching `transformIgnorePatterns`.
 * - iOS's JSC engine has full `Intl.PluralRules` support, so this also
 *   avoids shipping/running unnecessary polyfill code there — Android/
 *   Hermes is the only runtime confirmed to need it.
 * Must run before `i18n.init()` below.
 */
if (typeof (Intl as { PluralRules?: unknown }).PluralRules === 'undefined') {
  require('@formatjs/intl-pluralrules/polyfill.js');
  require('@formatjs/intl-pluralrules/locale-data/en.js');
  require('@formatjs/intl-pluralrules/locale-data/ja.js');
}

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import en from '../../locales/en.json';
import ja from '../../locales/ja.json';

export const SUPPORTED_LANGUAGES = ['ja', 'en'] as const;
export type SupportedLanguageTag = (typeof SUPPORTED_LANGUAGES)[number];

/** Mirrors `services/SettingsRepository.ts`'s `resolveLocaleDefaults()`: reads the device's actual preference, falls back to `'en'` (this app's original hardcoded language) when unsupported. */
export function resolveSystemLanguage(): SupportedLanguageTag {
  const deviceLanguage = getLocales()[0]?.languageCode;
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(deviceLanguage ?? '')
    ? (deviceLanguage as SupportedLanguageTag)
    : 'en';
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ja: { translation: ja },
  },
  lng: resolveSystemLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
