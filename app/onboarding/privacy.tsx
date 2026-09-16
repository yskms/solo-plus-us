/**
 * UI/UX §6 Privacy Introduction. Shown once, on first launch. Continue
 * marks the flag in `app_settings` (lib/onboarding.ts) and replaces this
 * screen with Today — no back button into onboarding after that.
 */
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, spacing } from '../../constants/theme';
import { useDatabase } from '../../contexts/DatabaseContext';
import { markPrivacyIntroSeen } from '../../lib/onboarding';
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
      router.replace('/(tabs)');
    } catch (error) {
      setContinuing(false);
      Alert.alert('Something went wrong', 'Please try again.');
      console.error('markPrivacyIntroSeen failed', error);
    }
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
