import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTheme, minTouchTarget } from '../constants/theme';
import { ActivityBadge } from './ActivityBadge';
import type { Activity } from '../types/Activity';

function formatMonthDay(localDate: string): string {
  const [, m, d] = localDate.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}`;
}

export function ActivityRow({ activity }: { activity: Activity }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => router.push(`/activity/${activity.id}`)}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1, minHeight: minTouchTarget }]}
      accessibilityRole="button"
      accessibilityLabel={`${activity.context} activity, ${formatMonthDay(activity.occurredLocalDate)}`}
    >
      <Text style={[styles.date, { color: colors.textSecondary }]}>{formatMonthDay(activity.occurredLocalDate)}</Text>
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
