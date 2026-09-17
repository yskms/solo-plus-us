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
 * The overlay itself renders inside React Native's own `Modal` (not just
 * an absolutely-positioned `View`) because `app/record.tsx` is presented
 * with `presentation: 'modal'` — on iOS that's a genuinely separate
 * native presentation layer, outside the root view hierarchy an
 * absolute-fill `View` covers. A `View` overlay could leave that modal
 * (or any future one) sitting *above* the lock screen, reachable while
 * "locked". But RN's `Modal` presents *from* the root view controller
 * too — if `record` is already being presented from that same VC when
 * this tries to present, the second `presentViewController` call
 * silently fails, and toggling `visible` again later doesn't retry it.
 * So `record` is dismissed first (see the `router.dismiss()` call below)
 * whenever locking would otherwise leave it open underneath. Unverified
 * on-device either way (see README).
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
import { Alert, AppState, Modal, StyleSheet, View, type AppStateStatus } from 'react-native';
import { router, usePathname } from 'expo-router';
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
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const [enabled, setEnabled] = useState(false);
  const [timing, setTiming] = useState<AppLockTiming>('immediately');
  const [settingsStatus, setSettingsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  // Cold start defaults to locked: there is no in-memory "backgrounded at"
  // state to consult on a fresh process, so a cold start with App Lock
  // enabled is treated the same as "Immediately" regardless of the
  // configured timing — erring toward *not* locking on launch would defeat
  // the point of the setting.
  const [locked, setLocked] = useState(true);
  // True from the moment we decide to lock but `record` is still open,
  // until its dismissal is confirmed (see the AppState listener and the
  // effect below). Kept separate from `locked` itself: flipping `locked`
  // immediately is exactly the bug this guards against — see the effect
  // for why.
  const [awaitingModalDismiss, setAwaitingModalDismiss] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<LocalAuthentication.LocalAuthenticationError | null>(null);

  const backgroundedAtRef = useRef<number | null>(null);
  // Set by `disableAppLockDueToNoEnrollment`, flushed by the effect below
  // once the lock Modal has actually cleared — see that function's own
  // comment for why calling `Alert.alert` directly, in the same tick as
  // hiding the Modal, isn't reliable.
  const pendingAlertRef = useRef<{ title: string; message: string } | null>(null);
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
    // Deferred rather than called here directly: this runs while the lock
    // Modal's dismiss is still in flight (`visible` has only just flipped
    // to `false` in the same tick), and iOS can silently drop an Alert
    // presented while another presentation/dismissal transition is
    // mid-flight. The effect below fires only once the Modal has actually
    // stopped being shown, which is the one thing that has to be true
    // before this Alert reliably appears — this is the only way the
    // person finds out App Lock was turned off without their action, so
    // it can't just be skipped if the timing is unlucky.
    pendingAlertRef.current = {
      title: 'App Lock turned off',
      message:
        'This device no longer has a passcode, fingerprint, or face unlock set up, so App Lock has been turned off to keep your records accessible.',
    };
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
          if (pathnameRef.current === '/record') {
            // record.tsx (`presentation: 'modal'`) is a genuinely separate
            // native presentation on iOS. The <Modal> below presents from
            // the *root* view controller — if record's modal is already
            // being presented from that same root VC, a second
            // `presentViewController` call silently fails (UIKit logs a
            // warning, shows nothing), and toggling `visible` again later
            // doesn't retry it: the lock screen would never appear, while
            // record's modal stays fully interactive underneath. Dismiss
            // it first so the root VC is free by the time the lock Modal
            // tries to present. record.tsx has no draft state worth
            // preserving (just two buttons) — unlike a regular pushed
            // screen (e.g. Activity Detail), which this deliberately
            // leaves alone by checking the exact pathname rather than
            // dismissing indiscriminately.
            //
            // `router.dismiss()` only *starts* the native dismiss
            // animation — it doesn't wait for it to finish. Setting
            // `locked` (and so the lock Modal's `visible`) immediately
            // here would try to present while record is still mid-close,
            // hitting the exact same "second presentation silently
            // fails" problem this is meant to avoid. `awaitingModalDismiss`
            // holds off on that until the effect below confirms record is
            // actually gone (or a timeout safety-nets it).
            setAwaitingModalDismiss(true);
            router.dismiss();
          } else {
            setLocked(true);
          }
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

  // Confirms record.tsx has actually finished dismissing (`pathname` no
  // longer `/record`) before locking — see the `awaitingModalDismiss`
  // comment above for why. The timeout is a safety net, not the expected
  // path: if `dismiss()` doesn't resolve for some reason, locking after a
  // few seconds regardless beats leaving the "flash guard" (below) up
  // forever with no real lock screen ever appearing.
  useEffect(() => {
    if (!awaitingModalDismiss) return;
    if (pathname !== '/record') {
      setAwaitingModalDismiss(false);
      setLocked(true);
      return;
    }
    const timeout = setTimeout(() => {
      setAwaitingModalDismiss(false);
      setLocked(true);
    }, 3000);
    return () => clearTimeout(timeout);
  }, [awaitingModalDismiss, pathname]);

  const showingOverlay = settingsStatus !== 'ready' || (enabled && locked);
  // Covers `children` the instant we decide to lock, even before the
  // native lock Modal has actually presented — a plain View's background
  // color applies in the same render, with none of the native
  // presentation delay/conflict a second Modal would have. This is the
  // "flash guard" for the `awaitingModalDismiss` window specifically
  // (record.tsx's own still-closing modal already visually covers
  // `children` during that window regardless — this is belt-and-suspenders
  // for the moment right after, before the lock Modal is confirmed up).
  const hidingContent = showingOverlay || awaitingModalDismiss;

  const flushPendingAlert = useCallback(() => {
    if (!pendingAlertRef.current) return;
    const { title, message } = pendingAlertRef.current;
    pendingAlertRef.current = null;
    Alert.alert(title, message);
  }, []);

  // `Modal`'s `onDismiss` is iOS-only, and fires once the native modal has
  // *actually* finished closing — the one thing that has to be true
  // before an Alert reliably appears (see `disableAppLockDueToNoEnrollment`).
  // On Android, `Modal` isn't a ViewController-presentation the way iOS's
  // is, so there's no equivalent "still transitioning" conflict to wait
  // out — the effect below (transition into `!showingOverlay`) is
  // sufficient there, and doubles as a safety net on iOS in case
  // `onDismiss` doesn't fire for some reason (`flushPendingAlert` is
  // idempotent — the ref is cleared on first use — so both can safely
  // fire).
  const wasShowingOverlayRef = useRef(showingOverlay);
  useEffect(() => {
    if (wasShowingOverlayRef.current && !showingOverlay) {
      flushPendingAlert();
    }
    wasShowingOverlayRef.current = showingOverlay;
  }, [showingOverlay, flushPendingAlert]);

  return (
    <AppLockActionsContext.Provider value={{ refreshAppLockSettings, authenticate }}>
      <View
        style={[styles.fill, hidingContent && { backgroundColor: colors.background }]}
        pointerEvents={hidingContent ? 'none' : 'auto'}
        accessibilityElementsHidden={hidingContent}
        importantForAccessibility={hidingContent ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </View>
      {/* A native Modal, not just an absolutely-positioned View — see the
          file doc comment for why record.tsx's own `presentation: 'modal'`
          makes that necessary. `onRequestClose` is a required no-op on
          Android: the hardware back button must not be a way to dismiss
          this without authenticating. */}
      <Modal
        visible={showingOverlay}
        animationType="none"
        transparent={false}
        onRequestClose={() => {}}
        onDismiss={flushPendingAlert}
      >
        {settingsStatus === 'loading' && <View style={[styles.fill, { backgroundColor: colors.background }]} />}
        {settingsStatus === 'error' && <LoadErrorOverlay onRetry={refreshAppLockSettings} />}
        {settingsStatus === 'ready' && enabled && locked && (
          <LockScreen authenticating={authenticating} authError={authError} onRetry={attemptUnlock} />
        )}
      </Modal>
    </AppLockActionsContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
