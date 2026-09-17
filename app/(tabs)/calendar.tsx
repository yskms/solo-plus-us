/**
 * UI/UX §13 Screen 05 — Calendar. Month grid with a per-day activity
 * indicator; tapping a day shows that day's activities below, from which
 * each one opens Activity Detail (§10).
 *
 * Per §13 "Multiple activities": 1-2 activities on a day show one dot per
 * activity (colored by that activity's own context); 3+ collapse into a
 * single count ("● 3") rather than listing dots one by one.
 *
 * The month grid's dots are colored but carry no text label — normally a
 * hard rule (§3 "Solo/Partneredの判別を色だけに依存しないこと"), but every
 * dot is on a tappable day that immediately reveals the same information
 * as an accessible, labeled list below (and via each cell's
 * accessibilityLabel), so nothing is *only* conveyed by color.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, spacing, radius, minTouchTarget } from '../../constants/theme';
import type { ThemeColors } from '../../constants/theme';
import { useDatabase } from '../../contexts/DatabaseContext';
import { useDataRevision } from '../../contexts/DataRevision';
import { findActivitiesByDateRange } from '../../repositories/ActivityRepository';
import { getSetting } from '../../services/SettingsRepository';
import {
  buildMonthGrid,
  weekdayHeaderLabels,
  shiftMonth,
  monthLabel,
  localDateRangeForMonth,
  type CalendarCell,
} from '../../lib/calendarGrid';
import { formatLocalTime } from '../../lib/timeFormat';
import { formatMonthDay } from '../../lib/relativeDate';
import { contextLabel } from '../../lib/labels';
import { ActivityBadge } from '../../components/ActivityBadge';
import { EmptyState } from '../../components/EmptyState';
import { logError } from '../../lib/log';
import type { Activity } from '../../types/Activity';
import type { FirstDayOfWeek, TimeFormat } from '../../types/Settings';

function todayLocalDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Per-day summary: up to 2 individual dots, or a single collapsed "● N" for 3+ (§13). */
function DayDots({ dayActivities, colors }: { dayActivities: Activity[]; colors: ThemeColors }) {
  if (dayActivities.length === 0) return <View style={styles.dotRow} />;

  if (dayActivities.length <= 2) {
    return (
      <View style={styles.dotRow}>
        {dayActivities.map((activity) => (
          <View
            key={activity.id}
            style={[styles.dot, { backgroundColor: activity.context === 'solo' ? colors.solo : colors.partnered }]}
          />
        ))}
      </View>
    );
  }

  return (
    <View style={styles.dotRow}>
      <View style={[styles.dot, { backgroundColor: colors.intersection }]} />
      <Text style={[styles.dotCount, { color: colors.textSecondary }]}>{dayActivities.length}</Text>
    </View>
  );
}

function dayCellAccessibilityLabel(cell: CalendarCell, dayActivities: Activity[]): string {
  const dateLabel = formatMonthDay(cell.localDate);
  if (dayActivities.length === 0) return `${dateLabel}, no activities`;
  const solo = dayActivities.filter((a) => a.context === 'solo').length;
  const partnered = dayActivities.length - solo;
  const parts: string[] = [];
  if (solo > 0) parts.push(`${solo} solo`);
  if (partnered > 0) parts.push(`${partnered} partnered`);
  return `${dateLabel}, ${parts.join(', ')}`;
}

export default function CalendarScreen() {
  const { colors } = useTheme();
  const db = useDatabase();
  const { revision } = useDataRevision();

  const today = todayLocalDate();
  const [todayYear, todayMonth] = today.split('-').map(Number);
  const [visible, setVisible] = useState({ year: todayYear, month: todayMonth });
  const [selectedLocalDate, setSelectedLocalDate] = useState<string | null>(today);
  const [byDate, setByDate] = useState<Map<string, Activity[]>>(new Map());
  const [firstDayOfWeek, setFirstDayOfWeek] = useState<FirstDayOfWeek>('monday');
  const [timeFormat, setTimeFormat] = useState<TimeFormat>('24h');

  const reload = useCallback(async () => {
    try {
      const [fdow, tf] = await Promise.all([
        getSetting(db, 'preferences.firstDayOfWeek'),
        getSetting(db, 'preferences.timeFormat'),
      ]);
      setFirstDayOfWeek(fdow);
      setTimeFormat(tf);

      const { fromLocalDate, toLocalDate } = localDateRangeForMonth(visible.year, visible.month);
      const activities = await findActivitiesByDateRange(db, { fromLocalDate, toLocalDate });
      const grouped = new Map<string, Activity[]>();
      for (const activity of activities) {
        const list = grouped.get(activity.occurredLocalDate) ?? [];
        list.push(activity);
        grouped.set(activity.occurredLocalDate, list);
      }
      setByDate(grouped);
    } catch (error) {
      logError('Calendar reload failed', error);
    }
  }, [db, visible]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  // Undo (contexts/DataRevision.tsx) can change data without a navigation
  // event — see app/(tabs)/index.tsx for the same pattern.
  useEffect(() => {
    reload();
  }, [revision, reload]);

  const grid = buildMonthGrid(visible.year, visible.month, firstDayOfWeek);
  const headerLabels = weekdayHeaderLabels(firstDayOfWeek);
  const selectedActivities = (selectedLocalDate ? byDate.get(selectedLocalDate) : undefined) ?? [];
  const sortedSelectedActivities = [...selectedActivities].sort((a, b) =>
    a.occurredLocalTime.localeCompare(b.occurredLocalTime),
  );

  const goToMonth = (delta: number) => {
    setVisible((prev) => shiftMonth(prev.year, prev.month, delta));
    // A day selected in a different month has no meaning once the grid moves.
    setSelectedLocalDate(null);
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['top']}>
      <Text style={[styles.screenTitle, { color: colors.textPrimary }]}>Calendar</Text>

      <View style={styles.monthHeader}>
        <Pressable
          onPress={() => goToMonth(-1)}
          hitSlop={8}
          style={styles.navButton}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
        >
          <Text style={[styles.navArrow, { color: colors.textPrimary }]}>‹</Text>
        </Pressable>
        <Text style={[styles.monthTitle, { color: colors.textPrimary }]}>{monthLabel(visible.year, visible.month)}</Text>
        <Pressable
          onPress={() => goToMonth(1)}
          hitSlop={8}
          style={styles.navButton}
          accessibilityRole="button"
          accessibilityLabel="Next month"
        >
          <Text style={[styles.navArrow, { color: colors.textPrimary }]}>›</Text>
        </Pressable>
      </View>

      <View style={styles.weekdayRow}>
        {headerLabels.map((label, i) => (
          <Text key={i} style={[styles.weekdayLabel, { color: colors.textTertiary }]}>
            {label}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {grid.map((cell, i) => {
          if (!cell) return <View key={i} style={styles.dayCell} />;
          const dayActivities = byDate.get(cell.localDate) ?? [];
          const isSelected = cell.localDate === selectedLocalDate;
          const isToday = cell.localDate === today;
          return (
            <Pressable
              key={i}
              onPress={() => setSelectedLocalDate(cell.localDate)}
              style={[styles.dayCell, isSelected && { backgroundColor: colors.surface, borderRadius: radius.sm }]}
              accessibilityRole="button"
              accessibilityLabel={dayCellAccessibilityLabel(cell, dayActivities)}
            >
              <Text style={[styles.dayNumber, { color: isToday ? colors.solo : colors.textPrimary }]}>
                {cell.dayOfMonth}
              </Text>
              <DayDots dayActivities={dayActivities} colors={colors} />
            </Pressable>
          );
        })}
      </View>

      <ScrollView style={styles.dayPanel} contentContainerStyle={styles.dayPanelContent}>
        {selectedLocalDate && (
          <>
            <Text style={[styles.selectedDateLabel, { color: colors.textSecondary }]}>
              {formatMonthDay(selectedLocalDate)}
            </Text>
            {sortedSelectedActivities.length === 0 ? (
              <EmptyState />
            ) : (
              sortedSelectedActivities.map((activity) => (
                <Pressable
                  key={activity.id}
                  onPress={() => router.push(`/activity/${activity.id}`)}
                  style={({ pressed }) => [styles.activityRow, { opacity: pressed ? 0.6 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${contextLabel(activity.context)} activity, ${formatLocalTime(activity.occurredLocalTime, timeFormat)}`}
                >
                  <ActivityBadge context={activity.context} />
                  <Text style={[styles.activityTime, { color: colors.textSecondary }]}>
                    {formatLocalTime(activity.occurredLocalTime, timeFormat)}
                  </Text>
                </Pressable>
              ))
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  screenTitle: { fontSize: 22, fontWeight: '700', paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.sm,
  },
  navButton: { minWidth: minTouchTarget, minHeight: minTouchTarget, alignItems: 'center', justifyContent: 'center' },
  navArrow: { fontSize: 22, fontWeight: '600' },
  monthTitle: { fontSize: 17, fontWeight: '700', minWidth: 180, textAlign: 'center' },
  weekdayRow: { flexDirection: 'row', paddingHorizontal: spacing.md },
  weekdayLabel: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.md },
  dayCell: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  dayNumber: { fontSize: 14, fontWeight: '500' },
  dotRow: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 8 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotCount: { fontSize: 10, fontWeight: '600' },
  dayPanel: { flex: 1, marginTop: spacing.md },
  dayPanelContent: { paddingHorizontal: spacing.md, paddingBottom: 32, gap: spacing.xs },
  selectedDateLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 0.5, marginBottom: spacing.xs },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    minHeight: minTouchTarget,
  },
  activityTime: { fontSize: 13 },
});
