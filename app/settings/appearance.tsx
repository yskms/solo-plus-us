/**
 * UI/UX §17 PREFERENCES — "Appearance". System / Light / Dark, backed by
 * `preferences.appearance` via `contexts/Appearance.tsx` (the single
 * source of truth `constants/theme.ts`'s `useTheme()` also reads — see
 * that context's file doc comment).
 */
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, spacing, minTouchTarget } from '../../constants/theme';
import { useAppearanceSetting } from '../../contexts/Appearance';
import { logError } from '../../lib/log';
import type { Appearance } from '../../types/Settings';

const OPTIONS: { value: Appearance; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function AppearanceSettingsScreen() {
  const { colors } = useTheme();
  const { appearance, loaded, setAppearance } = useAppearanceSetting();
  const [busy, setBusy] = useState(false);

  const persist = async (next: Appearance) => {
    if (next === appearance) return;
    setBusy(true);
    try {
      await setAppearance(next);
    } catch (error) {
      logError('Saving preferences.appearance failed', error);
      Alert.alert('Could not save', 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.textSecondary, padding: spacing.md }}>Loading…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {OPTIONS.map((option, index) => (
            <Pressable
              key={option.value}
              onPress={() => persist(option.value)}
              disabled={busy}
              style={({ pressed }) => [
                styles.row,
                { borderColor: colors.border, opacity: pressed || busy ? 0.6 : 1 },
                index > 0 && { borderTopWidth: StyleSheet.hairlineWidth },
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected: appearance === option.value }}
            >
              <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>{option.label}</Text>
              {appearance === option.value && <Text style={[styles.checkmark, { color: colors.solo }]}>✓</Text>}
            </Pressable>
          ))}
        </View>
        <Text style={[styles.caption, { color: colors.textTertiary }]}>
          System follows this device&apos;s own Light/Dark setting.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.sm },
  group: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    minHeight: minTouchTarget,
  },
  rowLabel: { fontSize: 15, fontWeight: '500' },
  checkmark: { fontSize: 16, fontWeight: '700' },
  caption: { fontSize: 12, paddingHorizontal: spacing.xs, lineHeight: 17 },
});
