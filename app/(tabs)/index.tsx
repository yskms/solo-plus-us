/**
 * UI/UX §7 — Today. The app's main screen: this month's counts, last
 * activity (a plain fact, never "🔥 streak", §19), recent history, and
 * the single most important control in the app — the Record FAB
 * (§7.1 "基本記録は2タップ以内を目標とする").
 */
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, spacing } from '../../constants/theme';
import { useDatabase } from '../../contexts/DatabaseContext';
import { countActivitiesByDateRange, findRecentActivities, type ActivityCounts } from '../../repositories/ActivityRepository';
import { formatRelativeLocalDate } from '../../lib/relativeDate';
import { contextLabel } from '../../lib/labels';
import { MetricCard } from '../../components/MetricCard';
import { ActivityRow } from '../../components/ActivityRow';
import { EmptyState } from '../../components/EmptyState';
import { IntersectPlus } from '../../components/IntersectPlus';
import type { Activity } from '../../types/Activity';

function todayLocalDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function monthRangeFor(localDate: string): { from: string; to: string } {
  const [y, m] = localDate.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}` };
}

function weekdayHeader(): string {
  const now = new Date();
  return now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

export default function TodayScreen() {
  const { colors } = useTheme();
  const db = useDatabase();
  const [counts, setCounts] = useState<ActivityCounts>({ total: 0, solo: 0, partnered: 0 });
  const [recent, setRecent] = useState<Activity[]>([]);
  const [lastActivity, setLastActivity] = useState<Activity | null>(null);

  const reload = useCallback(async () => {
    const today = todayLocalDate();
    const { from, to } = monthRangeFor(today);
    const [monthCounts, recentActivities] = await Promise.all([
      countActivitiesByDateRange(db, { fromLocalDate: from, toLocalDate: to }),
      findRecentActivities(db, 5),
    ]);
    setCounts(monthCounts);
    setRecent(recentActivities);
    setLastActivity(recentActivities[0] ?? null);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.appName, { color: colors.textPrimary }]}>Solo + Us</Text>
        </View>
        <Text style={[styles.dateLine, { color: colors.textSecondary }]}>{weekdayHeader()}</Text>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>THIS MONTH</Text>
          {counts.total === 0 ? (
            <EmptyState />
          ) : (
            <>
              <View style={styles.totalRow}>
                <Text style={[styles.totalValue, { color: colors.textPrimary }]}>{counts.total}</Text>
                <Text style={[styles.totalCaption, { color: colors.textSecondary }]}>activities</Text>
              </View>
              <View style={styles.metricsRow}>
                <MetricCard value={counts.solo} label="Solo" color={colors.solo} />
                <MetricCard value={counts.partnered} label="Partnered" color={colors.partnered} />
              </View>
            </>
          )}
        </View>

        {lastActivity && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>LAST ACTIVITY</Text>
            <Text style={[styles.lastActivityLine, { color: colors.textPrimary }]}>
              {contextLabel(lastActivity.context)}
            </Text>
            <Text style={[styles.lastActivityCaption, { color: colors.textSecondary }]}>
              {formatRelativeLocalDate(lastActivity.occurredLocalDate, todayLocalDate())}
            </Text>
          </View>
        )}

        {recent.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>RECENT</Text>
            {recent.map((activity) => (
              <ActivityRow key={activity.id} activity={activity} />
            ))}
          </View>
        )}
      </ScrollView>

      <Pressable
        onPress={() => router.push('/record')}
        style={({ pressed }) => [styles.fab, { backgroundColor: colors.solo, opacity: pressed ? 0.85 : 1 }]}
        accessibilityRole="button"
        accessibilityLabel="Record activity"
      >
        <IntersectPlus size={26} />
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: 120, gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  appName: { fontSize: 22, fontWeight: '700' },
  dateLine: { fontSize: 14 },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, gap: spacing.sm },
  sectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, alignSelf: 'center' },
  totalValue: { fontSize: 44, fontWeight: '700' },
  totalCaption: { fontSize: 14 },
  metricsRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xl },
  lastActivityLine: { fontSize: 17, fontWeight: '600' },
  lastActivityCaption: { fontSize: 13 },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
});
