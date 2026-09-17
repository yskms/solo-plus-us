/**
 * UI/UX §14 Screen 06 — Insights. v1.0 scope only, per 要件定義書 §25's MVP
 * table: "Insights（合計・内訳・平均間隔）" is the v1.0 row. "All Time" was
 * originally listed under the v1.1 row ("年次・曜日・時間帯・All Time")
 * alongside the Period Selector (§15), the monthly bar chart, and Most
 * common day/time — but this screen's totals *are* all-time, so that row
 * was corrected to move "All Time" into v1.0 (see 要件定義書 §25). The
 * Period Selector itself (Month/Year toggles), the monthly bar chart, and
 * Most common day/time remain v1.1 and are not built here.
 *
 * This is deliberately *not* the same figure as Today's "THIS MONTH" card
 * (current calendar month only) — all-time totals and an average interval
 * are the "look back over years" view Today never shows. Because there's
 * no period selector yet, "All time" is stated once, screen-level, so
 * nothing here reads as "this year" (the UI/UX §14 mockup's own period
 * dropdown default) by omission.
 */
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, spacing } from '../../constants/theme';
import { useDatabase } from '../../contexts/DatabaseContext';
import { useDataRevision } from '../../contexts/DataRevision';
import type { ActivityCounts } from '../../repositories/ActivityRepository';
import { getInsightsSnapshot } from '../../services/StatisticsService';
import { formatAverageIntervalDays } from '../../lib/statistics';
import { MetricCard } from '../../components/MetricCard';
import { EmptyState } from '../../components/EmptyState';
import { logError } from '../../lib/log';

export default function InsightsScreen() {
  const { colors } = useTheme();
  const db = useDatabase();
  const { revision } = useDataRevision();

  const [counts, setCounts] = useState<ActivityCounts>({ total: 0, solo: 0, partnered: 0 });
  const [averageInterval, setAverageInterval] = useState<number | null>(null);
  // loading/ready/error, not just a boolean — a failed load must say so
  // rather than leaving the screen blank with no indication anything went
  // wrong (see app/(tabs)/calendar.tsx, same reasoning).
  const [loadStatus, setLoadStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const reload = useCallback(async () => {
    try {
      const snapshot = await getInsightsSnapshot(db);
      setCounts(snapshot.counts);
      setAverageInterval(snapshot.averageIntervalDays);
      setLoadStatus('ready');
    } catch (error) {
      logError('Insights reload failed', error);
      setLoadStatus('error');
    }
  }, [db]);

  // Single effect for both focus and Undo's revision bump (contexts/
  // DataRevision.tsx) — see app/(tabs)/calendar.tsx / app/(tabs)/index.tsx
  // for why this isn't a separate plain `useEffect` alongside it.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload, revision]),
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.screenTitle, { color: colors.textPrimary }]}>Insights</Text>
        <Text style={[styles.periodCaption, { color: colors.textTertiary }]}>All time</Text>

        {loadStatus === 'loading' && (
          <Text style={[styles.statusText, { color: colors.textSecondary }]}>Loading…</Text>
        )}

        {loadStatus === 'error' && (
          <Text style={[styles.statusText, { color: colors.textSecondary }]}>
            Couldn&apos;t load your insights. Leaving and reopening this tab will try again.
          </Text>
        )}

        {loadStatus === 'ready' && (
          <>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>TOTAL ACTIVITIES</Text>
              {counts.total === 0 ? (
                <EmptyState />
              ) : (
                <>
                  <Text style={[styles.totalValue, { color: colors.textPrimary }]}>{counts.total}</Text>
                  <View style={styles.metricsRow}>
                    <MetricCard value={counts.solo} label="Solo" color={colors.solo} />
                    <MetricCard value={counts.partnered} label="Partnered" color={colors.partneredStrong} />
                  </View>
                </>
              )}
            </View>

            {counts.total > 0 && (
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>YOUR PATTERNS</Text>
                <Text style={[styles.patternLabel, { color: colors.textSecondary }]}>Average interval</Text>
                <Text style={[styles.patternValue, { color: colors.textPrimary }]}>
                  {formatAverageIntervalDays(averageInterval)}
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: 48 },
  screenTitle: { fontSize: 22, fontWeight: '700' },
  periodCaption: { fontSize: 13, marginTop: -4 },
  statusText: { fontSize: 14, textAlign: 'center', marginTop: spacing.lg },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, gap: spacing.sm },
  sectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  totalValue: { fontSize: 44, fontWeight: '700', textAlign: 'center' },
  metricsRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xl },
  patternLabel: { fontSize: 13 },
  patternValue: { fontSize: 22, fontWeight: '700' },
});
