/**
 * UI/UX §13 Screen 05 — Calendar. Month grid with a per-day activity
 * indicator; tapping a day shows that day's activities below, from which
 * each one opens Activity Detail (§10).
 *
 * Per §13 "Multiple activities": 1-2 activities on a day show one dot per
 * activity; 3+ collapse into a single count ("● 3") rather than listing
 * dots one by one. Solo/Partnered on those individual dots is distinguished
 * by shape (filled vs. hollow), not color alone — see `DayDots` — per §24
 * A3 and §13 "色＋activity indicator で識別". An earlier version relied on
 * color plus each cell's `accessibilityLabel`, but a label only reaches
 * screen-reader users; a sighted person with a color-vision deficiency
 * would still have had to tap every day to tell them apart.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useTheme, spacing, radius, minTouchTarget } from '../constants/theme';
import type { ThemeColors } from '../constants/theme';
import { useDatabase } from '../contexts/DatabaseContext';
import { useDataRevision } from '../contexts/DataRevision';
import { findActivitiesByDateRange } from '../repositories/ActivityRepository';
import { getSetting } from '../services/SettingsRepository';
import {
  buildMonthGrid,
  weekdayHeaderLabels,
  shiftMonth,
  monthLabel,
  localDateRangeForMonth,
  type CalendarCell,
} from '../lib/calendarGrid';
import { formatLocalTime } from '../lib/timeFormat';
import { formatMonthDay } from '../lib/relativeDate';
import { contextLabel } from '../lib/labels';
import { ActivityBadge } from '../components/ActivityBadge';
import { EmptyState } from '../components/EmptyState';
import { logError } from '../lib/log';
import type { Activity } from '../types/Activity';
import type { FirstDayOfWeek, TimeFormat } from '../types/Settings';

function todayLocalDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Per-day summary: up to 2 individual dots, or a single collapsed count for
 * 3+ (§13). Solo is a hollow (outlined) dot, Partnered is a filled dot —
 * shape, not just color, carries the distinction (UI/UX §24 A3, §13 "色＋
 * activity indicator で識別").
 *
 * Both dots use `colors.partneredStrong`/`colors.solo` rather than the
 * plain `colors.partnered` — `colors.partnered` (`#F4A699` light) only
 * reaches ~1.8-1.95:1 against `background`/`surface`, below WCAG 1.4.11's
 * 3:1 for graphical objects *regardless* of fill vs. outline (that ratio
 * is between the shape's own color and the background either way; an
 * earlier version of this fix swapped Solo/Partnered's shapes assuming
 * that alone would resolve it, which was wrong). `partneredStrong` is the
 * darker/more legible variant for exactly this case — see `ThemeColors`.
 *
 * The 3+ case shows the count as text with no dot at all, rather than a
 * third dot style — a plain filled dot there would look identical to a
 * single Partnered activity and misread as "Partnered" rather than "a
 * nonspecific multi-activity day". It isn't asserting any one activity's
 * context, so the shape rule for *distinguishing* Solo from Partnered
 * doesn't apply to it.
 */
function DayDots({ dayActivities, colors }: { dayActivities: Activity[]; colors: ThemeColors }) {
  if (dayActivities.length === 0) return <View style={styles.dotRow} />;

  if (dayActivities.length <= 2) {
    return (
      <View style={styles.dotRow}>
        {dayActivities.map((activity) =>
          activity.context === 'solo' ? (
            <View
              key={activity.id}
              style={[styles.dot, styles.dotHollow, { borderColor: colors.solo, backgroundColor: colors.background }]}
            />
          ) : (
            <View key={activity.id} style={[styles.dot, { backgroundColor: colors.partneredStrong }]} />
          ),
        )}
      </View>
    );
  }

  return (
    <View style={styles.dotRow}>
      <Text style={[styles.dotCount, { color: colors.textSecondary }]}>{dayActivities.length}</Text>
    </View>
  );
}

function dayCellAccessibilityLabel(t: TFunction, cell: CalendarCell, dayActivities: Activity[]): string {
  const dateLabel = formatMonthDay(t, cell.localDate);
  if (dayActivities.length === 0) return t('calendar.dayCellA11y.noActivities', { date: dateLabel });
  const solo = dayActivities.filter((a) => a.context === 'solo').length;
  const partnered = dayActivities.length - solo;
  const parts: string[] = [];
  if (solo > 0) parts.push(t('calendar.dayCellA11y.countPart', { count: solo, label: contextLabel(t, 'solo') }));
  if (partnered > 0) parts.push(t('calendar.dayCellA11y.countPart', { count: partnered, label: contextLabel(t, 'partnered') }));
  return t('calendar.dayCellA11y.withActivities', { date: dateLabel, parts: parts.join(t('common.listSeparator')) });
}

export default function CalendarScreen({ isActive }: { isActive: boolean }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const db = useDatabase();
  const { revision } = useDataRevision();

  const today = todayLocalDate();
  const [todayYear, todayMonth] = today.split('-').map(Number);
  const [visible, setVisible] = useState({ year: todayYear, month: todayMonth });
  const [selectedLocalDate, setSelectedLocalDate] = useState<string | null>(today);
  const [byDate, setByDate] = useState<Map<string, Activity[]>>(new Map());
  // `null` (not yet known) rather than a guessed 'monday' default — `grid`/
  // `headerLabels` below wait on this instead of rendering once with a
  // possibly-wrong week order and then re-flowing.
  const [firstDayOfWeek, setFirstDayOfWeek] = useState<FirstDayOfWeek | null>(null);
  const [timeFormat, setTimeFormat] = useState<TimeFormat>('24h');
  // Distinct from `firstDayOfWeek === null`: that alone can't tell "still
  // loading" from "loading failed", so a failed first load would leave the
  // grid silently blank forever with no indication anything went wrong —
  // and, separately, `byDate` starts out genuinely empty, which without
  // this would show the day panel's "no activities" EmptyState for a
  // moment before the real (possibly non-empty) data arrives.
  const [loadStatus, setLoadStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  // Guards against two reloads racing: switching months quickly fires a
  // new `reload` before the previous month's query has resolved, and
  // nothing guarantees they resolve in the order they were started. Each
  // call claims the next id; a result is only applied if no newer call has
  // started since — otherwise an in-flight request for a month the user
  // has already navigated away from could win the race and overwrite the
  // correct, newer data with stale results for the wrong month.
  const requestSeqRef = useRef(0);

  const reload = useCallback(async () => {
    const requestId = ++requestSeqRef.current;
    try {
      const [fdow, tf] = await Promise.all([
        getSetting(db, 'preferences.firstDayOfWeek'),
        getSetting(db, 'preferences.timeFormat'),
      ]);

      const { fromLocalDate, toLocalDate } = localDateRangeForMonth(visible.year, visible.month);
      const activities = await findActivitiesByDateRange(db, { fromLocalDate, toLocalDate });
      if (requestSeqRef.current !== requestId) return; // superseded by a newer reload — discard

      const grouped = new Map<string, Activity[]>();
      for (const activity of activities) {
        const list = grouped.get(activity.occurredLocalDate) ?? [];
        list.push(activity);
        grouped.set(activity.occurredLocalDate, list);
      }
      setFirstDayOfWeek(fdow);
      setTimeFormat(tf);
      setByDate(grouped);
      setLoadStatus('ready');
    } catch (error) {
      if (requestSeqRef.current !== requestId) return;
      logError('Calendar reload failed', error);
      setLoadStatus('error');
    }
  }, [db, visible]);

  // A single effect for every reason to reload (becoming the active pager
  // page, month change, Undo's revision bump — contexts/DataRevision.tsx)
  // rather than a separate plain `useEffect` alongside this: `reload`'s
  // identity already changes with `visible`, so a second, independently
  // triggered effect here would fire its own extra reload on every month
  // change — exactly the duplicate-request pattern that made the race above
  // easy to hit in practice. `isActive` replaces the `useFocusEffect` this
  // screen used to get from being its own React Navigation screen — see
  // app/(tabs)/index.tsx (Today) for why.
  useEffect(() => {
    if (isActive) reload();
  }, [isActive, reload, revision]);

  // Until the real setting loads, don't guess: building the grid with an
  // assumed 'monday' and re-flowing it once 'sunday' arrives would flash a
  // visibly different layout for Sunday-first users on every open.
  const grid = firstDayOfWeek ? buildMonthGrid(visible.year, visible.month, firstDayOfWeek) : null;
  const headerLabels = firstDayOfWeek ? weekdayHeaderLabels(t, firstDayOfWeek) : null;
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
      <Text style={[styles.screenTitle, { color: colors.textPrimary }]}>{t('navigation.tabs.calendar')}</Text>

      <View style={styles.monthHeader}>
        <Pressable
          onPress={() => goToMonth(-1)}
          hitSlop={8}
          style={styles.navButton}
          accessibilityRole="button"
          accessibilityLabel={t('calendar.previousMonth')}
        >
          <Text style={[styles.navArrow, { color: colors.textPrimary }]}>‹</Text>
        </Pressable>
        <Text style={[styles.monthTitle, { color: colors.textPrimary }]}>{monthLabel(t, visible.year, visible.month)}</Text>
        <Pressable
          onPress={() => goToMonth(1)}
          hitSlop={8}
          style={styles.navButton}
          accessibilityRole="button"
          accessibilityLabel={t('calendar.nextMonth')}
        >
          <Text style={[styles.navArrow, { color: colors.textPrimary }]}>›</Text>
        </Pressable>
      </View>

      {loadStatus === 'loading' && (
        <View style={styles.statusBlock}>
          <Text style={[styles.statusText, { color: colors.textSecondary }]}>{t('common.loading')}</Text>
        </View>
      )}

      {loadStatus === 'error' && (
        <View style={styles.statusBlock}>
          <Text style={[styles.statusText, { color: colors.textSecondary }]}>{t('calendar.loadError')}</Text>
        </View>
      )}

      {loadStatus === 'ready' && headerLabels && grid && (
        <>
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
                  style={[styles.dayCell, isSelected && { borderColor: colors.solo }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={dayCellAccessibilityLabel(t, cell, dayActivities)}
                >
                  <Text
                    style={[
                      styles.dayNumber,
                      { color: isToday ? colors.solo : colors.textPrimary, fontWeight: isToday ? '800' : '500' },
                    ]}
                  >
                    {cell.dayOfMonth}
                  </Text>
                  <DayDots dayActivities={dayActivities} colors={colors} />
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      <ScrollView style={styles.dayPanel} contentContainerStyle={styles.dayPanelContent}>
        {loadStatus === 'ready' && selectedLocalDate && (
          <>
            <Text style={[styles.selectedDateLabel, { color: colors.textSecondary }]}>
              {formatMonthDay(t, selectedLocalDate)}
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
                  accessibilityLabel={t('calendar.activityRowA11y', {
                    context: contextLabel(t, activity.context),
                    time: formatLocalTime(t, activity.occurredLocalTime, timeFormat),
                  })}
                >
                  <ActivityBadge context={activity.context} />
                  <Text style={[styles.activityTime, { color: colors.textSecondary }]}>
                    {formatLocalTime(t, activity.occurredLocalTime, timeFormat)}
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
  screenTitle: { fontSize: 22, fontWeight: '700', paddingHorizontal: spacing.md, paddingTop: spacing.md },
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
  statusBlock: { paddingHorizontal: spacing.md, paddingVertical: spacing.lg, alignItems: 'center' },
  statusText: { fontSize: 14, textAlign: 'center' },
  weekdayRow: { flexDirection: 'row', paddingHorizontal: spacing.md },
  weekdayLabel: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.md },
  dayCell: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderWidth: 1.5,
    borderColor: 'transparent',
    borderRadius: radius.sm,
  },
  dayNumber: { fontSize: 14, fontWeight: '500' },
  dotRow: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 8 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  dotHollow: { borderWidth: 1.5 },
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
