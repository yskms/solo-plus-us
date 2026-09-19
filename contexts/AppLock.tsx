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
 * — only covered by an opaque sibling `View` (hidden from touch and from
 * accessibility tools). Swapping `children` out for the overlay instead
 * would unmount the whole app on every lock, discarding anything
 * mid-edit (e.g. a draft note on Activity Detail) the moment the app is
 * merely glanced away from with "Immediately" set.
 *
 * `app/record.tsx` is deliberately *not* presented with
 * `presentation: 'modal'` (or any of react-native-screens' other
 * modal-family styles) — a native-stack modal presentation runs from a
 * separate native ViewController (iOS) / Activity (Android), outside the
 * root view hierarchy this overlay covers. An earlier version of this
 * file spent several review rounds trying to detect when that modal had
 * *actually* finished closing before locking (watching `pathname`, then
 * the screen's own mount lifecycle, plus a native `Modal` for the lock
 * screen itself to out-stack it) — each signal turned out to fire earlier
 * than the real native completion, and the underlying assumption
 * ("this signal reliably follows the native transition") was never
 * something a code read alone could confirm. Keeping `record` in the
 * default `card` presentation (same native stack as every other screen,
 * UI/UX §8 allows either "Bottom Sheet または Modal") removes the
 * conflict at its root instead: there is no separate native layer for
 * this overlay to fail to cover, so nothing here needs to wait for
 * anything else to finish closing.
 *
 * Same reasoning shaped `app/record.tsx`'s date/time picker (§11.4), and
 * later `app/activity/[id].tsx`'s (D-50, the post-hoc edit). Both screens
 * share one implementation of this — `hooks/useNativeDateTimePicker.ts` +
 * `components/DateTimePickerSheet.tsx` — specifically so this invariant
 * only has to be upheld in one place rather than kept in sync across two
 * independently-edited copies (an earlier version duplicated it per
 * screen; a review flagged the drift risk that created). The iOS sheet is
 * a plain absolutely-positioned `View`, not RN's `<Modal>`, so it stays
 * inside the tree this overlay covers instead of reintroducing the
 * problem described above. Android's `@react-native-community/
 * datetimepicker` has no non-dialog mode at all (its declarative API
 * opens the same native `Dialog` window internally), so that dialog
 * genuinely is a separate window this overlay can't cover by construction
 * — but unlike the old `record.tsx` modal problem above, it *can* be
 * dismissed from code (`DateTimePickerAndroid.dismiss`), so the hook
 * closes it (and the iOS sheet) itself the moment `AppState` leaves
 * `active`, instead of accepting it as an uncloseable exception.
 * `isLocked()` is also re-checked in the dialog's own callbacks, for the
 * gap between a selection landing and that listener closing it. The
 * chained-dialog and clamp-to-now logic itself lives in
 * `lib/androidDateTimePicker.ts`, called from that same shared hook.
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
import { Alert, AppState, BackHandler, Keyboard, StyleSheet, View, type AppStateStatus } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { useTheme } from '../constants/theme';
import { useDatabase } from './DatabaseContext';
import { getSetting, setSetting } from '../services/SettingsRepository';
import { LockScreen } from '../components/LockScreen';
import { LoadErrorOverlay } from '../components/LoadErrorOverlay';
import { shouldLockOnResume } from '../lib/appLockTiming';
import { logError } from '../lib/log';
import type { AppLockTiming } from '../types/Settings';

interface AppLockActionsContextValue {
  /** Called by the App Lock settings screen right after saving, so a change takes effect immediately rather than waiting for the next background→foreground cycle. */
  refreshAppLockSettings: () => Promise<void>;
  /**
   * Runs a device-authentication prompt through the same `authenticatingRef`
   * guard `attemptUnlock` uses below, so a prompt triggered from the
   * Settings screen (e.g. confirming to turn App Lock off) isn't mistaken
   * by the `AppState` listener for a real backgrounding event — Android's
   * passcode fallback in particular launches a separate Activity, which
   * genuinely backgrounds this app while it runs. Returns whether
   * authentication succeeded.
   */
  authenticate: (promptMessage: string) => Promise<boolean>;
  /**
   * Point-in-time check, not a reactive value — for guarding a destructive
   * action's `onPress` (e.g. deleting an Activity) against running while
   * locked. `Alert.alert` is a system-level dialog that renders above
   * this provider's own overlay (the same "outside the root view
   * hierarchy" problem `record.tsx`'s old modal presentation had — see
   * the file doc comment — except there's no non-Alert way to route
   * around it: RN has no API to dismiss an Alert from code). If an Alert
   * with a destructive confirm button was already open when the app
   * backgrounded, it stays open and interactive on top of the lock
   * screen after resuming; the button it confirms must check this itself
   * rather than assume not being visible means not being reachable.
   */
  isLocked: () => boolean;
}

const AppLockActionsContext = createContext<AppLockActionsContextValue | null>(null);

export function useAppLockActions(): AppLockActionsContextValue {
  const ctx = useContext(AppLockActionsContext);
  if (!ctx) throw new Error('useAppLockActions must be used within AppLockProvider');
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
  // Mirrors `enabled && locked` for the synchronous `isLocked()` check
  // exposed via context — updated every render rather than via an effect,
  // since it just needs to be correct by the time a caller reads it, not
  // to trigger anything itself.
  const isLockedRef = useRef(false);
  isLockedRef.current = enabled && locked;
  const isLocked = useCallback(() => isLockedRef.current, []);

  const backgroundedAtRef = useRef<number | null>(null);
  // A plain ref, not just the `authenticating` state: the AppState
  // listener below reads this synchronously and must see the update the
  // instant an authentication attempt starts/stops, not after React's
  // next render. Shared by every authentication path (the lock screen's
  // own attempt *and* the Settings screen's, via `authenticate` below) —
  // a guard that only some callers honor isn't a guard.
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

  // Runs `authenticateAsync` with the shared `authenticatingRef` guard
  // held for its entire duration. Used directly by the Settings screen
  // (via `authenticate`, below) and indirectly by `attemptUnlock`, which
  // needs the richer `LocalAuthenticationResult` rather than a boolean.
  const authenticateGuarded = useCallback(async (promptMessage: string): Promise<LocalAuthentication.LocalAuthenticationResult> => {
    if (authenticatingRef.current) {
      return { success: false, error: 'app_cancel' };
    }
    authenticatingRef.current = true;
    try {
      // `disableDeviceFallback` deliberately left at its default (false):
      // §19 "生体認証を無効にしている端末でも、端末パスコード等で解除できる
      // こと" requires the OS's own passcode fallback to stay available.
      return await LocalAuthentication.authenticateAsync({ promptMessage });
    } finally {
      authenticatingRef.current = false;
    }
  }, []);

  const authenticate = useCallback(
    async (promptMessage: string): Promise<boolean> => {
      try {
        return (await authenticateGuarded(promptMessage)).success;
      } catch (error) {
        logError('Device authentication failed', error);
        return false;
      }
    },
    [authenticateGuarded],
  );

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
    setAuthenticating(true);
    setAuthError(null);
    try {
      const level = await LocalAuthentication.getEnrolledLevelAsync();
      if (level === LocalAuthentication.SecurityLevel.NONE) {
        await disableAppLockDueToNoEnrollment();
        return;
      }
      const result = await authenticateGuarded('Unlock Solo + Us');
      if (result.success) {
        setLocked(false);
      } else if (result.error === 'not_enrolled' || result.error === 'passcode_not_set') {
        // The error code alone isn't reliable evidence that *nothing* is
        // enrolled — on some Android OS/library versions, `not_enrolled`
        // can mean "no biometric enrolled" even though a device passcode
        // is set (the `getEnrolledLevelAsync` check above already would
        // have caught genuine "nothing enrolled at all"). Re-verify
        // before disabling App Lock, rather than trusting this error code
        // by itself — otherwise a device with a passcode but no
        // fingerprint/face could get its protection silently turned off
        // on every single unlock attempt.
        const stillNone = (await LocalAuthentication.getEnrolledLevelAsync()) === LocalAuthentication.SecurityLevel.NONE;
        if (stillNone) {
          await disableAppLockDueToNoEnrollment();
        } else {
          setAuthError(result.error);
        }
      } else {
        setAuthError(result.error);
      }
    } catch (error) {
      logError('App Lock authentication failed', error);
      setAuthError('unknown');
    } finally {
      setAuthenticating(false);
    }
  }, [authenticateGuarded, disableAppLockDueToNoEnrollment]);

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
        // callback and this listener isn't guaranteed either way). This
        // guard is shared by every authentication path — see
        // `authenticatingRef`'s own comment.
        return;
      }
      if (next === 'background') {
        if (backgroundedAtRef.current === null) {
          backgroundedAtRef.current = Date.now();
        }
      } else if (next === 'active' && backgroundedAtRef.current !== null) {
        if (shouldLockOnResume({ enabled, timing, backgroundedAtMs: backgroundedAtRef.current, nowMs: Date.now() })) {
          setLocked(true);
          // `isLockedRef` is normally kept in sync on every render, but
          // that leaves a brief window — between this call and React's
          // next render — where it would still read `false`. Setting it
          // directly here closes that window immediately, so `isLocked()`
          // is correct even for a check that happens to land in that gap.
          isLockedRef.current = true;
          // The underlying screen (e.g. Activity Detail's note field)
          // stays mounted and focused while locked — the keyboard is its
          // own native layer, and can otherwise reappear over the lock
          // overlay with the still-focused input silently accepting
          // typed text behind it. Forcing a blur removes both the
          // visible keyboard and the focus itself.
          Keyboard.dismiss();
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

  // Android's hardware back button would otherwise navigate the screen
  // stack *underneath* this overlay (the overlay is a plain View, not a
  // native Modal — nothing intercepts the back button on its own).
  // Swallowing it while the overlay is up keeps someone from paging back
  // to whatever was on screen before backgrounding without authenticating.
  useEffect(() => {
    if (!showingOverlay) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, [showingOverlay]);

  return (
    <AppLockActionsContext.Provider value={{ refreshAppLockSettings, authenticate, isLocked }}>
      <View
        style={styles.fill}
        pointerEvents={showingOverlay ? 'none' : 'auto'}
        accessibilityElementsHidden={showingOverlay}
        importantForAccessibility={showingOverlay ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </View>
      {/* A plain sibling View, rendered after (so it stacks on top of)
          `children` above — not a `backgroundColor` on that View itself,
          which would paint *behind* its children rather than over them. */}
      {showingOverlay && (
        <View style={StyleSheet.absoluteFill}>
          {settingsStatus === 'loading' && <View style={[styles.fill, { backgroundColor: colors.background }]} />}
          {settingsStatus === 'error' && <LoadErrorOverlay onRetry={refreshAppLockSettings} />}
          {settingsStatus === 'ready' && enabled && locked && (
            <LockScreen authenticating={authenticating} authError={authError} onRetry={attemptUnlock} />
          )}
        </View>
      )}
    </AppLockActionsContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
