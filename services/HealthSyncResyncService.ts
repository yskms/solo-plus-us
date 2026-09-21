/**
 * 基本設計 v0.11 §13.6・設計判断記録 D-34 — Health Connect への明示的な
 * 一括再同期（§13.1「既定 OFF・明示同意制」）。二つの入口から呼ばれる：
 *
 * 1. `app/settings/data.tsx` の `offerResync` ステップ——置換復元
 *    （`performReplaceImport` が `health_sync`/`health_sync_jobs` を全削除
 *    した）直後、一度だけ出す同意画面
 * 2. `app/settings/health-connect.tsx` の「Sync everything to Health
 *    Connect」——いつでも呼べる恒久的な入口
 *
 * **2番目の入口は当初無く、レビューで追加した。** `offerResync` だけだと
 * 「Not now」を押す・画面を離れる・復元直後にアプリが落ちる等で同意の
 * 機会を逃すと、二度と再同期する手段が無かった。復元後は `health_sync`
 * が空になり `mappingState` は `'none'` になるため、`syncJobPlanner.
 * planForEdit` は以後の編集でも noop を返し続け（D-51）、基本設計
 * §13.3.2「復元後に Activity を編集すれば、通常どおり同期ジョブが作られる」
 * という約束と矛盾する恒久的な未救済状態になっていた。
 *
 * **この恒久的な入口は §13.6 が本来規定する「Import 後の再同期」の範囲を
 * 超えて使える（2巡目のレビューで指摘）。** 例えば HC を初めて ON にした
 * 直後に押せば、過去の全履歴を一括送信できる——これは §13.1 の「既定
 * OFF・明示同意制」自体には反しない（明示的なボタン＋件数を示した確認
 * ダイアログを経由する、下記 `countPendingResync` 参照）が、意図して
 * 追加した振る舞いであることをここに明記しておく。センシティブなデータを
 * 外部へまとめて送る操作のため、UI 側は必ず送信前に対象件数を見せること
 * （`app/settings/health-connect.tsx` の `handleResyncEverything` 参照）。
 *
 * `services/ImportService.ts` に置かない理由：`performReplaceImport` 単体は
 * ジョブを一切作らないという不変条件（`test/__tests__/
 * exportImport.integration.test.ts` "does not re-queue sync jobs" が保証）
 * があり、隣接させると境界が曖昧になる。`services/ActivityService.ts` にも
 * 置かない理由：`recordActivity`/`updateActivity`/`deleteActivity` は単一
 * Activity を `syncJobPlanner` の状態遷移と組み合わせるが、ここは
 * planner を経由せず全 Activity に機械的に `recreate` を積むだけで性質が
 * 異なる。`services/HealthSyncManualActions.ts` と同じ「単機能サービス」の
 * 粒度・命名系統に揃えた新規ファイル。
 *
 * `SyncCoordinator.runExclusive` では包まない：既存ジョブ・mapping の削除・
 * 置換を一切行わず `insertJobsBulk` の追加のみを行う点で、`ActivityService.
 * recordActivity` のジョブ挿入と同じ性質であり、`runExclusive` が対象と
 * する「破壊的操作」（置換復元・全削除・HC切断等）に該当しない。呼び出し
 * 側は `performReplaceImport` の `runExclusive` 完了後に**別のステップ
 * として**この関数を呼ぶこと——同じコールバック内にネストすると
 * `SyncCoordinator.ts` の直列化キューが自己デッドロックする（CLAUDE.md）。
 *
 * ## この関数が安全な理由
 * 「同意画面表示中に他の書き込みが割り込んだらユニーク制約に衝突するの
 * では」という懸念は、この app の DB 接続の実際の直列化保証により起こらない
 * ——`@op-engineering/op-sqlite` の `db.transaction()` は接続ごとに1つの
 * FIFO キュー（`lock.queue`/`lock.inProgress`、`node_modules/
 * @op-engineering/op-sqlite/src/functions.ts`）を internal に持ち、複数の
 * `db.transaction()` 呼び出しは衝突・例外ではなく自動的に直列実行される。
 * `queueResync` 全体が1つの `db.transaction()` である限り、その最中に他の
 * `ActivityService.recordActivity` 等が新しいジョブを挿入する余地は無い
 * （それらの `db.transaction()` はこの関数のトランザクションが完了する
 * まで単にキューで待つ）。
 *
 * ただしこれは裏を返せば、**`queueResync` が実行されている間、アプリ全体の
 * 他のどの `db.transaction()`（新規記録・SyncWorker の finalize 含む）も
 * 完了までブロックされる**ということでもある——`insertJobsBulk`
 * （`repositories/HealthSyncJobRepository.ts`）で一括 INSERT にまとめて
 * いるのはこのため（Activity 数に比例して増える `insertJob` 1件あたり
 * 2ステートメント・N 往復を避け、この関数の所要時間そのものを短縮する）。
 */
import { getActiveProviders } from './ActivityService';
import * as ActivityRepository from '../repositories/ActivityRepository';
import * as HealthSyncJobRepository from '../repositories/HealthSyncJobRepository';
import * as HealthSyncRepository from '../repositories/HealthSyncRepository';
import { nowUtcIso } from '../lib/datetime';
import type { SqlExecutor, Transactor } from '../database/SqlExecutor';
import type { Provider } from '../types/HealthSync';

export interface ResyncResult {
  /** Summed across every currently-active provider (only `health_connect` in v1, D-34's "provider を DB 制約で縛らない"). */
  queuedCount: number;
  /** Same summing as `queuedCount` — an Activity already having a job/exclusion for one provider doesn't affect another. */
  skippedCount: number;
}

interface ResyncTarget {
  activityId: string;
  provider: Provider;
}

/**
 * どの (activity, provider) に `recreate` を積むべきかを決める、読み取り
 * 専用の共通ロジック。`queueResync`（実際に挿入する）と `countPendingResync`
 * （UI の確認ダイアログ向けの事前カウント、書き込みなし）の両方がこれを
 * 使う——判定ロジックを2箇所に複製しない。
 *
 * 除外するのは次の2つだけ：
 *
 * - 既存ジョブがある（`uq_health_sync_jobs` の衝突を避けるため——
 *   `queueResync` 自体が単一の `db.transaction()` である間は、この事前
 *   チェックと実際の挿入の間で状態が変わることもない）
 * - mapping の `sync_state` が `'declined'`/`'uncertain'`（D-51/D-35——
 *   利用者が明示的に「同期しない」を選んだ記録を、この一括操作で覆さない）
 *
 * **`sync_state = 'synced'` は除外しない**（2巡目のレビューで指摘・修正）。
 * 除外すると、Health Connect アプリ側で直接削除された記録（D-20 が実機
 * 検証した経路そのもの）を、この一括操作では二度と救済できなくなる
 * ——ローカルの mapping は「synced」のままだが、READ 権限を持たない
 * （D-12/D-20）ため実際に HC 上にまだ存在するかは確認できない。
 * `recreate` は常に安全（D-34「副作用のある永続状態を持たない」）なので、
 * 既に正しく同期済みの記録を含めて delete→insert し直すコストの方が、
 * 「同期済みのはずなのに直す手段が無い」状態より許容できると判断した。
 */
async function resolveResyncTargets(executor: SqlExecutor): Promise<{ targets: ResyncTarget[]; totalConsidered: number }> {
  const activeProviders = await getActiveProviders(executor);
  if (activeProviders.length === 0) return { targets: [], totalConsidered: 0 };

  const activities = await ActivityRepository.findAllActivities(executor);
  const targets: ResyncTarget[] = [];

  for (const provider of activeProviders) {
    const [existingJobs, existingMappings] = await Promise.all([
      HealthSyncJobRepository.findAllJobsForProvider(executor, provider),
      HealthSyncRepository.findAllMappingsForProvider(executor, provider),
    ]);
    const activityIdsToSkip = new Set([
      ...existingJobs.map((job) => job.activityId),
      ...existingMappings.filter((m) => m.syncState === 'declined' || m.syncState === 'uncertain').map((m) => m.activityId),
    ]);

    for (const activity of activities) {
      if (activityIdsToSkip.has(activity.id)) continue;
      targets.push({ activityId: activity.id, provider });
    }
  }

  return { targets, totalConsidered: activities.length * activeProviders.length };
}

/**
 * 送信前に対象件数を利用者へ見せるための、書き込みを伴わない事前カウント
 * （`app/settings/health-connect.tsx` の確認ダイアログが使う）。判定
 * ロジックは `queueResync` と共有しているため、ここで見せた件数と実際に
 * 積まれる件数は（その間に他の書き込みが無ければ）一致する。
 */
export async function countPendingResync(executor: SqlExecutor): Promise<number> {
  return (await resolveResyncTargets(executor)).targets.length;
}

export async function queueResync(db: Transactor): Promise<ResyncResult> {
  let queuedCount = 0;
  let skippedCount = 0;

  await db.transaction(async (tx) => {
    const { targets, totalConsidered } = await resolveResyncTargets(tx);
    const now = nowUtcIso();

    await HealthSyncJobRepository.insertJobsBulk(
      tx,
      targets.map((target) => ({ ...target, operation: 'recreate' as const, notBefore: now })),
    );
    queuedCount = targets.length;
    skippedCount = totalConsidered - targets.length;
  });

  return { queuedCount, skippedCount };
}
