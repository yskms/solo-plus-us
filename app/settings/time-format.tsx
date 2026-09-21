/**
 * UI/UX §17 PREFERENCES — "Time Format". 12-hour / 24-hour, backed by
 * `preferences.timeFormat` (resolved from locale once at first launch —
 * see `services/SettingsRepository.ts`'s `resolveLocaleDefaults`) and
 * consumed by `lib/timeFormat.ts`. `screens/CalendarScreen.tsx` is a
 * persistent tab (not remounted on navigating back from here), so saving
 * must bump `useDataRevision()` for the change to actually reflow it — see
 * that context's file doc comment. `app/record.tsx`/`app/activity/[id].tsx`
 * re-read the setting on their own mount, so they don't need the bump, but
 * it's harmless for them either way.
 */
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, spacing, minTouchTarget } from '../../constants/theme';
import { useDatabase } from '../../contexts/DatabaseContext';
import { useDataRevision } from '../../contexts/DataRevision';
import { getSetting, setSetting } from '../../services/SettingsRepository';
import { logError } from '../../lib/log';
import type { TimeFormat } from '../../types/Settings';

const OPTIONS: { value: TimeFormat; label: string }[] = [
  { value: '12h', label: '12-hour (1:30 PM)' },
  { value: '24h', label: '24-hour (13:30)' },
];

export default function TimeFormatSettingsScreen() {
  const { colors } = useTheme();
  const db = useDatabase();
  const { bump } = useDataRevision();
  const [value, setValue] = useState<TimeFormat | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getSetting(db, 'preferences.timeFormat')
        .then(setValue)
        .catch((error) => logError('Loading preferences.timeFormat failed', error));
    }, [db]),
  );

  const persist = async (next: TimeFormat) => {
    if (next === value) return;
    const previous = value;
    setValue(next);
    setBusy(true);
    try {
      await setSetting(db, 'preferences.timeFormat', next);
      bump();
    } catch (error) {
      setValue(previous);
      logError('Saving preferences.timeFormat failed', error);
      Alert.alert('Could not save', 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (value === null) {
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
              accessibilityState={{ selected: value === option.value }}
            >
              <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>{option.label}</Text>
              {value === option.value && <Text style={[styles.checkmark, { color: colors.solo }]}>✓</Text>}
            </Pressable>
          ))}
        </View>
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
});
