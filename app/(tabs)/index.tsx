/**
 * UI/UX §7 — Today. The app's main screen: this month's counts, last
 * activity (a plain fact, never "🔥 streak", §19), recent history, and
 * the single most important control in the app — the Record FAB
 * (§7.1 "基本記録は2タップ以内を目標とする").
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useTheme, spacing } from '../../constants/theme';
import { useDatabase } from '../../contexts/DatabaseContext';
import { useDataRevision } from '../../contexts/DataRevision';
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

/** Format (word order, punctuation) lives in `today.dateHeader` itself, not just the substituted words — see `lib/timeFormat.ts`'s doc comment on why. */
function weekdayHeader(t: TFunction): string {
  const now = new Date();
  const weekdaysFull = t('common.weekdaysFull', { returnObjects: true }) as unknown as string[];
  const weekdayInitials = t('common.weekdayInitials', { returnObjects: true }) as unknown as string[];
  const monthsFull = t('common.monthsFull', { returnObjects: true }) as unknown as string[];
  return t('today.dateHeader', {
    weekdayFull: weekdaysFull[now.getDay()],
    weekdayShort: weekdayInitials[now.getDay()],
    month: monthsFull[now.getMonth()],
    day: now.getDate(),
  });
}

export default function TodayScreen({ isActive }: { isActive: boolean }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const db = useDatabase();
  const { revision } = useDataRevision();
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

  // A single effect for both reasons to reload (becoming the active pager
  // page, and Undo's revision bump — contexts/DataRevision.tsx, which runs
  // on this screen without any page change happening). `isActive` replaces
  // the `useFocusEffect` this screen used to get from being its own React
  // Navigation screen: it's not just "which pager page is showing" — it's
  // ANDed with whether the `(tabs)` route itself has navigation focus (see
  // `routeFocused` in app/(tabs)/_layout.tsx), which is what makes a
  // save/edit/delete on record/activity screens reload this screen on
  // return. Don't drop that half assuming `isActive` alone covers it. See
  // screens/CalendarScreen.tsx for the same pattern.
  useEffect(() => {
    if (isActive) reload();
  }, [isActive, reload, revision]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.appName, { color: colors.textPrimary }]}>Solo + Us</Text>
          <Pressable
            onPress={() => router.push('/settings')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('navigation.settings')}
          >
            <Ionicons name="settings-outline" size={24} color={colors.textPrimary} />
          </Pressable>
        </View>
        <Text style={[styles.dateLine, { color: colors.textSecondary }]}>{weekdayHeader(t)}</Text>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('today.thisMonth')}</Text>
          {counts.total === 0 ? (
            <EmptyState />
          ) : (
            <>
              <View style={styles.totalRow}>
                <Text style={[styles.totalValue, { color: colors.textPrimary }]}>{counts.total}</Text>
                <Text style={[styles.totalCaption, { color: colors.textSecondary }]}>{t('today.activities', { count: counts.total })}</Text>
              </View>
              <View style={styles.metricsRow}>
                <MetricCard value={counts.solo} label={contextLabel(t, 'solo')} color={colors.solo} />
                <MetricCard value={counts.partnered} label={contextLabel(t, 'partnered')} color={colors.partneredStrong} />
              </View>
            </>
          )}
        </View>

        {lastActivity && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('today.lastActivity')}</Text>
            <Text style={[styles.lastActivityLine, { color: colors.textPrimary }]}>
              {contextLabel(t, lastActivity.context)}
            </Text>
            <Text style={[styles.lastActivityCaption, { color: colors.textSecondary }]}>
              {formatRelativeLocalDate(t, lastActivity.occurredLocalDate, todayLocalDate())}
            </Text>
          </View>
        )}

        {recent.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('today.recent')}</Text>
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
        accessibilityLabel={t('today.recordActivityA11y')}
      >
        <IntersectPlus size={26} tint="#FFFFFF" />
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
  totalRow: { alignItems: 'center', gap: 2 },
  totalValue: { fontSize: 44, fontWeight: '700', textAlign: 'center' },
  totalCaption: { fontSize: 14, textAlign: 'center' },
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
