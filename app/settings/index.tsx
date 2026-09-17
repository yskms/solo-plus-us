/**
 * UI/UX §17 Screen 07 — Settings. Only the sections that actually have a
 * working destination are listed here; the rest of §17's mockup (Health
 * Connect, Activity Details, Preferences, About) ships as its own row
 * once each is built, rather than linking to placeholders now. DATA is a
 * single "Export & Import" row rather than §17's separate Export/Import/
 * Delete rows — `settings/data.tsx` covers Export and Import; Delete
 * (§10.6) isn't built yet, so the mockup's three-row split isn't followed
 * literally (see README). "Hide App Preview" (§18 画面マスク) links to an
 * informational screen, not a toggle — see `lib/screenMask.ts`.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, spacing, minTouchTarget } from '../../constants/theme';

function SettingsRow({ label, onPress, divider }: { label: string; onPress: () => void; divider?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderColor: colors.border, opacity: pressed ? 0.6 : 1 },
        divider && { borderTopWidth: StyleSheet.hairlineWidth },
      ]}
      accessibilityRole="button"
    >
      <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>{label}</Text>
      <Text style={[styles.chevron, { color: colors.textTertiary }]}>›</Text>
    </Pressable>
  );
}

export default function SettingsIndexScreen() {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>PRIVACY</Text>
        <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <SettingsRow label="App Lock" onPress={() => router.push('/settings/app-lock')} />
          <SettingsRow label="Hide App Preview" onPress={() => router.push('/settings/hide-app-preview')} divider />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>DATA</Text>
        <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <SettingsRow label="Export & Import" onPress={() => router.push('/settings/data')} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.sm },
  sectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, paddingHorizontal: spacing.xs },
  group: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    minHeight: minTouchTarget,
  },
  rowLabel: { fontSize: 15, fontWeight: '500' },
  chevron: { fontSize: 18 },
});
