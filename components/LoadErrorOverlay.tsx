/**
 * Opaque, full-screen error state for `AppLockProvider` when it can't
 * even read `appLock.enabled`/`timing` — shown instead of either
 * guessing "unlocked" (could expose content the person meant to protect)
 * or guessing "locked" (see the `disableAppLockDueToNoEnrollment` doc
 * comment in AppLock.tsx for why silently assuming "locked forever" on a
 * failure is its own trap). Rendered inside a React Native `Modal` (see
 * AppLock.tsx), which already fills the screen — this only needs
 * `flex: 1`, not its own absolute positioning.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, spacing, minTouchTarget } from '../constants/theme';

export function LoadErrorOverlay({ onRetry }: { onRetry: () => void }) {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.center}>
        <Text style={[styles.message, { color: colors.textPrimary }]}>
          Solo + Us couldn&apos;t check your App Lock settings.
        </Text>
        <Pressable
          onPress={onRetry}
          style={[styles.retryButton, { borderColor: colors.border }]}
          accessibilityRole="button"
          accessibilityLabel="Try again"
        >
          <Text style={[styles.retryText, { color: colors.textPrimary }]}>Try again</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  message: { fontSize: 15, textAlign: 'center' },
  retryButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: spacing.lg,
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: { fontSize: 15, fontWeight: '600' },
});
