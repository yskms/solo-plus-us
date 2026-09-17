/**
 * 基本設計 v0.11 §8.3 / UI/UX §19 — App Lock is a screen-visibility gate,
 * completely independent from the DB encryption key (§8.3 "この2つの状態を
 * 結合しない"). This provider never touches `database/key.ts` or the DB
 * connection — it only decides whether to render `children` or a
 * `LockScreen` on top of them. The DB opens and stays open regardless of
 * lock state; locking only withholds rendering the UI that would display
 * its contents.
 *
 * No app-specific PIN, no bypass — `expo-local-authentication` (device
 * biometrics, falling back to device passcode by default) is the only way
 * through, per "アプリ独自の PIN を実装しない" (UI/UX §19): a recovery path
 * for a forgotten PIN would make the lock either bypassable or a second
 * way to get permanently locked out, on top of the existing §8.5 Recovery
 * flow for a lost DB key.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useDatabase } from './DatabaseContext';
import { getSetting } from '../services/SettingsRepository';
import { LockScreen } from '../components/LockScreen';
import { shouldLockOnResume } from '../lib/appLockTiming';
import type { AppLockTiming } from '../types/Settings';

function isBackgroundish(state: AppStateStatus): boolean {
  return state === 'background' || state === 'inactive';
}

interface AppLockRefreshContextValue {
  /** Called by the App Lock settings screen right after saving, so a change takes effect on the very next background→foreground cycle without waiting on this provider's own polling. */
  refreshAppLockSettings: () => Promise<void>;
}

const AppLockRefreshContext = createContext<AppLockRefreshContextValue | null>(null);

export function useAppLockRefresh(): AppLockRefreshContextValue {
  const ctx = useContext(AppLockRefreshContext);
  if (!ctx) throw new Error('useAppLockRefresh must be used within AppLockProvider');
  return ctx;
}

export function AppLockProvider({ children }: { children: ReactNode }) {
  const db = useDatabase();
  const [enabled, setEnabled] = useState(false);
  const [timing, setTiming] = useState<AppLockTiming>('immediately');
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  // Cold start defaults to locked: there is no in-memory "backgrounded at"
  // state to consult on a fresh process, so a cold start with App Lock
  // enabled is treated the same as "Immediately" regardless of the
  // configured timing — erring toward *not* locking on launch would defeat
  // the point of the setting.
  const [locked, setLocked] = useState(true);
  const backgroundedAtRef = useRef<number | null>(null);
  const appStateRef = useRef(AppState.currentState);

  const refreshAppLockSettings = useCallback(async () => {
    const [nextEnabled, nextTiming] = await Promise.all([
      getSetting(db, 'appLock.enabled'),
      getSetting(db, 'appLock.timing'),
    ]);
    setEnabled(nextEnabled);
    setTiming(nextTiming);
    if (!nextEnabled) setLocked(false);
    setSettingsLoaded(true);
  }, [db]);

  useEffect(() => {
    refreshAppLockSettings();
  }, [refreshAppLockSettings]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      const prev = appStateRef.current;
      if (prev === 'active' && isBackgroundish(next)) {
        backgroundedAtRef.current = Date.now();
      } else if (isBackgroundish(prev) && next === 'active') {
        if (shouldLockOnResume({ enabled, timing, backgroundedAtMs: backgroundedAtRef.current, nowMs: Date.now() })) {
          setLocked(true);
        }
        backgroundedAtRef.current = null;
        // Pick up a setting change made while backgrounded (e.g. restored
        // via Import) without needing a separate polling mechanism.
        refreshAppLockSettings();
      }
      appStateRef.current = next;
    });
    return () => subscription.remove();
  }, [enabled, timing, refreshAppLockSettings]);

  if (!settingsLoaded) {
    // Deliberately renders nothing rather than `children` — showing app
    // content even briefly before we know whether App Lock is enabled
    // would defeat it exactly as a `firstDayOfWeek`-style flash would, only
    // with actual private content instead of a miscolored calendar grid.
    return null;
  }

  if (enabled && locked) {
    return <LockScreen onUnlock={() => setLocked(false)} />;
  }

  return (
    <AppLockRefreshContext.Provider value={{ refreshAppLockSettings }}>{children}</AppLockRefreshContext.Provider>
  );
}
