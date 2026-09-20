/**
 * UI/UX §18 Screen 08 — Health Connect. 基本設計 §9.6（再試行/破棄の operation
 * 別文言）・§10.4（未同期の変更の可視化）・§10.5（切断時の警告）・§9.12
 * （切断は `SyncCoordinator.runExclusive` 経由）を実装する。
 *
 * §10.6「全 Activity 削除」の進行表示付きフローはここには無い——
 * `app/settings/data.tsx`/`index.tsx` の doc comment ですでに明示的に
 * 対象外とされている（README 参照）。切断時の警告が見るのは「未処理の
 * delete job」だけで、全削除フローとは無関係。
 *
 * ## モックからの2つの意図的な逸脱
 * 1. §18 は Partnered/Solo 別々の ON/OFF トグルを描くが、データモデルは
 *    `healthConnect.enabled` という単一 boolean しか持たない
 *    （`types/Settings.ts`、Phase 1 から既存）。ここでは単一の
 *    "Sync to Health Connect" トグルにしている。
 * 2. 未同期の変更一覧は日付＋Solo/Partnered バッジを行ごとに出す設計だが、
 *    `delete` ジョブ（または内部不整合で Activity が消えている行）は
 *    構造的にそれができない——`health_sync_jobs` に `activities` への FK は
 *    無く、delete ジョブは定義上 Activity が既に無いから存在する
 *    （`types/HealthSync.ts` の doc comment）。そうした行は `created_at`
 *    （ジョブが積まれた日時）を代わりに表示し、バッジは出さない
 *    （`buildRow` 参照）。
 *
 * DB アクセスは `useDatabase()` から直接——このトグルは他画面と共有する
 * 必要が無く、`ScreenshotBlock.tsx` のような専用 Context は不要（SyncWorker
 * 側は毎回 DB から設定を読み直すため、JS 側にキャッシュを持つ理由が無い）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, spacing, minTouchTarget } from '../../constants/theme';
import { useDatabase } from '../../contexts/DatabaseContext';
import { useDataRevision } from '../../contexts/DataRevision';
import { getSetting, setSetting } from '../../services/SettingsRepository';
import * as HealthConnectService from '../../services/HealthConnectService';
import * as SyncCoordinator from '../../services/SyncCoordinator';
import * as HealthSyncJobRepository from '../../repositories/HealthSyncJobRepository';
import * as ActivityRepository from '../../repositories/ActivityRepository';
import * as HealthSyncManualActions from '../../services/HealthSyncManualActions';
import { describeJobAction, type JobActionCopy } from '../../services/healthSyncJobPresentation';
import { ActivityBadge } from '../../components/ActivityBadge';
import { formatMonthDay } from '../../lib/relativeDate';
import { formatCalendarDateTime } from '../../lib/timeFormat';
import { parseStrictUtcIso, deriveLocalDateTime, resolveOffsetMinutesForZone, getDeviceTimeZoneId } from '../../lib/datetime';
import { logError } from '../../lib/log';
import type { SqlExecutor } from '../../database/SqlExecutor';
import type { HealthSyncJobRow } from '../../types/HealthSync';
import type { ActivityContext } from '../../types/Activity';
import type { TimeFormat } from '../../types/Settings';

/** §10.4/§9.6 の「現在処理中です」— claim 中のジョブに手動操作が競合した場合。 */
function showStillInProgressAlert() {
  Alert.alert('Still in progress', 'Please try again after it finishes.');
}

function localDateFromUtcIso(utcIso: string): string {
  const instant = parseStrictUtcIso(utcIso);
  const offset = resolveOffsetMinutesForZone(getDeviceTimeZoneId(), instant);
  return deriveLocalDateTime(instant, offset).localDate;
}

function formatLastSyncedAt(utcIso: string, timeFormat: TimeFormat): string {
  const instant = parseStrictUtcIso(utcIso);
  const offset = resolveOffsetMinutesForZone(getDeviceTimeZoneId(), instant);
  const { localDate, localTime } = deriveLocalDateTime(instant, offset);
  const [year, month, day] = localDate.split('-').map(Number);
  return formatCalendarDateTime(year, month - 1, day, localTime, timeFormat);
}

interface UnsyncedRowData {
  job: HealthSyncJobRow;
  dateLabel: string;
  /** null → delete ジョブ、または Activity が既に無い内部不整合（バッジ無し、上記の逸脱2参照）。 */
  context: ActivityContext | null;
}

async function buildRow(db: SqlExecutor, job: HealthSyncJobRow): Promise<UnsyncedRowData> {
  const canHaveActivity = job.operation !== 'delete' && job.lastErrorCode !== 'LOCAL_ACTIVITY_NOT_FOUND';
  if (canHaveActivity) {
    const activity = await ActivityRepository.findActivityById(db, job.activityId);
    if (activity) {
      return { job, dateLabel: formatMonthDay(activity.occurredLocalDate), context: activity.context };
    }
  }
  return { job, dateLabel: formatMonthDay(localDateFromUtcIso(job.createdAt)), context: null };
}

function UnsyncedRow({
  row,
  busy,
  onRetry,
  onDiscard,
}: {
  row: UnsyncedRowData;
  busy: boolean;
  onRetry: () => void;
  onDiscard: (copy: JobActionCopy) => void;
}) {
  const { colors } = useTheme();
  const copy = describeJobAction(row.job);
  const claimed = row.job.claimedAt !== null;
  const disabled = claimed || busy;

  return (
    <View style={styles.jobRow}>
      <View style={styles.jobRowHeader}>
        <Text style={[styles.jobDate, { color: colors.textSecondary }]}>{row.dateLabel}</Text>
        {row.context && <ActivityBadge context={row.context} />}
      </View>
      <Text style={[styles.jobStatus, { color: colors.textTertiary }]}>{claimed ? 'Syncing…' : copy.statusText}</Text>
      <View style={styles.jobActions}>
        <Pressable
          onPress={onRetry}
          disabled={disabled}
          style={[styles.jobButton, { borderColor: colors.border, opacity: disabled ? 0.4 : 1 }]}
          accessibilityRole="button"
        >
          <Text style={[styles.jobButtonText, { color: colors.textPrimary }]}>{copy.retryLabel}</Text>
        </Pressable>
        <Pressable
          onPress={() => onDiscard(copy)}
          disabled={disabled}
          style={[styles.jobButton, { borderColor: colors.border, opacity: disabled ? 0.4 : 1 }]}
          accessibilityRole="button"
        >
          <Text style={[styles.jobButtonText, { color: colors.destructive }]}>{copy.discardLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function HealthConnectSettingsScreen() {
  const { colors } = useTheme();
  const db = useDatabase();
  const { revision, bump } = useDataRevision();

  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [available, setAvailable] = useState(false);
  const [timeFormat, setTimeFormat] = useState<TimeFormat>('24h');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [jobs, setJobs] = useState<UnsyncedRowData[]>([]);
  const [toggleBusy, setToggleBusy] = useState(false);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const isLoadingRef = useRef(false);

  const load = useCallback(async () => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    try {
      const [enabledValue, lastSyncedValue, timeFormatValue, jobRows, availableValue] = await Promise.all([
        getSetting(db, 'healthConnect.enabled'),
        getSetting(db, 'healthConnect.lastSyncedAt'),
        getSetting(db, 'preferences.timeFormat'),
        HealthSyncJobRepository.findAllJobsForProvider(db, 'health_connect'),
        HealthConnectService.isAvailable(),
      ]);
      const rows = await Promise.all(jobRows.map((job) => buildRow(db, job)));
      setEnabled(enabledValue);
      setLastSyncedAt(lastSyncedValue);
      setTimeFormat(timeFormatValue);
      setJobs(rows);
      setAvailable(availableValue);
    } catch (error) {
      logError('Loading Health Connect settings failed', error);
    } finally {
      isLoadingRef.current = false;
      setLoaded(true);
    }
  }, [db]);

  useEffect(() => {
    load();
  }, [load, revision]);

  // バックグラウンドの周期 drain（SyncWorkerLoop.tsx の10秒 interval）は
  // DataRevision を bump しないため、この画面を開いたままだと claim 中の
  // 行が完了後も「Syncing…」のまま古びて見える。この画面がマウントされて
  // いる間だけ読み取り専用でジョブ一覧を再取得する——drainDueJobs は一切
  // 呼ばないので、CLAUDE.md が禁じる「新しい drain トリガ」には当たらない。
  useEffect(() => {
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  const handleRetry = async (jobId: string) => {
    setPendingJobId(jobId);
    try {
      const ok = await HealthSyncJobRepository.requestManualRetry(db, jobId);
      if (!ok) {
        showStillInProgressAlert(); // D-39: claim 中に競合した
        return;
      }
      bump(); // SyncWorkerLoop.tsx: 手動再試行直後に drain の機会を作る
    } catch (error) {
      logError('Health Connect manual retry failed', error);
      Alert.alert('Could not retry', 'Please try again.');
    } finally {
      setPendingJobId(null);
    }
  };

  const performDiscard = async (jobId: string) => {
    setPendingJobId(jobId);
    try {
      const result = await HealthSyncManualActions.discardSyncJob(db, jobId);
      if (result === 'not-found-or-claimed') {
        showStillInProgressAlert(); // D-39: claim 中に競合した
        return;
      }
      bump();
    } catch (error) {
      logError('Health Connect discard failed', error);
      Alert.alert('Could not complete', 'Please try again.');
    } finally {
      setPendingJobId(null);
    }
  };

  const handleDiscard = (job: HealthSyncJobRow, copy: JobActionCopy) => {
    if (!copy.discardConfirm) {
      performDiscard(job.id); // 内部不整合（§9.5.3）: 確認文なし
      return;
    }
    Alert.alert(copy.discardConfirm.title, copy.discardConfirm.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: copy.discardLabel, style: 'destructive', onPress: () => performDiscard(job.id) },
    ]);
  };

  const handleEnable = async () => {
    setToggleBusy(true);
    try {
      const isAvailable = await HealthConnectService.isAvailable();
      if (!isAvailable) {
        Alert.alert("Health Connect isn't installed", 'Install Health Connect to sync your records.');
        return;
      }
      await HealthConnectService.ensureInitialized();
      const granted = await HealthConnectService.requestWritePermission();
      if (!granted) {
        Alert.alert('Permission needed', 'Solo + Us needs permission to write to Health Connect.');
        return;
      }
      await setSetting(db, 'healthConnect.enabled', true);
      setEnabled(true);
      setAvailable(true);
      bump(); // §10.5: 再接続で、残っている delete ジョブの再開を早める
    } catch (error) {
      logError('Enabling Health Connect failed', error);
      Alert.alert('Could not connect', 'Please try again.');
    } finally {
      setToggleBusy(false);
    }
  };

  const disconnect = async () => {
    setToggleBusy(true);
    try {
      // §9.12/CLAUDE.md: HC切断は必ず SyncCoordinator.runExclusive 経由。
      // 渡すコールバックは setSetting 一発のみ——内側から drain 相当の
      // 処理を呼ばない（runExclusive のネスト禁止、CLAUDE.md 参照）。
      await SyncCoordinator.runExclusive(() => setSetting(db, 'healthConnect.enabled', false));
      setEnabled(false); // §10.5: ジョブ自体は破棄しない——ここでは enabled のみ変更
    } catch (error) {
      logError('Disconnecting Health Connect failed', error);
      Alert.alert('Could not disconnect', 'Please try again.');
    } finally {
      setToggleBusy(false);
    }
  };

  const pendingDeleteCount = jobs.filter((row) => row.job.operation === 'delete').length;

  const handleDisable = () => {
    if (pendingDeleteCount > 0) {
      // §10.5: 未処理の delete job が残っている場合は必ず警告する。
      Alert.alert(
        `Health Connect has ${pendingDeleteCount} unsynced deletion${pendingDeleteCount > 1 ? 's' : ''}`,
        'If you disconnect, these records will remain in Health Connect. Reconnecting lets you resume the pending deletions.',
        [
          { text: 'Handle first', style: 'cancel' },
          { text: 'Disconnect anyway', style: 'destructive', onPress: disconnect },
        ],
      );
      return;
    }
    disconnect();
  };

  const handleToggle = (next: boolean) => {
    if (next) {
      handleEnable();
    } else {
      handleDisable();
    }
  };

  if (!loaded) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.textSecondary, padding: spacing.md }}>Loading…</Text>
      </SafeAreaView>
    );
  }

  const statusLabel = !enabled ? 'Not connected' : available ? 'Connected' : "Health Connect isn't installed";

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: enabled && available ? colors.solo : colors.textTertiary }]} />
          <Text style={[styles.statusText, { color: colors.textPrimary }]}>{statusLabel}</Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>SYNC TO HEALTH CONNECT</Text>
          <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.toggleRow}>
              <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>Sync to Health Connect</Text>
              <Switch value={enabled} onValueChange={handleToggle} disabled={toggleBusy} />
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>ABOUT SYNCHRONIZATION</Text>
          <Text style={[styles.caption, { color: colors.textTertiary }]}>
            Health Connect only stores the date and time you recorded, and whether protection was used.
          </Text>
          <Text style={[styles.caption, { color: colors.textTertiary }]}>
            Solo/Partnered, Orgasm, Mood, and Notes stay in Solo + Us only.
          </Text>
        </View>

        <View style={styles.section}>
          <View style={styles.lastSyncedRow}>
            <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>Last synced</Text>
            <Text style={[styles.caption, { color: colors.textTertiary }]}>
              {lastSyncedAt ? formatLastSyncedAt(lastSyncedAt, timeFormat) : 'Never'}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
            UNSYNCED CHANGES{jobs.length > 0 ? `  ${jobs.length}` : ''}
          </Text>
          {jobs.length === 0 ? (
            <Text style={[styles.caption, { color: colors.textTertiary }]}>Everything is synced.</Text>
          ) : (
            <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {jobs.map((row, index) => (
                <View
                  key={row.job.id}
                  style={index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border } : undefined}
                >
                  <UnsyncedRow
                    row={row}
                    busy={pendingJobId === row.job.id}
                    onRetry={() => handleRetry(row.job.id)}
                    onDiscard={(copy) => handleDiscard(row.job, copy)}
                  />
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.lg },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: spacing.xs },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: 15, fontWeight: '600' },
  section: { gap: spacing.xs },
  sectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, paddingHorizontal: spacing.xs },
  caption: { fontSize: 12, paddingHorizontal: spacing.xs, lineHeight: 17 },
  group: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    minHeight: minTouchTarget,
  },
  optionLabel: { fontSize: 15, fontWeight: '500' },
  lastSyncedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  jobRow: { padding: spacing.md, gap: 6 },
  jobRowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  jobDate: { fontSize: 13 },
  jobStatus: { fontSize: 13 },
  jobActions: { flexDirection: 'row', gap: spacing.sm, marginTop: 4 },
  jobButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  jobButtonText: { fontSize: 13, fontWeight: '600' },
});
