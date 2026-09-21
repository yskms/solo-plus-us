/**
 * UI/UX §18 Screen 08 — Health Connect. 基本設計 §9.6（再試行/破棄の operation
 * 別文言）・§10.4（未同期の変更の可視化）・§10.5（切断時の警告）・§9.12
 * （切断は `SyncCoordinator.runExclusive` 経由）を実装する。Android 専用
 * （`app/settings/index.tsx` が `Platform.OS === 'android'` でこの行自体を
 * 出し分けている——Health Connect は Android 専用機能、§9.11）。
 *
 * **§9.11/§25.1 レビュー指摘（2026-09-21）：without-health-connect ビルドでは
 * この画面自体を `Redirect` で閉じる。** `app/settings/index.tsx` が行を
 * 隠すだけでは、`soloplusus://settings/health-connect` の deep link で
 * 直接開けてしまい、permission が Manifest に無いビルドで
 * `healthConnect.enabled` を true にできてしまう（iOS は `Platform.OS`
 * のみで画面自体はガードしていないが、そちらは呼び出しが必ず throw する
 * Proxy で安全側に倒れる——このビルドフラグのケースはネイティブモジュールが
 * 生きたまま応答するため、同じ「index で隠すだけ」に頼れない）。default
 * export（`HealthConnectSettingsScreen`）は分岐して `Redirect` を返すか
 * 中身（`HealthConnectSettingsScreenInner`、以下の全 hooks）をマウントする
 * だけの薄いラッパーで、Inner 自身は無条件に呼ばれる限り hooks 呼び出し
 * 回数が常に一定——形式的にも Rules of Hooks 違反にならない（詳細は
 * `HealthConnectSettingsScreen` 自身の doc comment参照）。
 *
 * §10.6「全 Activity 削除」（`app/settings/delete-data.tsx`）の進行表示
 * 付きフローはここには無い——その画面の doc comment に記載の通り、意図的な
 * スコープ判断（README 参照）。この画面の切断時の警告が見るのは「未処理の
 * delete job」だけで、全削除フロー自体とは無関係——全削除が作った delete
 * ジョブも他のジョブと同じ形でこの画面の UNSYNCED CHANGES に現れ、同じ
 * retry/discard 導線で扱われる。
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
import { Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useTheme, spacing, minTouchTarget } from '../../constants/theme';
import { isHealthConnectBuildEnabled } from '../../lib/healthConnectBuild';
import { useDatabase } from '../../contexts/DatabaseContext';
import { useDataRevision } from '../../contexts/DataRevision';
import { getSetting, setSetting } from '../../services/SettingsRepository';
import * as HealthConnectService from '../../services/HealthConnectService';
import * as SyncCoordinator from '../../services/SyncCoordinator';
import * as HealthSyncJobRepository from '../../repositories/HealthSyncJobRepository';
import * as ActivityRepository from '../../repositories/ActivityRepository';
import * as HealthSyncManualActions from '../../services/HealthSyncManualActions';
import { queueResync, countPendingResync } from '../../services/HealthSyncResyncService';
import {
  describeJobAction,
  connectionStatus,
  connectionStatusLabel,
  retryBlockedCaption,
  type JobActionCopy,
} from '../../services/healthSyncJobPresentation';
import { ActivityBadge } from '../../components/ActivityBadge';
import { formatMonthDay } from '../../lib/relativeDate';
import { formatCalendarDateTime } from '../../lib/timeFormat';
import { parseStrictUtcIso, deriveLocalDateTime, resolveOffsetMinutesForZone, getDeviceTimeZoneId } from '../../lib/datetime';
import { logError } from '../../lib/log';
import type { HealthSyncJobRow } from '../../types/HealthSync';
import type { Activity, ActivityContext } from '../../types/Activity';
import type { TimeFormat } from '../../types/Settings';

/** §10.4/§9.6 の「現在処理中です」— claim 中のジョブに手動操作が競合した場合。 */
function showStillInProgressAlert(t: TFunction) {
  Alert.alert(t('settings.healthConnect.stillInProgressTitle'), t('settings.healthConnect.stillInProgressMessage'));
}

function localDateFromUtcIso(utcIso: string): string {
  const instant = parseStrictUtcIso(utcIso);
  const offset = resolveOffsetMinutesForZone(getDeviceTimeZoneId(), instant);
  return deriveLocalDateTime(instant, offset).localDate;
}

function formatLastSyncedAt(t: TFunction, utcIso: string, timeFormat: TimeFormat): string {
  const instant = parseStrictUtcIso(utcIso);
  const offset = resolveOffsetMinutesForZone(getDeviceTimeZoneId(), instant);
  const { localDate, localTime } = deriveLocalDateTime(instant, offset);
  const [year, month, day] = localDate.split('-').map(Number);
  return formatCalendarDateTime(t, year, month - 1, day, localTime, timeFormat);
}

interface UnsyncedRowData {
  job: HealthSyncJobRow;
  dateLabel: string;
  /** null → delete ジョブ、または Activity が既に無い内部不整合（バッジ無し）。 */
  context: ActivityContext | null;
}

/**
 * Takes a pre-fetched `activitiesById` map rather than querying per job —
 * §13.6's `queueResync` can leave hundreds/thousands of jobs
 * here at once, and this used to call `findActivityById` once per row
 * (N+1, re-run on every 5s poll tick). One `findAllActivities` call in
 * `load()` below replaces all of those round trips with a single query.
 */
function buildRow(t: TFunction, job: HealthSyncJobRow, activitiesById: ReadonlyMap<string, Activity>): UnsyncedRowData {
  const canHaveActivity = job.operation !== 'delete' && job.lastErrorCode !== 'LOCAL_ACTIVITY_NOT_FOUND';
  if (canHaveActivity) {
    const activity = activitiesById.get(job.activityId);
    if (activity) {
      return { job, dateLabel: formatMonthDay(t, activity.occurredLocalDate), context: activity.context };
    }
  }
  return { job, dateLabel: formatMonthDay(t, localDateFromUtcIso(job.createdAt)), context: null };
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
  const { t } = useTranslation();
  const copy = describeJobAction(t, row.job);
  const claimed = row.job.claimedAt !== null;
  const discardDisabled = claimed || busy;
  const retryDisabled = discardDisabled || !canRetry;

  return (
    <View style={styles.jobRow}>
      <View style={styles.jobRowHeader}>
        <Text style={[styles.jobDate, { color: colors.textSecondary }]}>{row.dateLabel}</Text>
        {row.context && <ActivityBadge context={row.context} />}
      </View>
      <Text style={[styles.jobStatus, { color: colors.textTertiary }]}>{claimed ? t('settings.healthConnect.job.syncing') : copy.statusText}</Text>
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

/**
 * without-health-connect ビルドでは deep link 等で開かれても中身
 * （`HealthConnectSettingsScreenInner`、以下の全 hooks を持つ）を
 * マウントせず `/settings` へ `Redirect` する。default export をこの薄い
 * ラッパーに分離しているのは、2回目のレビュー指摘（2026-09-21）——
 * `isHealthConnectBuildEnabled()` はビルド時定数なので条件分岐が hooks
 * より前にあっても実害は無いが、lint（未導入）や将来の React の静的解析が
 * 「hooks より前の早期 return」を額面通りに Rules of Hooks 違反として扱う
 * 可能性があり、正当性の説明がコメントだけに依存するのは脆い。コンポーネント
 * 分割なら Inner 自身は無条件に呼ばれる限り hooks 呼び出し回数は常に一定で、
 * 形式的にも違反にならない。
 */
export default function HealthConnectSettingsScreen() {
  if (!isHealthConnectBuildEnabled()) {
    return <Redirect href="/settings" />;
  }
  return <HealthConnectSettingsScreenInner />;
}

function HealthConnectSettingsScreenInner() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const db = useDatabase();
  const { revision, bump } = useDataRevision();

  const [loaded, setLoaded] = useState(false);
  // `null` = healthConnect.enabled をまだ読んでいない（false ではない——
  // 「未確定」と「確定して false だった」を型で区別する。render 側は
  // `loaded && enabled !== null` になるまで描画しない。レビューで、
  // 「未確定を false と同一視している」構図が `refreshConnectionHealth`
  // だけでなくこの state 自体にも残っている、と指摘され、対応した。
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [available, setAvailable] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const [timeFormat, setTimeFormat] = useState<TimeFormat>('24h');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [jobs, setJobs] = useState<UnsyncedRowData[]>([]);
  const [toggleAction, setToggleAction] = useState<'enable' | 'disable' | null>(null);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [resyncing, setResyncing] = useState(false);

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

  // `refreshConnectionHealth`（後述）は `enabled` を判定に使うが、それ自体を
  // 依存配列に入れて再生成すると、トグルのたびに `load`/ポーリング用
  // interval が丸ごと作り直されてしまう（レビュー指摘の前は無かった問題
  // だが、この ref は元々その再生成を避けるためのもの）。`enabled` state
  // と同じ `boolean | null`（`null` = まだ確定していない）。
  //
  // **`enabled` state から自動ミラーしない——書き手（`load()` の初回読み
  // 込み成功時・`handleEnable`・`disconnect`）がそれぞれ明示的に更新する。**
  // 以前は `useEffect(() => { enabledRef.current = enabled }, [enabled])`
  // で自動同期していたが、これが `load()` の読み込み失敗パスの意図
  // （`enabledRef.current` は `null` のまま残し、この回の描画だけ `false`
  // を見せて次回リトライする、下記コメント参照）を壊していた——
  // `setEnabled(false)` 自体が `enabled` state を変えるため、この mirror
  // effect が直後に `enabledRef.current` を `false` で上書きしてしまい、
  // 「失敗時は null のまま残す」が実質的に効かず、dd46833 以前と同じ
  // ラッチが再発する（実機では state 変更→effect の順序に依存するため
  // 踏まず、レビューで指摘された）。読み込み失敗パスだけ意図的に
  // `enabledRef` を更新しない、という非対称性を保つには、更新箇所を
  // 明示的に管理するしかない。
  const enabledRef = useRef<boolean | null>(null);

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
   * `enabled === false`（確定して OFF）の間だけ早期 return する——
   * `enabled === null`（まだ読めていない）は素通りさせる。`connectionStatus`
   * は `!enabled` を最優先で `not-connected` に倒すため、確定して OFF なら
   * `available`/`hasPermission` は表示に一切影響しない（`handleEnable` は
   * 自前で `isAvailable()` を呼び直す）。ここを無条件に素通りさせると、
   * 同期 OFF の間も5秒ごとに isAvailable→ensureInitialized→
   * getGrantedPermissions という無意味なネイティブ往復（＝OFF なのに HC
   * クライアントを定期的に初期化する）が走り続ける（レビュー指摘）一方、
   * 「まだ読めていない」を「確定して false」と同一視してここで早期 return
   * すると、enabled=true・同期成功済みでも一時的に "Health Connect isn't
   * installed" と表示される（実機で再現・レビューで指摘）。
   */
  const refreshConnectionHealth = useCallback(async () => {
    if (enabledRef.current === false) {
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
        // healthConnect.enabled は、この画面自身の handleEnable/disconnect
        // 以外のどこからも書き換えられない（DB の唯一のライターがこの
        // 画面）ため、初回の load() でだけ読む——`enabledRef.current` が
        // `null`（まだ読んでいない）の間だけ実行し、以後は読み直さない。
        // 毎回読み直すと、権限ダイアログ表示中や runExclusive 待ちの
        // 最中に先行ポーリングの古い読み取り結果が後着して enabled を
        // 一瞬巻き戻す競合が起きる（レビュー指摘：表示専用の値と
        // ユーザー操作の対象を同じ経路で更新していたのが原因）。
        //
        // 同じ DB 読み取りブロックの中に置くことで、下の `setLoaded(true)`
        // が呼ばれる時点では enabled は必ず確定済み（`null` ではない）に
        // なる——以前は別の effect に分けていたため、`load()` 側が先に
        // `refreshConnectionHealth()` に到達すると enabled 確定前に接続
        // チェックが走ってしまう窓があった（実機で再現・レビューで指摘）。
        // 別 effect だと「マウント時に2回ネイティブ往復する」二重発火も
        // 起きていた——1つの effect（この `load()`）に統合したことで
        // どちらも解消する。
        if (enabledRef.current === null) {
          try {
            const value = await getSetting(db, 'healthConnect.enabled');
            enabledRef.current = value;
            if (mountedRef.current) setEnabled(value);
          } catch (error) {
            // この読み取り自体が失敗しても、画面を永久に "Loading…" の
            // まま固めない——この回の描画だけ `false`（安全側）を見せるが、
            // `enabledRef.current` は `null` のまま残す。ここで `false` に
            // 確定させてしまうと、一過性の DB エラーでもこの画面を開いて
            // いる間ずっと "Not connected" にラッチする（実際の
            // healthConnect.enabled が true でも）——次の load()（5秒
            // ポーリングまたは revision 起因）がまた `null` を見て読み直す
            // ので、数回分の無駄な再試行と引き換えに自己回復する
            // （レビュー指摘）。
            logError('Loading healthConnect.enabled failed', error);
            if (mountedRef.current) setEnabled(false);
          }
        }
        const [lastSyncedValue, timeFormatValue, jobRows] = await Promise.all([
          getSetting(db, 'healthConnect.lastSyncedAt'),
          getSetting(db, 'preferences.timeFormat'),
          HealthSyncJobRepository.findAllJobsForProvider(db, 'health_connect'),
        ]);
        // One bulk read instead of one findActivityById per job (N+1) —
        // §13.6's queueResync can leave hundreds/thousands of
        // jobs here at once, re-read on every 5s poll tick (buildRow doc
        // comment above).
        const activitiesById =
          jobRows.length > 0
            ? new Map((await ActivityRepository.findAllActivities(db)).map((activity) => [activity.id, activity]))
            : new Map<string, Activity>();
        const rows = jobRows.map((job) => buildRow(t, job, activitiesById));
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
    // `t` in deps: `buildRow` bakes a translated `dateLabel` into
    // `UnsyncedRowData` state (see its doc comment on avoiding an N+1
    // `findActivityById` per row) rather than re-deriving it at render
    // time, so a language switch has to re-run this to pick up the new
    // language — otherwise the unsynced-jobs list would stay in whatever
    // language was active when it last loaded. This does mean a language
    // switch triggers a DB re-query + full `findAllActivities` map build
    // on top of this screen's existing 5s poll (reviewed, accepted:
    // language switches are rare, user-initiated, and the poll already
    // pays this same cost every 5s regardless).
  }, [db, refreshConnectionHealth, t]);

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
        showStillInProgressAlert(t); // D-39: claim 中に競合した
        return;
      }
      bump(); // SyncWorkerLoop.tsx: 手動再試行直後に drain の機会を作る
    } catch (error) {
      logError('Health Connect manual retry failed', error);
      Alert.alert(t('settings.healthConnect.couldNotRetry'), t('common.pleaseTryAgain'));
    } finally {
      if (mountedRef.current) setPendingJobId(null);
    }
  };

  const performDiscard = async (jobId: string) => {
    setPendingJobId(jobId);
    try {
      const result = await HealthSyncManualActions.discardSyncJob(db, jobId);
      if (result === 'not-found-or-claimed') {
        showStillInProgressAlert(t); // D-39: claim 中に競合した
        return;
      }
      bump();
    } catch (error) {
      logError('Health Connect discard failed', error);
      Alert.alert(t('settings.healthConnect.couldNotComplete'), t('common.pleaseTryAgain'));
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
      { text: t('common.cancel'), style: 'cancel' },
      { text: copy.discardLabel, style: 'destructive', onPress: () => performDiscard(job.id) },
    ]);
  };

  const handleEnable = async () => {
    setToggleAction('enable');
    try {
      const isAvailable = await HealthConnectService.isAvailable();
      if (!isAvailable) {
        Alert.alert(t('settings.healthConnect.notInstalledTitle'), t('settings.healthConnect.notInstalledMessage'));
        return;
      }
      await HealthConnectService.ensureInitialized();
      const granted = await HealthConnectService.requestWritePermission();
      if (!granted) {
        Alert.alert(t('settings.healthConnect.permissionNeededTitle'), t('settings.healthConnect.permissionNeededMessage'));
        return;
      }
      await setSetting(db, 'healthConnect.enabled', true);
      enabledRef.current = true;
      if (mountedRef.current) {
        setEnabled(true);
        setAvailable(true);
        setHasPermission(true);
      }
      bump(); // §10.5: 再接続で、残っている delete ジョブの再開を早める
    } catch (error) {
      logError('Enabling Health Connect failed', error);
      Alert.alert(t('settings.healthConnect.couldNotConnect'), t('common.pleaseTryAgain'));
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
      enabledRef.current = false;
      if (mountedRef.current) setEnabled(false); // §10.5: ジョブ自体は破棄しない——ここでは enabled のみ変更
    } catch (error) {
      logError('Disconnecting Health Connect failed', error);
      Alert.alert(t('settings.healthConnect.couldNotDisconnect'), t('common.pleaseTryAgain'));
    } finally {
      if (mountedRef.current) setToggleAction(null);
    }
  };

  const pendingDeleteCount = jobs.filter((row) => row.job.operation === 'delete').length;

  const handleDisable = () => {
    if (pendingDeleteCount > 0) {
      // §10.5: 未処理の delete job が残っている場合は必ず警告する。
      Alert.alert(
        t('settings.healthConnect.unsyncedDeletionsTitle', { count: pendingDeleteCount }),
        t('settings.healthConnect.unsyncedDeletionsMessage'),
        [
          { text: t('settings.healthConnect.handleFirst'), style: 'cancel' },
          { text: t('settings.healthConnect.disconnectAnyway'), style: 'destructive', onPress: disconnect },
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

  /**
   * §13.6 のもう一つの入口（`services/HealthSyncResyncService.ts` の doc
   * comment 参照）。`offerResync`（Import 直後の一度きりの同意画面）を
   * 逃した／その後に再同期したくなった場合の恒久的な救済導線として追加
   * した——復元後は `health_sync` が空になり、以後の編集も `planForEdit`
   * が noop を返し続ける（D-51）ため、この導線が無いと二度と再同期できない
   * 状態に固定されてしまう（レビュー指摘）。この導線は §13.6 が本来想定する
   * 「復元後の再同期」を超えて使える（例：HC を初めて ON にした直後に押せば
   * 過去の全履歴を一括送信できる）——`HealthSyncResyncService.ts` の doc
   * comment 参照。センシティブなデータを外部へまとめて送る操作のため、
   * 送信前に必ず対象件数を確認ダイアログへ出す（下記 `handleResyncEverything`）。
   */
  const performResyncEverything = async () => {
    setResyncing(true);
    try {
      const result = await queueResync(db);
      // Nudge SyncWorkerLoop's existing DataRevision trigger, same reasoning
      // as handleRetry above — queued jobs get a chance to drain without
      // waiting for the 10s periodic tick.
      bump();
      if (result.queuedCount === 0) {
        // Only reachable if something else (another job, another mapping)
        // changed between handleResyncEverything's count and this call.
        Alert.alert(t('settings.healthConnect.nothingToSyncTitle'), t('settings.healthConnect.nothingToSyncMessage'));
      } else {
        Alert.alert(
          t('settings.healthConnect.syncQueuedTitle'),
          t('settings.healthConnect.syncQueuedMessage', { count: result.queuedCount }),
        );
      }
    } catch (error) {
      logError('queueResync (manual re-sync from Settings) failed', error);
      Alert.alert(t('settings.healthConnect.couldNotQueueSync'), t('common.pleaseTryAgain'));
    } finally {
      if (mountedRef.current) setResyncing(false);
    }
  };

  /**
   * §13.1「既定 OFF・明示同意制」を、恒久的なボタンでも満たすには「押せば
   * 何が起きるか」を事前に伝える必要がある——特にこの入口は復元直後に限らず
   * いつでも押せるため、対象が数年分の全履歴になりうる（レビュー指摘）。
   * `countPendingResync` で実際に送信される件数を数えてから確認ダイアログに
   * 出す。
   */
  const handleResyncEverything = async () => {
    let pendingCount: number;
    try {
      pendingCount = await countPendingResync(db);
    } catch (error) {
      logError('countPendingResync failed', error);
      Alert.alert(t('settings.healthConnect.couldNotCheckSyncStatus'), t('common.pleaseTryAgain'));
      return;
    }
    if (pendingCount === 0) {
      Alert.alert(t('settings.healthConnect.nothingToSyncTitle'), t('settings.healthConnect.nothingToSyncMessage'));
      return;
    }
    Alert.alert(
      t('settings.healthConnect.resyncConfirmTitle', { count: pendingCount }),
      t('settings.healthConnect.resyncConfirmMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('settings.healthConnect.sync'), onPress: performResyncEverything },
      ],
    );
  };

  // `enabled === null` は構造的には `loaded` と同時に解消するはず（`load()`
  // が enabled を読んでから `setLoaded(true)` する、上記コメント参照）だが、
  // それを暗黙の実行順序だけに頼らず、ここで明示的に型として確認する——
  // 「まだ読めていない」を「確定して false」と同一視しない、という今回の
  // 修正の趣旨を、この画面のどこか1箇所の実行順序が崩れても壊れない形で
  // 保つ（レビュー指摘）。これ以降 `enabled` は `boolean` に narrow される。
  if (!loaded || enabled === null) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.textSecondary, padding: spacing.md }}>{t('common.loading')}</Text>
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
          <Text style={[styles.statusText, { color: colors.textPrimary }]}>{connectionStatusLabel(t, status)}</Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('settings.healthConnect.syncToggleSectionLabel')}</Text>
          <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.toggleRow}>
              <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>{t('settings.healthConnect.syncToggleLabel')}</Text>
              <Switch value={enabled} onValueChange={handleToggle} disabled={toggleAction !== null} />
            </View>
          </View>
          {toggleAction !== null && (
            <View style={styles.busyRow}>
              <ActivityIndicator color={colors.textSecondary} />
              <Text style={[styles.caption, { color: colors.textSecondary }]}>
                {toggleAction === 'enable' ? t('settings.healthConnect.connecting') : t('settings.healthConnect.disconnecting')}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('settings.healthConnect.aboutSectionLabel')}</Text>
          <Text style={[styles.caption, { color: colors.textTertiary }]}>{t('settings.healthConnect.aboutWhatIsSynced')}</Text>
          <Text style={[styles.caption, { color: colors.textTertiary }]}>{t('settings.healthConnect.aboutWhatStaysLocal')}</Text>
        </View>

        <View style={styles.section}>
          <View style={styles.lastSyncedRow}>
            <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>{t('settings.healthConnect.lastSynced')}</Text>
            <Text style={[styles.caption, { color: colors.textTertiary }]}>
              {lastSyncedAt ? formatLastSyncedAt(t, lastSyncedAt, timeFormat) : t('settings.healthConnect.never')}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{t('settings.healthConnect.resyncSectionLabel')}</Text>
          <Text style={[styles.caption, { color: colors.textTertiary }]}>{t('settings.healthConnect.resyncExplanation')}</Text>
          {!enabled && (
            <Text style={[styles.caption, { color: colors.textTertiary }]}>{t('settings.healthConnect.resyncNeedsSyncOn')}</Text>
          )}
          <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Pressable
              onPress={handleResyncEverything}
              disabled={!enabled || resyncing}
              style={[styles.optionRow, { opacity: !enabled || resyncing ? 0.4 : 1 }]}
              accessibilityRole="button"
            >
              <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>{t('settings.healthConnect.resyncButton')}</Text>
            </Pressable>
          </View>
          {resyncing && (
            <View style={styles.busyRow}>
              <ActivityIndicator color={colors.textSecondary} />
              <Text style={[styles.caption, { color: colors.textSecondary }]}>{t('settings.healthConnect.queuing')}</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
            {jobs.length > 0
              ? t('settings.healthConnect.unsyncedChangesSectionLabelWithCount', { count: jobs.length })
              : t('settings.healthConnect.unsyncedChangesSectionLabel')}
          </Text>
          {jobs.length === 0 ? (
            <Text style={[styles.caption, { color: colors.textTertiary }]}>{t('settings.healthConnect.everythingSynced')}</Text>
          ) : (
            <>
              {!canRetry && (
                <Text style={[styles.caption, { color: colors.textTertiary }]}>{retryBlockedCaption(t, status)}</Text>
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
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    minHeight: minTouchTarget,
    paddingVertical: spacing.sm,
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
