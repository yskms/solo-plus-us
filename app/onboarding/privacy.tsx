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
 * ——`app/settings/app-lock.tsx` の `persistEnabled`（`lib/
 * deviceAuthEnrollment.ts` を共有）が enrollment 無しを拒否するのと同じ
 * 判断。「Go to Settings」は `appLock.enabled` をここで直接保存せず
 * Settings > App Lock へ遷移させるだけ——有効化ロジックを二箇所に
 * 重複させない。ボタン文言はあえて「Turn On」にしていない——押しても
 * その場で有効になるわけではなく遷移するだけなので、文言と実際の挙動を
 * 一致させた。
 */
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, spacing } from '../../constants/theme';
import { useDatabase } from '../../contexts/DatabaseContext';
import { markPrivacyIntroSeen } from '../../lib/onboarding';
import { hasDeviceAuthEnrolled } from '../../lib/deviceAuthEnrollment';
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
      hasEnrolledAuth = await hasDeviceAuthEnrolled();
    } catch (error) {
      logError('hasDeviceAuthEnrolled failed during onboarding', error);
    }

    if (!hasEnrolledAuth) {
      router.replace('/(tabs)');
      return;
    }

    Alert.alert(
      'Protect your entries?',
      'You can turn on App Lock in Settings to require device authentication before opening the app.',
      [
        { text: 'Not Now', style: 'cancel', onPress: () => router.replace('/(tabs)') },
        {
          text: 'Go to Settings',
          onPress: () => {
            // `replace` first so Today (not this screen) is what's
            // underneath the pushed Settings screen — e.g. its back
            // button returns to Today, not here. Relies on expo-router
            // dispatching both in order within this one synchronous
            // handler (confirmed on device); this is the only place in
            // the app that chains a replace and a push like this.
            router.replace('/(tabs)');
            router.push('/settings/app-lock');
          },
        },
      ],
      // `onDismiss` isn't for the back button/outside tap — Android's
      // `Alert.alert` defaults to `cancelable: false` (confirmed on
      // device: back press does not close it), same as every other
      // confirmation Alert.alert in this codebase. It's for a narrower
      // case: `DialogModule.showNewAlert()` (RN's Android alert host)
      // always calls `dismissExisting()` before showing a new dialog, so
      // if *any* other `Alert.alert` fires while this one is up, this one
      // is silently dismissed — `ACTION_DISMISSED`, no button `onPress`.
      // Nothing today fires an Alert during this specific window, but
      // markPrivacyIntroSeen has already committed by this point and this
      // screen has no way back in (no back button into onboarding, per
      // the file header) — so if that ever changes, this is what stands
      // between the person and being stuck here for the rest of the
      // session. Treated the same as "Not Now".
      { onDismiss: () => router.replace('/(tabs)') },
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
