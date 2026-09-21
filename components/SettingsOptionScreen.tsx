/**
 * Shared radio-list layout for single-choice Settings screens
 * (`app/settings/appearance.tsx`, `first-day-of-week.tsx`, `time-format.tsx`
 * — extracted 2026-09-21 review once a third near-identical copy appeared).
 * Presentational only: each screen still owns loading/persisting its own
 * setting (they don't share a data source — `appearance` goes through
 * `contexts/Appearance.tsx`, the other two read `SettingsRepository`
 * directly) and passes the current `value`/`busy` state plus an `onSelect`
 * handler in.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, spacing, minTouchTarget } from '../constants/theme';

export interface SettingsOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: readonly SettingsOption<T>[];
  /** `null` while the current value hasn't loaded yet — renders a "Loading…" screen instead of guessing. */
  value: T | null;
  busy: boolean;
  onSelect: (value: T) => void;
  /** Optional trailing note below the option list (e.g. Appearance's "System follows…" line). */
  caption?: string;
}

export default function SettingsOptionScreen<T extends string>({ options, value, busy, onSelect, caption }: Props<T>) {
  const { colors } = useTheme();

  if (value === null) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
        <Text style={{ color: colors.textSecondary, padding: spacing.md }}>Loading…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View
          style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}
          accessibilityRole="radiogroup"
        >
          {options.map((option, index) => (
            <Pressable
              key={option.value}
              onPress={() => onSelect(option.value)}
              disabled={busy}
              style={({ pressed }) => [
                styles.row,
                { borderColor: colors.border, opacity: pressed || busy ? 0.6 : 1 },
                index > 0 && { borderTopWidth: StyleSheet.hairlineWidth },
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected: value === option.value }}
            >
              <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>{option.label}</Text>
              {value === option.value && <Text style={[styles.checkmark, { color: colors.solo }]}>✓</Text>}
            </Pressable>
          ))}
        </View>
        {caption && <Text style={[styles.caption, { color: colors.textTertiary }]}>{caption}</Text>}
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
