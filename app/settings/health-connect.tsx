/**
 * UI/UX §18 Screen 08 — Health Connect. 基本設計 §9.6（再試行/破棄の operation
 * 別文言）・§10.4（未同期の変更の可視化）・§10.5（切断時の警告）・§9.12
 * （切断は `SyncCoordinator.runExclusive` 経由）を実装する。Android 専用
 * （`app/settings/index.tsx` が `Platform.OS === 'android'` でこの行自体を
 * 出し分けている——Health Connect は Android 専用機能、§9.11）。
 *
 * §10.6「全 Activity 削除」の進行表示付きフローはここには無い——
 * `app/settings/data.tsx`/`index.tsx` の doc comment ですでに明示的に
 * 対象外とされている（README 参照）。切断時の警告が見るのは「未処理の
 * delete job」だけで、全削除フローとは無関係。
 *
 * ## モックからの意図的な逸脱
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
 * 3. §10.5「未処理が残っている間は Settings に件数を表示し続ける」は、
 *    この画面の中（Unsynced changes の件数見出し）でのみ満たす——
 *    `app/settings/index.tsx` の Settings トップの行にはバッジを出さない。
 *    そのファイルは現状 DB に一切アクセスしない静的な一覧で、バッジ表示
 *    はそこに初めて DB アクセスを持ち込むことになるため、この画面自身の
 *    見出しで十分と判断した（レビューで指摘、doc comment に明記する形で
 *    解決——この画面の他の逸脱の扱いと揃える）。
 *
 * DB アクセスは `useDatabase()` から直接——このトグルは他画面と共有する
 * 必要が無く、`ScreenshotBlock.tsx` のような専用 Context は不要（SyncWorker
 * 側は毎回 DB から設定を読み直すため、JS 側にキャッシュを持つ理由が無い）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
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
import {
  describeJobAction,
  connectionStatus,
  CONNECTION_STATUS_LABEL,
  RETRY_BLOCKED_CAPTION,
  type JobActionCopy,
} from '../../services/healthSyncJobPresentation';
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
  /** null → delete ジョブ、または Activity が既に無い内部不整合（バッジ無し）。 */
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
  canRetry,
  busy,
  onRetry,
  onDiscard,
}: {
  row: UnsyncedRowData;
  /**
   * `connectionStatus(...) === 'connected'` — `drainDueJobs` の §9.5 step0は
   * provider が無効/未初期化なら即 return するだけ、権限が無い状態でも
   * 呼べば PERMISSION_DENIED を消費するだけの失敗が確定しているため、
   * `connected` 以外は Retry now を押せないようにする（レビュー指摘：
   * `enabled` だけでは unavailable/permission-revoked を見逃していた）。
   */
  canRetry: boolean;
  busy: boolean;
  onRetry: () => void;
  onDiscard: (copy: JobActionCopy) => void;
}) {
  const { colors } = useTheme();
  const copy = describeJobAction(row.job);
  const claimed = row.job.claimedAt !== null;
  const discardDisabled = claimed || busy;
  const retryDisabled = discardDisabled || !canRetry;

  return (
    <View style={styles.jobRow}>
      <View style={styles.jobRowHeader}>
        <Text style={[styles.jobDate, { color: colors.textSecondary }]}>{row.dateLabel}</Text>
        {row.context && <ActivityBadge context={row.context} />}
      </View>
      <Text style={[styles.jobStatus, { color: colors.textTertiary }]}>{claimed ? 'Syncing…' : copy.statusText}</Text>
      <View style={styles.jobActions}>
        {copy.retryLabel !== null && (
          <Pressable
            onPress={onRetry}
            disabled={retryDisabled}
            style={[styles.jobButton, { borderColor: colors.border, opacity: retryDisabled ? 0.4 : 1 }]}
            accessibilityRole="button"
          >
            <Text style={[styles.jobButtonText, { color: colors.textPrimary }]}>{copy.retryLabel}</Text>
          </Pressable>
        )}
        <Pressable
          onPress={() => onDiscard(copy)}
          disabled={discardDisabled}
          style={[styles.jobButton, { borderColor: colors.border, opacity: discardDisabled ? 0.4 : 1 }]}
          accessibilityRole="button"
        >
          <Text style={[styles.jobButtonText, { color: colors.destructive }]}>{copy.discardLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const POLL_INTERVAL_MS = 5000;

export default function HealthConnectSettingsScreen() {
  const { colors } = useTheme();
  const db = useDatabase();
  const { revision, bump } = useDataRevision();

  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [available, setAvailable] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const [timeFormat, setTimeFormat] = useState<TimeFormat>('24h');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [jobs, setJobs] = useState<UnsyncedRowData[]>([]);
  const [toggleAction, setToggleAction] = useState<'enable' | 'disable' | null>(null);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    // `true` is set here, in the effect body, not just via `useRef(true)`'s
    // initial value — if this component were ever remounted with the same
    // ref surviving (e.g. React StrictMode's dev-only mount→unmount→remount
    // double-invoke), the cleanup below would have already set it `false`
    // with nothing to set it back `true` again, permanently wedging every
    // subsequent `if (mountedRef.current)` guard closed (レビュー指摘 — this
    // app doesn't enable StrictMode today, but the fix is free).
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // healthConnect.enabled は、この画面自身の handleEnable/disconnect
  // 以外のどこからも書き換えられない（DB の唯一のライターがこの画面）ため、
  // 起動時に一度だけ読めば十分——以下の `load`（表示専用の値の定期更新）
  // では触らない。これを load の中で毎回読み直すと、権限ダイアログ表示中や
  // runExclusive 待ちの最中に先行ポーリングの古い読み取り結果が後着して
  // enabled を一瞬巻き戻す競合が起きる（レビュー指摘：表示専用の値と
  // ユーザー操作の対象を同じ経路で更新していたのが原因）。
  useEffect(() => {
    (async () => {
      try {
        const value = await getSetting(db, 'healthConnect.enabled');
        if (mountedRef.current) setEnabled(value);
      } catch (error) {
        logError('Loading healthConnect.enabled failed', error);
      }
    })();
  }, [db]);

  // `refreshConnectionHealth`（後述）は `enabled` を判定に使うが、それ自体を
  // 依存配列に入れて再生成すると、トグルのたびに `load`/ポーリング用
  // interval が丸ごと作り直されてしまう（レビュー指摘の前は無かった問題
  // だが、この ref は元々その再生成を避けるためのもの）。ref を経由して
  // 最新値だけを読む。
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  /**
   * 可用性チェックと権限チェックを別の失敗ドメインとして扱う（両方とも
   * `available`/`hasPermission` を一括で倒すと壊れる、レビューで再指摘）。
   *
   * `hasWritePermission()`（`getGrantedPermissions`）はネイティブ側で
   * `initialize()` 未実行だと `ClientNotInitialized` で reject する
   * （`HealthConnectManager.kt` の `throwUnlessClientIsAvailable`）。
   * `initialize()` を呼ぶ経路は `drainDueJobs`（`healthConnect.enabled`
   * が true のときだけ）と `handleEnable` の2つしか無いため、`enabled`
   * が false のままこの画面を開くと毎回 reject して `logError` が
   * ポーリングのたびに積み上がり、`enabled` が true でもアプリ起動直後
   * （`SyncWorkerLoop` の最初の drain がまだ `ensureInitialized()` に
   * 到達する前）にこの画面を開くと一時的に reject しうる。ここで自前に
   * `ensureInitialized()` を呼んでから権限チェックする——`drainDueJobs`
   * 自身も毎回（周期実行のたびに）呼んでいる同じ操作なので、繰り返し
   * 呼ぶこと自体はこのコードベースで既に許容されているパターン。
   *
   * それでも権限チェックだけが失敗した場合（Binder 切断等の一時的な
   * 失敗を含む）、`available` は「isAvailable() 自体は成功した」という
   * 直前の結果のまま変えない——ここを一緒に倒すと、せっかく4値にした
   * ステータスが「権限チェックがたまたま失敗しただけ」で
   * unavailable（未インストール）という誤った表示に倒れる
   * （レビューで実際に再現指摘）。
   *
   * `enabled=false` の間は早期 return する——`connectionStatus` が
   * `!enabled` を最優先で `not-connected` に倒すため、`available`/
   * `hasPermission` は表示に一切影響しない（`handleEnable` は自前で
   * `isAvailable()` を呼び直す）。ここを素通りさせると、同期 OFF の間も
   * 5秒ごとに isAvailable→ensureInitialized→getGrantedPermissions という
   * 無意味なネイティブ往復（＝OFF なのに HC クライアントを定期的に
   * 初期化する）が走り続ける（レビュー指摘）。
   */
  const refreshConnectionHealth = useCallback(async () => {
    if (!enabledRef.current) {
      if (mountedRef.current) {
        setAvailable(false);
        setHasPermission(false);
      }
      return;
    }
    let isAvailable = false;
    try {
      isAvailable = await HealthConnectService.isAvailable();
      if (mountedRef.current) setAvailable(isAvailable);
    } catch (error) {
      logError('Checking Health Connect availability failed', error);
      if (mountedRef.current) {
        setAvailable(false);
        setHasPermission(false);
      }
      return;
    }
    if (!isAvailable) {
      if (mountedRef.current) setHasPermission(false);
      return;
    }
    try {
      await HealthConnectService.ensureInitialized();
      const permitted = await HealthConnectService.hasWritePermission();
      if (mountedRef.current) setHasPermission(permitted);
    } catch (error) {
      logError('Checking Health Connect permission failed', error);
      if (mountedRef.current) setHasPermission(false); // `available` はここでは変更しない（上記コメント参照）
    }
  }, []);

  const loadingRef = useRef(false);
  const rerunRequestedRef = useRef(false);

  const load = useCallback(async () => {
    // SyncWorkerLoop.tsx の drainingRef/rerunRequestedRef と同じ「実行中なら
    // 完了後にもう一度」の形——単純に skip するだけだと、bump() 起因の
    // 再読込がポーリングと重なったときに取りこぼされる（レビュー指摘）。
    if (loadingRef.current) {
      rerunRequestedRef.current = true;
      return;
    }
    loadingRef.current = true;
    try {
      // DB 読み取りと、ネイティブの可用性/権限チェックは別の失敗ドメイン
      // として扱う——同じ Promise.all に入れて一方の reject で全体を
      // 「何も無い」状態に倒すと、iOS では isAvailable() が常時 throw する
      // （react-native-health-connect の index.js が iOS 向けに「呼ぶと
      // 必ず throw する Proxy」を返す実装のため）ので毎回この画面全体が
      // 空に見えてしまう（レビュー指摘、最重要）。SyncWorker.ts の
      // drainDueJobs が ensureInitialized() の reject を個別に
      // try/catch している（provider-unavailable として扱う）のと同じ
      // 分離をここでも行う。
      try {
        const [lastSyncedValue, timeFormatValue, jobRows] = await Promise.all([
          getSetting(db, 'healthConnect.lastSyncedAt'),
          getSetting(db, 'preferences.timeFormat'),
          HealthSyncJobRepository.findAllJobsForProvider(db, 'health_connect'),
        ]);
        const rows = await Promise.all(jobRows.map((job) => buildRow(db, job)));
        if (mountedRef.current) {
          setLastSyncedAt(lastSyncedValue);
          setTimeFormat(timeFormatValue);
          setJobs(rows);
        }
      } catch (error) {
        logError('Loading Health Connect settings (DB) failed', error);
      }

      // DB の内容（未同期ジョブ一覧・Last synced）が state に入った時点で
      // 「読み込み中」画面は終える——`refreshConnectionHealth` の完了は
      // 待たない。isAvailable()/ensureInitialized()/hasWritePermission() は
      // D-41 と同じ「cancel もタイムアウトも実装しない」設計の native
      // module 呼び出しで、settle しなければここで永久に await し続ける
      // ことになりうる（`services/HealthConnectService.ts` の doc comment
      // 参照）。ここで待ってしまうと画面全体が "Loading…" のまま固まり、
      // `loadingRef` も解放されずポーリングも止まる（レビュー指摘）。
      // 接続ステータスは後から埋まる progressive enhancement として扱う
      // ——初期値は `available`/`hasPermission` とも `false`
      // （`connectionStatus` は「確認できるまでは Connected と表示しない」
      // 安全側の既定値）。
      if (mountedRef.current) setLoaded(true);

      await refreshConnectionHealth();
    } finally {
      loadingRef.current = false;
      if (rerunRequestedRef.current) {
        rerunRequestedRef.current = false;
        load();
      }
    }
  }, [db, refreshConnectionHealth]);

  useEffect(() => {
    load();
  }, [load, revision]);

  // バックグラウンドの周期 drain（SyncWorkerLoop.tsx の10秒 interval）は
  // DataRevision を bump しないため、この画面を開いたままだと claim 中の
  // 行が完了後も「Syncing…」のまま古びて見える。この画面がフォアグラウンド
  // でマウントされている間だけ読み取り専用でジョブ一覧を再取得する——
  // drainDueJobs は一切呼ばないので、CLAUDE.md が禁じる「新しい drain
  // トリガ」には当たらない。アプリがバックグラウンドの間はタイマーを止める
  // （レビュー指摘：止めないと N+1 の findActivityById が無意味に回り続ける）。
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (interval === null) interval = setInterval(load, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    };
    if (AppState.currentState !== 'background' && AppState.currentState !== 'inactive') {
      start();
    }
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background' || next === 'inactive') {
        stop();
      } else {
        load(); // フォアグラウンド復帰時は5秒待たずに即座に最新化する
        start();
      }
    });
    return () => {
      stop();
      subscription.remove();
    };
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
      if (mountedRef.current) setPendingJobId(null);
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
      if (mountedRef.current) setPendingJobId(null);
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
    setToggleAction('enable');
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
      if (mountedRef.current) {
        setEnabled(true);
        setAvailable(true);
        setHasPermission(true);
      }
      bump(); // §10.5: 再接続で、残っている delete ジョブの再開を早める
    } catch (error) {
      logError('Enabling Health Connect failed', error);
      Alert.alert('Could not connect', 'Please try again.');
    } finally {
      if (mountedRef.current) setToggleAction(null);
    }
  };

  const disconnect = async () => {
    setToggleAction('disable');
    try {
      // §9.12/CLAUDE.md: HC切断は必ず SyncCoordinator.runExclusive 経由。
      // 渡すコールバックは setSetting 一発のみ——内側から drain 相当の
      // 処理を呼ばない（runExclusive のネスト禁止、CLAUDE.md 参照）。
      await SyncCoordinator.runExclusive(() => setSetting(db, 'healthConnect.enabled', false));
      if (mountedRef.current) setEnabled(false); // §10.5: ジョブ自体は破棄しない——ここでは enabled のみ変更
    } catch (error) {
      logError('Disconnecting Health Connect failed', error);
      Alert.alert('Could not disconnect', 'Please try again.');
    } finally {
      if (mountedRef.current) setToggleAction(null);
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

  const status = connectionStatus(enabled, available, hasPermission);
  const statusDotColor = status === 'connected' ? colors.solo : status === 'permission-revoked' ? colors.destructive : colors.textTertiary;
  // §9.6 step0: drainDueJobs は provider が無効/未初期化なら即 return するだけ
  // なので、その3状態（not-connected/unavailable/permission-revoked）では
  // Retry now を押しても何も起きない（レビュー指摘：!enabled だけでは
  // unavailable/permission-revoked を見逃していた）。
  const canRetry = status === 'connected';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: statusDotColor }]} />
          <Text style={[styles.statusText, { color: colors.textPrimary }]}>{CONNECTION_STATUS_LABEL[status]}</Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>SYNC TO HEALTH CONNECT</Text>
          <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.toggleRow}>
              <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>Sync to Health Connect</Text>
              <Switch value={enabled} onValueChange={handleToggle} disabled={toggleAction !== null} />
            </View>
          </View>
          {toggleAction !== null && (
            <View style={styles.busyRow}>
              <ActivityIndicator color={colors.textSecondary} />
              <Text style={[styles.caption, { color: colors.textSecondary }]}>
                {toggleAction === 'enable' ? 'Connecting…' : 'Disconnecting… this can take a moment if a sync is in progress.'}
              </Text>
            </View>
          )}
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
            <>
              {!canRetry && (
                <Text style={[styles.caption, { color: colors.textTertiary }]}>{RETRY_BLOCKED_CAPTION[status]}</Text>
              )}
              <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {jobs.map((row, index) => (
                  <View
                    key={row.job.id}
                    style={index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border } : undefined}
                  >
                    <UnsyncedRow
                      row={row}
                      canRetry={canRetry}
                      busy={pendingJobId === row.job.id}
                      onRetry={() => handleRetry(row.job.id)}
                      onDiscard={(copy) => handleDiscard(row.job, copy)}
                    />
                  </View>
                ))}
              </View>
            </>
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
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xs },
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
