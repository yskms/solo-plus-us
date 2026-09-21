/**
 * UI/UX §17 Screen 07a — Activity Details（表示項目のカスタマイズ）。
 * 要件定義書 §6.3：性別を推定して項目を出し分けるのではなく、本人が
 * 表示項目を選ぶ。文言のルール（§6.3/Screen 07a）：「あなたに必要な項目」
 * のような属性推定を匂わせる書き方をしない、既定値の理由を説明しない、
 * OFF を「使わない」ではなく「表示しない」と表現する。
 *
 * ここで変更するのは「未記録の項目を編集画面（`app/activity/[id].tsx`）に
 * 出すかどうか」だけ——既に記録済みの値は設定に関わらず常に表示される
 * （`lib/activityDetailsFields.ts` の不変条件）。
 */
import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, spacing, minTouchTarget } from '../../constants/theme';
import { useDatabase } from '../../contexts/DatabaseContext';
import { getSetting, setSetting } from '../../services/SettingsRepository';
import { ACTIVITY_DETAIL_FIELDS } from '../../lib/activityDetailsFields';
import { logError } from '../../lib/log';

type ActivityDetailSettingKey = (typeof ACTIVITY_DETAIL_FIELDS)[number]['settingKey'];
type FieldState = Record<ActivityDetailSettingKey, boolean>;

export default function ActivityDetailsSettingsScreen() {
  const { colors } = useTheme();
  const db = useDatabase();
  const [values, setValues] = useState<FieldState | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const entries = await Promise.all(
      ACTIVITY_DETAIL_FIELDS.map(async ({ settingKey }) => [settingKey, await getSetting(db, settingKey)] as const),
    );
    setValues(Object.fromEntries(entries) as FieldState);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const persist = async (key: ActivityDetailSettingKey, next: boolean) => {
    if (!values) return;
    const previous = values[key];
    setValues((current) => (current ? { ...current, [key]: next } : current));
    setBusyKey(key);
    try {
      await setSetting(db, key, next);
    } catch (error) {
      setValues((current) => (current ? { ...current, [key]: previous } : current));
      logError('Saving activityDetails setting failed', error);
      Alert.alert('Could not save', 'Please try again.');
    } finally {
      setBusyKey(null);
    }
  };

  if (!values) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.textSecondary, padding: spacing.md }}>Loading…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.intro, { color: colors.textSecondary }]}>
          Choose what you want to track. You can change this anytime.
        </Text>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>TRACKING DETAILS</Text>
        <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {ACTIVITY_DETAIL_FIELDS.map(({ settingKey, label }, index) => (
            <View
              key={settingKey}
              style={[styles.row, { borderColor: colors.border }, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth }]}
            >
              <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>{label}</Text>
              <Switch
                value={values[settingKey]}
                onValueChange={(next) => persist(settingKey, next)}
                disabled={busyKey === settingKey}
              />
            </View>
          ))}
        </View>

        <Text style={[styles.caption, { color: colors.textTertiary }]}>
          Values you have already recorded are always shown, even if turned off.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.sm },
  intro: { fontSize: 14, lineHeight: 20, paddingHorizontal: spacing.xs, marginBottom: spacing.xs },
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
  caption: { fontSize: 12, paddingHorizontal: spacing.xs, lineHeight: 17 },
});
