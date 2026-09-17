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
                <Stack.Screen
                  name="record"
                  options={{ presentation: 'modal', headerShown: false }}
                />
                <Stack.Screen name="activity/[id]" options={{ title: 'Activity' }} />
                <Stack.Screen name="settings/index" options={{ title: 'Settings' }} />
                <Stack.Screen name="settings/app-lock" options={{ title: 'App Lock' }} />
              </Stack>
              <UndoSnackbar />
            </View>
          </AppLockProvider>
        </RecordFeedbackProvider>
      </DataRevisionProvider>
    </DatabaseProvider>
  );
}
