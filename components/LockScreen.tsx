/**
 * UI/UX §19 lock screen mockup. No activity count or any other data shown
 * here ("ロック画面には activity count 等を表示しない") — brand mark and a
 * lock icon only.
 *
 * Purely presentational — `AppLockProvider` owns the authentication
 * attempt itself (including auto-prompting on mount) so that its
 * `authenticatingRef` guard against spurious `AppState` churn stays in
 * one place rather than needing to synchronize across two components.
 * Rendered as an absolutely-positioned sibling overlay (see AppLock.tsx),
 * so this fills that same area itself.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { LocalAuthenticationError } from 'expo-local-authentication';
import { useTheme, spacing, minTouchTarget } from '../constants/theme';
import { IntersectPlus } from './IntersectPlus';
import { describeAuthError } from '../lib/localAuthMessages';

export function LockScreen({
  authenticating,
  authError,
  onRetry,
}: {
  authenticating: boolean;
  authError: LocalAuthenticationError | null;
  onRetry: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const errorMessage = describeAuthError(t, authError);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.center}>
        <IntersectPlus size={40} />
        <Text style={[styles.wordmark, { color: colors.textPrimary }]}>Solo + Us</Text>

        <Text style={[styles.lockIcon, { color: colors.textSecondary }]}>🔒</Text>

        <Pressable
          onPress={onRetry}
          disabled={authenticating}
          style={[styles.unlockButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
          accessibilityRole="button"
          accessibilityLabel={t('lockScreen.unlockA11y')}
        >
          <Text style={[styles.unlockText, { color: colors.textPrimary }]}>{t('lockScreen.unlockWithDevice')}</Text>
        </Pressable>

        {errorMessage && <Text style={[styles.errorText, { color: colors.destructive }]}>{errorMessage}</Text>}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  wordmark: { fontSize: 22, fontWeight: '700' },
  lockIcon: { fontSize: 40, marginTop: spacing.lg },
  // Looks like a button on purpose: the system prompt auto-opens on mount, and
  // once the user dismisses it (the sheet's X), this is the only way back in.
  // As bare text it gave no hint that it was tappable.
  unlockButton: {
    marginTop: spacing.lg,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + spacing.xs,
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unlockText: { fontSize: 15, fontWeight: '600', textAlign: 'center', lineHeight: 21 },
  errorText: { fontSize: 13, textAlign: 'center', maxWidth: 260 },
});
