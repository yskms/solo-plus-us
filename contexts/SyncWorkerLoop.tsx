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
 * `mountedForegroundRef` が「継続してよいか」（`drainDueJobs` の
 * `shouldContinue`）を表す唯一の状態。**すでに claim して trackSyncCycle
 * に入ったジョブは、これが false になっても強制中断しない**——
 * `drainDueJobs`/`SyncCoordinator` 側の設計通り、次の `processNextDueJob`
 * 呼び出しの前にしか確認しない（ネイティブ呼び出しを取り消す手段が無いのは
 * SyncCoordinator と同じ理由、D-41）。
 *
 * **`'active'` との一致ではなく「`'background'`/`'inactive'` でない」で
 * 判定する（3回目のレビューで指摘）。** `AppState.currentState` はマウント
 * 直後の時点では `null`/`'unknown'` になりうる（React Native 自身の実装に
 * 初期値が信頼できない旨のコメントがある既知の癖）。`=== 'active'` で
 * 判定していると、その場合に「継続してよいか」が false のまま固定され、
 * セッション中一度もバックグラウンドに移行しなければ `change` イベントも
 * 発火せず、同期が一度も走らないまま終わる。不明な状態は「フォアグラウンド
 * 扱い」に倒す方が安全——バックグラウンドで余分に1サイクル走っても
 * 「実行中の呼び出しは確定処理まで進める」の許容範囲内（§9.5.4）。
 *
 * ## 周期的な再チェック
 * §9.5.4 は「フォアグラウンド中に `not_before` が経過したジョブをいつ
 * 拾うか」を規定していない（README「Phase 4」の Known gaps で指摘済みの
 * 未決事項だった）。5秒の Undo 遅延（D-44）や §9.6 のバックオフが経過した
 * 直後を大きく待たせないよう、10秒間隔の周期実行で補う——正確な間隔を
 * 要求する仕様上の根拠は無く、調整可能な値として扱ってよい。
 *
 * ## 多重実行防止（3回目のレビューで指摘・実機相当の再現あり）
 * トリガは4つ（マウント時・AppState→foreground復帰・周期実行・
 * DataRevision bump）あり、`drain()` 自体は元々 fire-and-forget だった。
 * ネイティブ呼び出しが周期間隔（10秒）を超えて続くと（低速端末・
 * コールドスタート・D-41 の「cancel もタイムアウトも無い」性質から
 * 現実的にありうる）、次の周期 tick が2本目の `drainDueJobs` を起動し、
 * 2本がそれぞれ別のジョブを claim して両方が finalize の
 * `db.transaction` に到達し「cannot start a transaction within a
 * transaction」で衝突することを、integration test で実際に再現した
 * （`test/__tests__/syncWorkerLoop.concurrency.integration.test.ts`）。
 * この設計全体は「プロセス内は単一ワーカー」を前提にしている
 * （§6.2/D-36、`services/SyncWorker.ts` の lost-claim-race コメント参照）
 * ため、配線側でこの前提を壊してはならない——`drainingRef`/`rerunRef` で
 * 「実行中なら、完了後にもう一度だけ実行する」形に直列化し、取りこぼしも
 * 起こさない。
 */
import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useDatabase } from './DatabaseContext';
import { useDataRevision } from './DataRevision';
import { drainDueJobs } from '../services/SyncWorker';
import { logError } from '../lib/log';

const PERIODIC_DRAIN_INTERVAL_MS = 10_000;

/** `'background'`/`'inactive'` 以外はフォアグラウンド扱い（上記コメント参照。`null`/`'unknown'` を安全側に倒す）。 */
function isForegroundStatus(status: AppStateStatus | null): boolean {
  return status !== 'background' && status !== 'inactive';
}

/**
 * `active` への遷移（かつ直前は `active` ではなかった）でだけ true。
 * `lib/screenMask.ts`の `handleAppStateChangeForReapply` と同じく、
 * `useSyncWorkerLoop` の effect ライフサイクル全体を駆動せずに単体で
 * テストできるよう切り出している。`isForegroundStatus` とは別の判定
 * ——こちらは「追加で1回 drain する価値がある、はっきりした復帰」を
 * 検出するためのもので、`inactive` のような一時的な状態は含めない。
 */
export function shouldTriggerDrainOnAppStateChange(previous: AppStateStatus, next: AppStateStatus): boolean {
  return next === 'active' && previous !== 'active';
}

export function useSyncWorkerLoop(): void {
  const db = useDatabase();
  const { revision } = useDataRevision();
  const mountedForegroundRef = useRef(isForegroundStatus(AppState.currentState));
  const drainingRef = useRef(false);
  const rerunRequestedRef = useRef(false);

  const drain = useCallback(() => {
    if (!mountedForegroundRef.current) return;
    if (drainingRef.current) {
      rerunRequestedRef.current = true; // 実行中——完了後にもう一度だけ、取りこぼさず実行する
      return;
    }
    drainingRef.current = true;
    drainDueJobs(db, 'health_connect', { shouldContinue: () => mountedForegroundRef.current })
      .catch((error) => logError('useSyncWorkerLoop: drainDueJobs failed', error))
      .finally(() => {
        drainingRef.current = false;
        if (rerunRequestedRef.current) {
          rerunRequestedRef.current = false;
          drain();
        }
      });
  }, [db]);

  useEffect(() => {
    mountedForegroundRef.current = isForegroundStatus(AppState.currentState);
    let previousStatus = AppState.currentState;
    drain(); // §9.5.4「次の active で再開する」— マウント時点で foreground ならここが最初の「再開」

    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      const previous = previousStatus;
      previousStatus = next;
      mountedForegroundRef.current = isForegroundStatus(next);
      if (shouldTriggerDrainOnAppStateChange(previous, next)) drain();
      // inactive/background: mountedForegroundRef を false にするだけ。新規
      // claim は shouldContinue で止まり、実行中の呼び出しは確定処理まで
      // 進む（§9.5.4、ファイル冒頭コメント参照）。
    });

    const interval = setInterval(drain, PERIODIC_DRAIN_INTERVAL_MS);

    return () => {
      mountedForegroundRef.current = false;
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
