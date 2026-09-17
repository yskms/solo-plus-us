/**
 * UI/UX §19 lock screen mockup. No activity count or any other data shown
 * here ("ロック画面には activity count 等を表示しない") — brand mark and a
 * lock icon only.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import { useTheme, spacing } from '../constants/theme';
import { IntersectPlus } from './IntersectPlus';
import { logError } from '../lib/log';

export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const { colors } = useTheme();
  const [authenticating, setAuthenticating] = useState(false);

  const attemptUnlock = useCallback(async () => {
    if (authenticating) return;
    setAuthenticating(true);
    try {
      // `disableDeviceFallback` deliberately left at its default (false):
      // §19 "生体認証を無効にしている端末でも、端末パスコード等で解除できる
      // こと" requires the OS's own passcode fallback to stay available.
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Solo + Us',
      });
      if (result.success) {
        onUnlock();
      }
      // A failed/cancelled attempt just leaves the lock screen up with its
      // retry button — no error dialog. The person can simply try again;
      // there's nothing else this screen needs to say (no app-level PIN or
      // fallback exists to offer instead, by design — see AppLock.tsx).
    } catch (error) {
      logError('App Lock authentication failed', error);
    } finally {
      setAuthenticating(false);
    }
  }, [authenticating, onUnlock]);

  // Prompt automatically on mount only — matches the mockup's lack of a
  // separate "Unlock" button; the retry row below is the fallback for
  // when the OS prompt was dismissed or failed. Deliberately not in
  // `attemptUnlock`'s dependency list: this must run once per mount, not
  // re-fire every time `authenticating` flips during that same attempt.
  useEffect(() => {
    attemptUnlock();
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.center}>
        <IntersectPlus size={40} />
        <Text style={[styles.wordmark, { color: colors.textPrimary }]}>Solo + Us</Text>

        <Text style={[styles.lockIcon, { color: colors.textSecondary }]}>🔒</Text>

        <Pressable onPress={attemptUnlock} disabled={authenticating} style={styles.unlockRow}>
          <Text style={[styles.unlockText, { color: colors.textSecondary }]}>
            Unlock with device{'\n'}authentication
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  wordmark: { fontSize: 22, fontWeight: '700' },
  lockIcon: { fontSize: 40, marginTop: spacing.lg },
  unlockRow: { marginTop: spacing.lg, padding: spacing.sm },
  unlockText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
