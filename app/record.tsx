/**
 * UI/UX §8 Add Activity. The whole point of this screen is speed: tap
 * Solo or Partnered, it's saved immediately, modal closes (§8 "Quick
 * Record": tap → 1. SQLite保存 2. Modalを閉じる 3. Today更新 4. confirmation
 * 表示). No confirmation dialog in between — the Undo Snackbar (shown back
 * on Today) is the only chance to reconsider, by design (§21/§22: fast,
 * not gated by an extra tap).
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, spacing, minTouchTarget } from '../constants/theme';
import { useDatabase } from '../contexts/DatabaseContext';
import { useRecordFeedback } from '../contexts/RecordFeedback';
import * as ActivityService from '../services/ActivityService';
import type { ActivityContext } from '../types/Activity';

export default function RecordScreen() {
  const { colors } = useTheme();
  const db = useDatabase();
  const { announceRecorded } = useRecordFeedback();
  const [saving, setSaving] = useState(false);

  const record = async (context: ActivityContext) => {
    if (saving) return; // guards against a double-tap firing two records
    setSaving(true);
    try {
      const activity = await ActivityService.recordActivity(db, { context, instantUtc: new Date() });
      router.back();
      announceRecorded(activity);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Add Activity</Text>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
          <Text style={[styles.close, { color: colors.textSecondary }]}>✕</Text>
        </Pressable>
      </View>

      <Text style={[styles.prompt, { color: colors.textSecondary }]}>How would you like to log?</Text>

      <Pressable
        onPress={() => record('solo')}
        disabled={saving}
        style={({ pressed }) => [
          styles.option,
          { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed || saving ? 0.7 : 1 },
        ]}
      >
        <View style={[styles.dot, { backgroundColor: colors.solo }]} />
        <View>
          <Text style={[styles.optionTitle, { color: colors.textPrimary }]}>Solo</Text>
          <Text style={[styles.optionCaption, { color: colors.textSecondary }]}>Personal activity</Text>
        </View>
      </Pressable>

      <Pressable
        onPress={() => record('partnered')}
        disabled={saving}
        style={({ pressed }) => [
          styles.option,
          { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed || saving ? 0.7 : 1 },
        ]}
      >
        <View style={[styles.dot, { backgroundColor: colors.partnered }]} />
        <View>
          <Text style={[styles.optionTitle, { color: colors.textPrimary }]}>Partnered</Text>
          <Text style={[styles.optionCaption, { color: colors.textSecondary }]}>With someone</Text>
        </View>
      </Pressable>

      <Text style={[styles.now, { color: colors.textTertiary }]}>Recorded as: Just now</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, gap: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 20, fontWeight: '700' },
  close: { fontSize: 20, minWidth: minTouchTarget, textAlign: 'right' },
  prompt: { fontSize: 15, marginBottom: spacing.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 64,
  },
  dot: { width: 20, height: 20, borderRadius: 10 },
  optionTitle: { fontSize: 17, fontWeight: '600' },
  optionCaption: { fontSize: 13, marginTop: 2 },
  now: { fontSize: 13, textAlign: 'center', marginTop: spacing.sm },
});
