/**
 * UI/UX §17 Screen 07a — Activity Details（表示項目のカスタマイズ）。
 * 要件定義書 §6.3：性別を推定して項目を出し分けるのではなく、本人が
 * 表示項目を選ぶ。文言のルール（§6.3/Screen 07a）：「あなたに必要な項目」
 * のような属性推定を匂わせる書き方をしない、既定値の理由を説明しない、
 * OFF を「使わない」ではなく「表示しない」と表現する。
 *
 * ここで変更するのは「未記録の項目を編集画面（`app/activity/[id].tsx`）に
 * 出すかどうか」だけ——既に記録済みの値は設定に関わらず常に表示される
 * （`lib/activityDetailsFields.ts` の不変条件）。Protection はさらに、
 * Partnered の Activity では本設定を OFF にしても常に表示される
 * （§6.3 の中心的な主張から意図的に外れる例外——理由・帰結は設計判断記録
 * D-52 参照）。下記キャプションはこの1点だけ、属性の話に踏み込まず事実
 * のみを伝える形で明示している。
 */
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme, spacing, minTouchTarget } from '../../constants/theme';
import { useDatabase } from '../../contexts/DatabaseContext';
import { getSetting, setSetting } from '../../services/SettingsRepository';
import { ACTIVITY_DETAIL_FIELDS, activityDetailFieldLabel } from '../../lib/activityDetailsFields';
import { logError } from '../../lib/log';

type ActivityDetailSettingKey = (typeof ACTIVITY_DETAIL_FIELDS)[number]['settingKey'];
type FieldState = Record<ActivityDetailSettingKey, boolean>;

type ActivityDetailDefaultSettingKey = NonNullable<(typeof ACTIVITY_DETAIL_FIELDS)[number]['defaultSettingKey']>;
type DefaultFieldState = Record<ActivityDetailDefaultSettingKey, boolean | null>;

const DEFAULT_OPTIONS: { key: string; value: boolean | null; labelKey: string }[] = [
  { key: 'unset', value: null, labelKey: 'activityDetail.notRecorded' },
  { key: 'yes', value: true, labelKey: 'activityDetail.yes' },
  { key: 'no', value: false, labelKey: 'activityDetail.no' },
];

export default function ActivityDetailsSettingsScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const db = useDatabase();
  const [values, setValues] = useState<FieldState | null>(null);
  const [defaultValues, setDefaultValues] = useState<DefaultFieldState | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const entries = await Promise.all(
      ACTIVITY_DETAIL_FIELDS.map(async ({ settingKey }) => [settingKey, await getSetting(db, settingKey)] as const),
    );
    setValues(Object.fromEntries(entries) as FieldState);

    const defaultEntries = await Promise.all(
      ACTIVITY_DETAIL_FIELDS.filter(
        (entry): entry is typeof entry & { defaultSettingKey: ActivityDetailDefaultSettingKey } =>
          entry.defaultSettingKey !== undefined,
      ).map(async ({ defaultSettingKey }) => [defaultSettingKey, await getSetting(db, defaultSettingKey)] as const),
    );
    setDefaultValues(Object.fromEntries(defaultEntries) as DefaultFieldState);
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
      Alert.alert(t('common.couldNotSave'), t('common.pleaseTryAgain'));
    } finally {
      setBusyKey(null);
    }
  };

  const persistDefault = async (key: ActivityDetailDefaultSettingKey, next: boolean | null) => {
    if (!defaultValues) return;
    const previous = defaultValues[key];
    setDefaultValues((current) => (current ? { ...current, [key]: next } : current));
    setBusyKey(key);
    try {
      await setSetting(db, key, next);
    } catch (error) {
      setDefaultValues((current) => (current ? { ...current, [key]: previous } : current));
      logError('Saving activityDetails default setting failed', error);
      Alert.alert(t('common.couldNotSave'), t('common.pleaseTryAgain'));
    } finally {
      setBusyKey(null);
    }
  };

  if (!values || !defaultValues) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.textSecondary, padding: spacing.md }}>{t('common.loading')}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.intro, { color: colors.textSecondary }]}>{t('settings.activityDetails.intro')}</Text>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('settings.activityDetails.sectionLabel')}</Text>
        <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {ACTIVITY_DETAIL_FIELDS.map(({ field, settingKey, defaultSettingKey }, index) => (
            <View
              key={settingKey}
              style={[{ borderColor: colors.border }, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth }]}
            >
              <View style={styles.row}>
                <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>{activityDetailFieldLabel(t, field)}</Text>
                <Switch
                  value={values[settingKey]}
                  onValueChange={(next) => persist(settingKey, next)}
                  disabled={busyKey === settingKey}
                />
              </View>
              {defaultSettingKey && values[settingKey] && (
                <View style={styles.defaultRow}>
                  <Text style={[styles.defaultLabel, { color: colors.textSecondary }]}>
                    {t('settings.activityDetails.defaultLabel')}
                  </Text>
                  <View style={styles.segmentedRow}>
                    {DEFAULT_OPTIONS.map((opt) => {
                      const selected = defaultValues[defaultSettingKey] === opt.value;
                      return (
                        <Pressable
                          key={opt.key}
                          onPress={() => persistDefault(defaultSettingKey, opt.value)}
                          disabled={busyKey === defaultSettingKey}
                          style={[
                            styles.segment,
                            { borderColor: colors.border, backgroundColor: selected ? colors.solo : 'transparent' },
                          ]}
                        >
                          <Text style={{ color: selected ? colors.background : colors.textPrimary, fontSize: 12 }}>
                            {t(opt.labelKey)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>
          ))}
        </View>

        <Text style={[styles.caption, { color: colors.textTertiary }]}>{t('settings.activityDetails.caption')}</Text>
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
  defaultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  defaultLabel: { fontSize: 13 },
  segmentedRow: { flexDirection: 'row', gap: spacing.xs },
  segment: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  caption: { fontSize: 12, paddingHorizontal: spacing.xs, lineHeight: 17 },
});
