import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme, minTouchTarget } from '../constants/theme';
import { ActivityBadge } from './ActivityBadge';
import { formatMonthDay } from '../lib/relativeDate';
import { contextLabel } from '../lib/labels';
import type { Activity } from '../types/Activity';

export function ActivityRow({ activity }: { activity: Activity }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={() => router.push(`/activity/${activity.id}`)}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1, minHeight: minTouchTarget }]}
      accessibilityRole="button"
      accessibilityLabel={t('components.activityRow.a11yLabel', {
        context: contextLabel(t, activity.context),
        date: formatMonthDay(t, activity.occurredLocalDate),
      })}
    >
      <Text style={[styles.date, { color: colors.textSecondary }]}>{formatMonthDay(t, activity.occurredLocalDate)}</Text>
      <View style={{ flex: 1 }}>
        <ActivityBadge context={activity.context} />
      </View>
      <Text style={[styles.chevron, { color: colors.textTertiary }]}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 },
  date: { fontSize: 14, width: 52 },
  chevron: { fontSize: 18 },
});
