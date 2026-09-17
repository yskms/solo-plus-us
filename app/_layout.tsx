import { useFonts } from 'expo-font';
import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { View } from 'react-native';
import 'react-native-reanimated';

import { DatabaseProvider, useNeedsOnboarding } from '../contexts/DatabaseContext';
import { DataRevisionProvider } from '../contexts/DataRevision';
import { RecordFeedbackProvider } from '../contexts/RecordFeedback';
import { AppLockProvider } from '../contexts/AppLock';
import { UndoSnackbar } from '../components/UndoSnackbar';
import { MigrationRestoredBanner } from '../components/MigrationRestoredBanner';
import { useScreenMask } from '../lib/screenMask';

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

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({});
  // Unconditional — see lib/screenMask.ts. Applies regardless of
  // DatabaseProvider/AppLock state (loading, Recovery, locked, unlocked),
  // so it's called at the very top of the tree, not nested inside either.
  useScreenMask();

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
        <RecordFeedbackProvider>
          <AppLockProvider>
            <View style={{ flex: 1 }}>
              <OnboardingRedirect />
              <MigrationRestoredBanner />
              <Stack>
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
                <Stack.Screen name="settings/data" options={{ title: 'Data' }} />
              </Stack>
              <UndoSnackbar />
            </View>
          </AppLockProvider>
        </RecordFeedbackProvider>
      </DataRevisionProvider>
    </DatabaseProvider>
  );
}
