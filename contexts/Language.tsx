/**
 * `preferences.language` (system / ja / en) — same shape as
 * `contexts/Appearance.tsx`'s `preferences.appearance`: a persisted
 * override, defaulting to `'system'` (follow the device).
 *
 * Unlike Appearance, this context doesn't need a separate
 * `constants/appearanceContext.ts`-style file to dodge a circular import.
 * That split exists because `constants/theme.ts`'s `useTheme()` reads
 * `AppearanceContext` directly, and `theme.ts` is itself imported by
 * `DatabaseContext.tsx` (which `contexts/Appearance.tsx` also imports) —
 * closing a cycle back on itself. Nothing outside React needs to read
 * *this* context: `react-i18next`'s `useTranslation()` subscribes to the
 * `lib/i18n` singleton's own `languageChanged` event directly, so every
 * `t()` call site re-renders on a language change without going through
 * this context at all. This context exists only to own the *persisted*
 * preference and call `i18n.changeLanguage()` — so it can import
 * `DatabaseContext` without restriction.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import i18n, { resolveSystemLanguage } from '../lib/i18n';
import { useDatabase } from './DatabaseContext';
import { useDataRevision } from './DataRevision';
import { getSetting, setSetting } from '../services/SettingsRepository';
import { logError } from '../lib/log';
import type { Language } from '../types/Settings';

function resolveLanguage(preference: Language): 'ja' | 'en' {
  return preference === 'system' ? resolveSystemLanguage() : preference;
}

export interface LanguageContextValue {
  language: Language;
  loaded: boolean;
  setLanguage: (next: Language) => Promise<void>;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function useLanguageSetting(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguageSetting must be used within LanguageProvider');
  return ctx;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const db = useDatabase();
  // §13.3: Import (replace-restore) can change `preferences.language`
  // underneath this provider (it's in `EXPORTABLE_SETTING_KEYS`) — without
  // `revision` here, the in-memory value (and the applied i18next
  // language) would stay stale until the app is restarted, same reasoning
  // as `contexts/Appearance.tsx`.
  const { revision } = useDataRevision();
  const [language, setLanguageState] = useState<Language>('system');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const value = await getSetting(db, 'preferences.language');
        if (!cancelled) setLanguageState(value);
      } catch (error) {
        logError('Loading preferences.language failed', error);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, revision]);

  useEffect(() => {
    i18n.changeLanguage(resolveLanguage(language)).catch((error) => logError('i18n.changeLanguage failed', error));
  }, [language]);

  // `resolveSystemLanguage()` above only re-runs when `language` itself
  // changes — it does NOT pick up the device's OS language actually
  // changing while `language === 'system'` and the app keeps running
  // (found in review). Re-check on every return to `active`, same
  // AppState-resume pattern this codebase already uses for other
  // OS-state-can-change-while-backgrounded cases (`lib/screenMask.ts`,
  // `contexts/AppLock.tsx`) — cheap (a sync `getLocales()` read) and a
  // no-op `changeLanguage()` call when nothing actually changed.
  const languageRef = useRef(language);
  languageRef.current = language;
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'active') return;
      if (languageRef.current !== 'system') return;
      i18n.changeLanguage(resolveSystemLanguage()).catch((error) => logError('i18n.changeLanguage (resume) failed', error));
    });
    return () => subscription.remove();
  }, []);

  const setLanguage = useCallback(
    async (next: Language) => {
      await setSetting(db, 'preferences.language', next);
      setLanguageState(next);
    },
    [db],
  );

  const value = useMemo(() => ({ language, loaded, setLanguage }), [language, loaded, setLanguage]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
