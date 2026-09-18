import { useFonts } from 'expo-font';
import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { View } from 'react-native';
import 'react-native-reanimated';

import { DatabaseProvider, useNeedsOnboarding } from '../contexts/DatabaseContext';
import { DataRevisionProvider } from '../contexts/DataRevision';
import { RecordFeedbackProvider } from '../contexts/RecordFeedback';
import { AppLockProvider } from '../contexts/AppLock';
import { ScreenshotBlockProvider } from '../contexts/ScreenshotBlock';
import { AppearanceProvider } from '../contexts/Appearance';
import { UndoSnackbar } from '../components/UndoSnackbar';
import { MigrationRestoredBanner } from '../components/MigrationRestoredBanner';
import { useScreenMask } from '../lib/screenMask';
import { useTheme } from '../constants/theme';
import { logError } from '../lib/log';

/** First-ever launch only: sends the person to the Privacy Introduction before anything else. */
function OnboardingRedirect() {
  const needsOnboarding = useNeedsOnboarding();
  useEffect(() => {
    if (needsOnboarding) {
      router.replace('/onboarding/privacy');
    }
  }, [needsOnboarding]);
  return null;
}

/**
 * Split out from `RootLayout` so `useTheme()` here is called *inside*
 * `AppearanceProvider`'s subtree (a hook call's context lookup follows the
 * calling component's position in the render tree, not where its JSX ends
 * up written) — otherwise the header would only ever see the OS scheme,
 * never a `'light'`/`'dark'` override. React Navigation's `Stack` header is
 * a separate native-ish chrome from the screens' own `useTheme()`-styled
 * content; without this it stayed hardcoded to the light theme regardless
 * of OS or in-app appearance (pre-existing gap, invisible until Appearance
 * made switching themes an explicit, visible action).
 */
function AppShell() {
  const { colors, scheme } = useTheme();

  // `Appearance.setColorScheme()` (contexts/Appearance.tsx) calls
  // `AppCompatDelegate.setDefaultNightMode()`, which *should* make
  // `android:windowBackground` pick up `values-night/colors.xml`
  // (`plugins/withAndroidNightColors.js`) — but `AndroidManifest.xml`
  // lists `uiMode` in `MainActivity`'s `configChanges` (standard for RN,
  // so a system theme change doesn't kill the JS runtime), which also
  // means night-mode switches picked at runtime don't reliably force the
  // Window to redraw its background from the new theme. Confirmed on
  // device: even after the AppCompat switch, a screen transition's
  // trailing edge (the native surface behind both screens, which neither
  // screen's own `contentStyle` reaches) still showed a stale light-gray
  // background. `SystemUI.setBackgroundColorAsync` sets the root view's
  // background directly, independent of the day/night theme resolution
  // path, so it isn't subject to that gap.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.background).catch((error) => logError('SystemUI.setBackgroundColorAsync failed', error));
  }, [colors.background]);

  return (
    <View style={{ flex: 1 }}>
      {/* `Appearance.setColorScheme()` (contexts/Appearance.tsx) switches
          Android's own Day/Night mode, but the status bar icon color is a
          separate RN-level setting `expo-status-bar` owns — without this,
          picking Light against a dark OS left the icons white-on-white
          (illegible), because nothing here was telling them to flip. */}
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <OnboardingRedirect />
      <MigrationRestoredBanner />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: { color: colors.textPrimary },
          // Each screen's own container background. This alone does NOT
          // fix the trailing-edge strip during a push/pop transition — that
          // gap sits behind both screens, in the native Window background,
          // which `SystemUI.setBackgroundColorAsync` above handles (see its
          // comment and README "Phase 3 実装状況 > Appearance" for why
          // `contentStyle` doesn't reach it). Kept anyway so a screen's own
          // background doesn't visibly mismatch before content renders.
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding/privacy" options={{ headerShown: false, gestureEnabled: false }} />
        {/* Not `presentation: 'modal'` — see contexts/AppLock.tsx's file doc
            comment. A modal-family presentation (`modal`/`formSheet`/etc.) is
            react-native-screens presenting from a separate native
            ViewController/ Activity, outside the root view hierarchy an
            overlay there can reliably cover; the default `card` push keeps
            this screen in the same native stack as everything else, which
            is what makes that overlay reliable without needing to track
            this screen's own close animation. UI/UX §8 allows either
            ("Bottom Sheet または Modal") — this isn't a spec deviation. */}
        <Stack.Screen name="record" options={{ headerShown: false }} />
        <Stack.Screen name="activity/[id]" options={{ title: 'Activity' }} />
        <Stack.Screen name="settings/index" options={{ title: 'Settings' }} />
        <Stack.Screen name="settings/app-lock" options={{ title: 'App Lock' }} />
        <Stack.Screen name="settings/hide-app-preview" options={{ title: 'Hide App Preview' }} />
        <Stack.Screen name="settings/block-screenshots" options={{ title: 'Block Screenshots' }} />
        <Stack.Screen name="settings/data" options={{ title: 'Data' }} />
        <Stack.Screen name="settings/appearance" options={{ title: 'Appearance' }} />
      </Stack>
      <UndoSnackbar />
    </View>
  );
}

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({});
  // Called unconditionally (Rules of Hooks) regardless of Database/AppLock
  // state (loading, Recovery, locked, unlocked) — the hook's own effect is
  // gated on `loaded` internally (see lib/screenMask.ts's doc comment on
  // why calling any earlier risks a silent no-op on iOS).
  useScreenMask(loaded);

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <DatabaseProvider>
      <DataRevisionProvider>
        <AppearanceProvider>
          <RecordFeedbackProvider>
            <ScreenshotBlockProvider>
              <AppLockProvider>
                <AppShell />
              </AppLockProvider>
            </ScreenshotBlockProvider>
          </RecordFeedbackProvider>
        </AppearanceProvider>
      </DataRevisionProvider>
    </DatabaseProvider>
  );
}
