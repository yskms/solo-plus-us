/**
 * UI/UX §6 Privacy Introduction. Shown once, on first launch. Continue
 * marks the flag in `app_settings` (lib/onboarding.ts) and replaces this
 * screen with Today — no back button into onboarding after that.
 *
 * "Continue後、必要ならApp Lock設定を案内する"（§6）: §15 の画面一覧に
 * App Lock 案内専用の画面が無い（02 Privacy Introduction → 03 Today に
 * 直結）ため、新規画面ではなく Continue 直後の一度きりの Alert として
 * 実装している。「必要なら」＝端末に認証手段（生体認証/パスコード）が
 * 無ければ案内しても有効化できないため、その場合は Alert 自体を出さない
 * ——`app/settings/app-lock.tsx` の `persistEnabled` が enrollment 無しを
 * 拒否するのと同じ判断。「Turn On」は `appLock.enabled` をここで直接
 * 保存せず Settings > App Lock へ遷移させるだけ——有効化ロジックを
 * 二箇所に重複させない。
 */
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import { useTheme, spacing } from '../../constants/theme';
import { useDatabase } from '../../contexts/DatabaseContext';
import { markPrivacyIntroSeen } from '../../lib/onboarding';
import { logError } from '../../lib/log';
import { IntersectPlus } from '../../components/IntersectPlus';

const POINTS = [
  'Stored on this device',
  'No account required',
  'No advertising use',
  'Health connection is optional',
];

export default function PrivacyIntroScreen() {
  const { colors } = useTheme();
  const db = useDatabase();
  const [continuing, setContinuing] = useState(false);

  const onContinue = async () => {
    if (continuing) return;
    setContinuing(true);
    try {
      await markPrivacyIntroSeen(db);
    } catch (error) {
      setContinuing(false);
      Alert.alert('Something went wrong', 'Please try again.');
      logError('markPrivacyIntroSeen failed', error);
      return;
    }

    // Best-effort only — a failed enrollment check should never block
    // getting into the app. Falls through to Today either way.
    let hasEnrolledAuth = false;
    try {
      const level = await LocalAuthentication.getEnrolledLevelAsync();
      hasEnrolledAuth = level !== LocalAuthentication.SecurityLevel.NONE;
    } catch (error) {
      logError('getEnrolledLevelAsync failed during onboarding', error);
    }

    if (!hasEnrolledAuth) {
      router.replace('/(tabs)');
      return;
    }

    // No `cancelable`/`onDismiss` — RN's Android Alert defaults to
    // `cancelable: false` (confirmed on device: back press does not
    // close it), so one of the two buttons below is always what ends
    // this dialog, same as every other confirmation Alert.alert in this
    // codebase (e.g. app/settings/app-lock.tsx's "No device
    // authentication set up").
    Alert.alert(
      'Protect your entries?',
      'Turn on App Lock to require device authentication before opening the app.',
      [
        { text: 'Not Now', style: 'cancel', onPress: () => router.replace('/(tabs)') },
        {
          text: 'Turn On',
          onPress: () => {
            router.replace('/(tabs)');
            router.push('/settings/app-lock');
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.top}>
        <IntersectPlus size={40} />
        <Text style={[styles.wordmark, { color: colors.textPrimary }]}>Solo + Us</Text>
        <Text style={[styles.tagline, { color: colors.textSecondary }]}>Your intimate life, over time.</Text>
      </View>

      <View style={styles.middle}>
        <Text style={[styles.belongsLine, { color: colors.textPrimary }]}>
          Your intimate life belongs to you.
        </Text>
        {POINTS.map((point) => (
          <Text key={point} style={[styles.point, { color: colors.textSecondary }]}>
            •  {point}
          </Text>
        ))}
      </View>

      <Pressable
        onPress={onContinue}
        disabled={continuing}
        style={[styles.continueButton, { backgroundColor: colors.solo, opacity: continuing ? 0.7 : 1 }]}
      >
        <Text style={[styles.continueText, { color: colors.background }]}>Continue</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, justifyContent: 'space-between' },
  top: { alignItems: 'center', marginTop: spacing.xl, gap: spacing.sm },
  wordmark: { fontSize: 28, fontWeight: '700', marginTop: spacing.sm },
  tagline: { fontSize: 14 },
  middle: { gap: spacing.sm },
  belongsLine: { fontSize: 17, fontWeight: '600', marginBottom: spacing.sm },
  point: { fontSize: 14, lineHeight: 22 },
  continueButton: { borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  continueText: { fontSize: 16, fontWeight: '700' },
});
