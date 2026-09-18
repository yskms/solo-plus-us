/**
 * UI/UX §17 PREFERENCES — "Appearance" (system / light / dark).
 *
 * `constants/theme.ts`'s `useTheme()` reads `AppearanceContext` directly
 * (falling back to the OS scheme when there's no override, same as before
 * this existed) so every existing `useTheme()` call site picks up the
 * override for free. `AppearanceProvider` is mounted inside
 * `DatabaseProvider` (needs `useDatabase()`), same placement as
 * `ScreenshotBlockProvider` — `DatabaseProvider` itself calls `useTheme()`
 * before it's ready, and that call correctly sees no override (context
 * default `null`) rather than throwing.
 *
 * The context object itself lives in `constants/appearanceContext.ts`, not
 * here — see that file's doc comment for why (this file importing
 * `DatabaseContext`, which imports `constants/theme.ts`, would otherwise
 * form a cycle back through here).
 *
 * **This context's override is JS-only** (React context → `useColorScheme`
 * substitute). It does not, by itself, change what the *OS* thinks the
 * app's scheme is — the status bar, `Alert`, `@react-native-community/
 * datetimepicker`, and (on Android) the native window background all read
 * the real OS/AppCompat state, not this context. `applyNativeColorScheme`
 * below closes that gap with `Appearance.setColorScheme()`, which on
 * Android calls `AppCompatDelegate.setDefaultNightMode()` — the same
 * mechanism a system-level Day/Night switch would use. That, in turn, is
 * *why* `plugins/withAndroidNightColors.js` exists: switching night mode
 * only changes *which* resource set Android resolves (`values-night/`
 * over `values/`) — it doesn't fix anything if that resource set doesn't
 * define the color you need, which was exactly the sliver-of-white-during-
 * scene-transition bug this was added to fix (`android:windowBackground`
 * had no dark value to switch to).
 */
import React, { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance as RNAppearance } from 'react-native';
import { useDatabase } from './DatabaseContext';
import { useDataRevision } from './DataRevision';
import { getSetting, setSetting } from '../services/SettingsRepository';
import { logError } from '../lib/log';
import type { Appearance } from '../types/Settings';
import { AppearanceContext, type AppearanceContextValue } from '../constants/appearanceContext';

/** `'system'` maps to `'unspecified'` — RN/AppCompat's own "follow the OS" value. */
function applyNativeColorScheme(appearance: Appearance): void {
  RNAppearance.setColorScheme(appearance === 'system' ? 'unspecified' : appearance);
}

export function useAppearanceSetting(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error('useAppearanceSetting must be used within AppearanceProvider');
  return ctx;
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const db = useDatabase();
  // §13.3: Import (replace-restore) can silently change
  // `preferences.appearance` underneath this provider (it's in
  // `EXPORTABLE_SETTING_KEYS`) — without `revision` in the dependency
  // array below, the in-memory `appearance` (and the native scheme
  // applied from it) would stay stale until the app is restarted.
  const { revision } = useDataRevision();
  const [appearance, setAppearanceState] = useState<Appearance>('system');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const value = await getSetting(db, 'preferences.appearance');
        if (!cancelled) setAppearanceState(value);
      } catch (error) {
        logError('Loading preferences.appearance failed', error);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, revision]);

  // Deliberately separate from the load effect above: this also needs to
  // run right after `setAppearance` updates `appearance` locally (not just
  // after a DB read), and re-running the native call is idempotent/cheap.
  useEffect(() => {
    applyNativeColorScheme(appearance);
  }, [appearance]);

  const setAppearance = useCallback(
    async (next: Appearance) => {
      await setSetting(db, 'preferences.appearance', next);
      setAppearanceState(next);
    },
    [db],
  );

  const value = useMemo(() => ({ appearance, loaded, setAppearance }), [appearance, loaded, setAppearance]);

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}
