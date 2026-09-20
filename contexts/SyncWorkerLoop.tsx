/**
 * 基本設計 v0.11 §9.5.4 — 「いつ `services/SyncWorker.drainDueJobs` を
 * 呼ぶか」の配線。`SyncWorker`/`SyncCoordinator` 自体は「いつ呼ぶか」を
 * 知らない（両ファイルの doc comment 参照）——ここがその配線を担う。
 * `lib/screenMask.ts` の `useScreenMask`（純粋な `handleAppStateChangeFor
 * Reapply` + AppState 配線の分離）と同じ構造。
 *
 * ## AppState 表（§9.5.4）
 * | AppState | 動作 |
 * |---|---|
 * | `active` | ワーカーを開始・再開する |
 * | `inactive`/`background` | 新しい claim を停止する。実行中の外部呼び出しは確定処理まで進める |
 * | 次の `active` | due なジョブから再開する |
 *
 * `mountedActiveRef` が「継続してよいか」（`drainDueJobs` の
 * `shouldContinue`）を表す唯一の状態。**すでに claim して trackSyncCycle
 * に入ったジョブは、これが false になっても強制中断しない**——
 * `drainDueJobs`/`SyncCoordinator` 側の設計通り、次の `processNextDueJob`
 * 呼び出しの前にしか確認しない（ネイティブ呼び出しを取り消す手段が無いのは
 * SyncCoordinator と同じ理由、D-41）。
 *
 * ## 周期的な再チェック
 * §9.5.4 は「フォアグラウンド中に `not_before` が経過したジョブをいつ
 * 拾うか」を規定していない（README「Phase 4」の Known gaps で指摘済みの
 * 未決事項だった）。5秒の Undo 遅延（D-44）や §9.6 のバックオフが経過した
 * 直後を大きく待たせないよう、10秒間隔の周期実行で補う——正確な間隔を
 * 要求する仕様上の根拠は無く、調整可能な値として扱ってよい。
 *
 * ## SyncCoordinator との関係
 * このファイルは `SyncCoordinator.runExclusive` を**呼ばない**——
 * `drainDueJobs` が内部で `isSuspended()` を確認するだけで十分（新しい
 * claim が自然に止まる）。将来 Settings UI の「Health Connect を切断」
 * ハンドラ等から、このファイルの `drain` 相当の処理を `runExclusive` の
 * **内側**から呼ばないこと——`SyncCoordinator.ts` の「直列化」節の通り、
 * 同一呼び出しスタック内でのネストはデッドロックする。
 */
import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useDatabase } from './DatabaseContext';
import { useDataRevision } from './DataRevision';
import { drainDueJobs } from '../services/SyncWorker';
import { logError } from '../lib/log';

const PERIODIC_DRAIN_INTERVAL_MS = 10_000;

/**
 * `active` への遷移（かつ直前は `active` ではなかった）でだけ true。
 * `lib/screenMask.ts`の `handleAppStateChangeForReapply` と同じく、
 * `useSyncWorkerLoop` の effect ライフサイクル全体を駆動せずに単体で
 * テストできるよう切り出している。
 */
export function shouldTriggerDrainOnAppStateChange(previous: AppStateStatus, next: AppStateStatus): boolean {
  return next === 'active' && previous !== 'active';
}

export function useSyncWorkerLoop(): void {
  const db = useDatabase();
  const { revision } = useDataRevision();
  const mountedActiveRef = useRef(AppState.currentState === 'active');

  const drain = useCallback(() => {
    if (!mountedActiveRef.current) return;
    drainDueJobs(db, 'health_connect', { shouldContinue: () => mountedActiveRef.current }).catch((error) =>
      logError('useSyncWorkerLoop: drainDueJobs failed', error),
    );
  }, [db]);

  useEffect(() => {
    mountedActiveRef.current = AppState.currentState === 'active';
    let previousStatus = AppState.currentState;
    drain(); // §9.5.4「次の active で再開する」— マウント時点で active ならここが最初の「再開」

    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      const previous = previousStatus;
      previousStatus = next;
      mountedActiveRef.current = next === 'active';
      if (shouldTriggerDrainOnAppStateChange(previous, next)) drain();
      // inactive/background: mountedActiveRef を false にするだけ。新規
      // claim は shouldContinue で止まり、実行中の呼び出しは確定処理まで
      // 進む（§9.5.4、ファイル冒頭コメント参照）。
    });

    const interval = setInterval(drain, PERIODIC_DRAIN_INTERVAL_MS);

    return () => {
      mountedActiveRef.current = false;
      subscription.remove();
      clearInterval(interval);
    };
  }, [drain]);

  // §9.8 でジョブが積まれた直後（例：記録・編集・削除）や、手動再試行/破棄
  // 直後に、機会があれば drain を試みる。5秒の Undo 遅延分はまだ due に
  // ならないため即座には拾えない——上の周期実行が拾う。
  //
  // 初回マウント時はスキップする——上の effect が既にマウント時の drain を
  // 行っており、React の effect はどちらも初回マウントで走るため、
  // スキップしないと同じタイミングで無駄に2回 drain することになる。
  const isInitialRevisionRenderRef = useRef(true);
  useEffect(() => {
    if (isInitialRevisionRenderRef.current) {
      isInitialRevisionRenderRef.current = false;
      return;
    }
    drain();
  }, [revision, drain]);
}
