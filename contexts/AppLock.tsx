/**
 * 基本設計 v0.11 §8.3 / UI/UX §19 — App Lock is a screen-visibility gate,
 * completely independent from the DB encryption key (§8.3 "この2つの状態を
 * 結合しない"). This provider never touches `database/key.ts` or the DB
 * connection — it only decides whether to draw a `LockScreen` overlay on
 * top of `children`. The DB opens and stays open regardless of lock
 * state; locking only withholds *rendering* the UI that would display its
 * contents.
 *
 * `children` stays mounted at all times, even while locked/loading/erred
 * — only covered by an opaque overlay (hidden from touch and from
 * accessibility tools). Swapping `children` out for the overlay instead
 * would unmount the whole app on every lock, discarding anything
 * mid-edit (e.g. a draft note on Activity Detail) the moment the app is
 * merely glanced away from with "Immediately" set.
 *
 * No app-specific PIN, no bypass — `expo-local-authentication` (device
 * biometrics, falling back to device passcode by default) is the only way
 * through, per "アプリ独自の PIN を実装しない" (UI/UX §19, D-08): a recovery
 * path for a forgotten PIN would make the lock either bypassable or a
 * second way to get permanently locked out, on top of the existing §8.5
 * Recovery flow for a lost DB key. D-08's own rationale ("OS に委譲すれば
 * この問題自体が消える") has a gap it didn't anticipate: delegating to the
 * OS removes "forgot the PIN" as a failure mode, but not "the device
 * itself has no passcode/biometric configured at all" — see the
 * `getEnrolledLevelAsync` checks below, and D-08's addendum.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, AppState, StyleSheet, View, type AppStateStatus } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { useTheme } from '../constants/theme';
import { useDatabase } from './DatabaseContext';
import { getSetting, setSetting } from '../services/SettingsRepository';
import { LockScreen } from '../components/LockScreen';
import { LoadErrorOverlay } from '../components/LoadErrorOverlay';
import { shouldLockOnResume } from '../lib/appLockTiming';
import { logError } from '../lib/log';
import type { AppLockTiming } from '../types/Settings';

interface AppLockRefreshContextValue {
  /** Called by the App Lock settings screen right after saving, so a change takes effect immediately rather than waiting for the next background→foreground cycle. */
  refreshAppLockSettings: () => Promise<void>;
}

const AppLockRefreshContext = createContext<AppLockRefreshContextValue | null>(null);

export function useAppLockRefresh(): AppLockRefreshContextValue {
  const ctx = useContext(AppLockRefreshContext);
  if (!ctx) throw new Error('useAppLockRefresh must be used within AppLockProvider');
  return ctx;
}

export function AppLockProvider({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const db = useDatabase();

  const [enabled, setEnabled] = useState(false);
  const [timing, setTiming] = useState<AppLockTiming>('immediately');
  const [settingsStatus, setSettingsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  // Cold start defaults to locked: there is no in-memory "backgrounded at"
  // state to consult on a fresh process, so a cold start with App Lock
  // enabled is treated the same as "Immediately" regardless of the
  // configured timing — erring toward *not* locking on launch would defeat
  // the point of the setting.
  const [locked, setLocked] = useState(true);
  const [authenticating, setAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<LocalAuthentication.LocalAuthenticationError | null>(null);

  const backgroundedAtRef = useRef<number | null>(null);
  // A plain ref, not just the `authenticating` state: the AppState
  // listener below reads this synchronously and must see the update the
  // instant `attemptUnlock` starts/stops, not after React's next render.
  const authenticatingRef = useRef(false);

  const refreshAppLockSettings = useCallback(async () => {
    try {
      const [nextEnabled, nextTiming] = await Promise.all([
        getSetting(db, 'appLock.enabled'),
        getSetting(db, 'appLock.timing'),
      ]);
      setEnabled(nextEnabled);
      setTiming(nextTiming);
      if (!nextEnabled) setLocked(false);
      setSettingsStatus('ready');
    } catch (error) {
      logError('Loading App Lock settings failed', error);
      setSettingsStatus('error');
    }
  }, [db]);

  useEffect(() => {
    refreshAppLockSettings();
  }, [refreshAppLockSettings]);

  // Disables App Lock (persisted, not just for this session) and unlocks,
  // rather than leaving the person stuck on a lock screen that can never
  // succeed. Without this, someone who turns App Lock on and later
  // removes their device passcode/biometrics entirely — with no app-level
  // PIN or bypass to fall back to, by design (D-08) — would be
  // permanently locked out of their own records; the only way back in
  // would be deleting the app, which deletes the (unbacked-up, §8.6) DB
  // with it. A device with no authentication of its own isn't protecting
  // anything by also locking the app in front of it.
  const disableAppLockDueToNoEnrollment = useCallback(async () => {
    try {
      await setSetting(db, 'appLock.enabled', false);
    } catch (error) {
      logError('Auto-disabling appLock.enabled failed', error);
    }
    setEnabled(false);
    setLocked(false);
    setAuthError(null);
    Alert.alert(
      'App Lock turned off',
      'This device no longer has a passcode, fingerprint, or face unlock set up, so App Lock has been turned off to keep your records accessible.',
    );
  }, [db]);

  const attemptUnlock = useCallback(async () => {
    if (authenticatingRef.current) return;
    authenticatingRef.current = true;
    setAuthenticating(true);
    setAuthError(null);
    try {
      const level = await LocalAuthentication.getEnrolledLevelAsync();
      if (level === LocalAuthentication.SecurityLevel.NONE) {
        await disableAppLockDueToNoEnrollment();
        return;
      }
      // `disableDeviceFallback` deliberately left at its default (false):
      // §19 "生体認証を無効にしている端末でも、端末パスコード等で解除できる
      // こと" requires the OS's own passcode fallback to stay available.
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Solo + Us' });
      if (result.success) {
        setLocked(false);
      } else if (result.error === 'not_enrolled' || result.error === 'passcode_not_set') {
        // Enrollment can change between the check above and this call
        // returning — handle it here too rather than assume the check
        // above was the only guard needed.
        await disableAppLockDueToNoEnrollment();
      } else {
        setAuthError(result.error);
      }
    } catch (error) {
      logError('App Lock authentication failed', error);
    } finally {
      authenticatingRef.current = false;
      setAuthenticating(false);
    }
  }, [disableAppLockDueToNoEnrollment]);

  // Prompts automatically the moment a lock is shown, rather than waiting
  // for a tap — matches the UI/UX §19 mockup's lack of a separate
  // "Unlock" button. `LockScreen`'s own retry control is the fallback for
  // when this attempt fails or the prompt is dismissed.
  useEffect(() => {
    if (enabled && locked) {
      attemptUnlock();
    }
  }, [enabled, locked, attemptUnlock]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (authenticatingRef.current) {
        // The system auth prompt itself (the Face ID overlay on iOS, or a
        // separate passcode Activity on Android) causes its own AppState
        // churn — often exactly `active → inactive → active`. Treating
        // that as a real user-initiated backgrounding would re-arm the
        // lock the instant authentication succeeds, and with "Immediately"
        // configured, the lock screen would re-show itself in a loop with
        // no way to ever get past it (event ordering between the OS
        // callback and this listener isn't guaranteed either way).
        return;
      }
      if (next === 'background') {
        if (backgroundedAtRef.current === null) {
          backgroundedAtRef.current = Date.now();
        }
      } else if (next === 'active' && backgroundedAtRef.current !== null) {
        if (shouldLockOnResume({ enabled, timing, backgroundedAtMs: backgroundedAtRef.current, nowMs: Date.now() })) {
          setLocked(true);
        }
        backgroundedAtRef.current = null;
        // Pick up a setting change made while backgrounded (e.g. restored
        // via Import) without needing a separate polling mechanism.
        refreshAppLockSettings();
      }
      // A transient `inactive` alone — Control Center, the notification
      // shade, an in-app system dialog that never reaches `background` —
      // is intentionally ignored. Only a real `background` starts the
      // clock; reacting to every `inactive` blip is what made re-locking
      // mid-authentication possible in the first place. (`inactive`
      // belongs to the separate, not-yet-built "画面マスク" item — §18 —
      // not to this timing decision.)
    });
    return () => subscription.remove();
  }, [enabled, timing, refreshAppLockSettings]);

  const showingOverlay = settingsStatus !== 'ready' || (enabled && locked);

  return (
    <AppLockRefreshContext.Provider value={{ refreshAppLockSettings }}>
      <View
        style={styles.fill}
        pointerEvents={showingOverlay ? 'none' : 'auto'}
        accessibilityElementsHidden={showingOverlay}
        importantForAccessibility={showingOverlay ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </View>
      {settingsStatus === 'loading' && <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />}
      {settingsStatus === 'error' && <LoadErrorOverlay onRetry={refreshAppLockSettings} />}
      {settingsStatus === 'ready' && enabled && locked && (
        <LockScreen authenticating={authenticating} authError={authError} onRetry={attemptUnlock} />
      )}
    </AppLockRefreshContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
