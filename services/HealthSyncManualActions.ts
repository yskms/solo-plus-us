/**
 * 基本設計 v0.11 §9.6/§10.4・設計判断記録 D-51 — Settings > Health Connect
 * の「未同期の変更」一覧から手動で行う操作のうち、単純な1文で完結しない
 * もの。「今すぐ再試行」（`HealthSyncJobRepository.requestManualRetry`）は
 * 単発の UPDATE で完結するため、UI から直接そのリポジトリ関数を呼べばよく
 * （`app/settings/data.tsx` が `ActivityRepository.countAllActivities` を
 * 直接呼んでいるのと同じ扱い）、ここには置かない。
 *
 * 「破棄」だけはジョブ削除と `health_sync` への `uncertain`/`declined`
 * 記録（D-51）を1トランザクションで束ねる必要があり、
 * `repositories/HealthSyncJobRepository`/`HealthSyncRepository` は
 * `SqlExecutor` を受け取るだけでトランザクションは持たない
 * （このプロジェクトの一貫した構造）ため、`services/ActivityService.
 * deleteActivity` と同じ形でここに置く。
 */
import * as ActivityRepository from '../repositories/ActivityRepository';
import * as HealthSyncJobRepository from '../repositories/HealthSyncJobRepository';
import * as HealthSyncRepository from '../repositories/HealthSyncRepository';
import { mappingImpliesExternalTouch, toMappingState } from './syncJobPlanner';
import type { Transactor } from '../database/SqlExecutor';

export type DiscardSyncJobResult = 'discarded' | 'not-found-or-claimed';

/**
 * Settings「破棄」（D-35/§9.6）。`HealthSyncJobRepository.discardJob`
 * （ジョブ行の削除のみ）を、`operation` に応じて必要な後始末と束ねる：
 *
 * - `delete` / 内部不整合（`lastErrorCode === 'LOCAL_ACTIVITY_NOT_FOUND'`）：
 *   Activity は既に存在しない（前者は定義上、後者は §9.5.3 の内部不整合が
 *   意味するところ）——`health_sync` へは FK RESTRICT により行を作れず、
 *   作る理由もない。ジョブを削除するだけ。
 * - `create` / `update` / `recreate`：Activity がまだ存在すれば、
 *   `HealthSyncRepository.upsertDeclinedOrUncertainMapping` で
 *   `sync_state` を記録する（D-51）。
 *
 * **`declined`/`uncertain` の判定は、破棄するジョブ自身の `attempts` だけ
 * では決められない（レビューで実際に指摘・再現された）。** `update`/
 * `recreate` ジョブは `syncJobPlanner.ts` の `planForEdit` が
 * `mappingState === 'synced'` のときにしか作らない——つまり `update`
 * ジョブの存在自体が「この (activity, provider) には既に確認済みの
 * mapping がある」ことを含意する。この `update` が一度も試行されない
 * （`attempts === 0`）まま破棄されても、**それ以前の `create`/`recreate`
 * が既に外部へ到達している可能性は消えない**——`attempts === 0` だけで
 * `declined` にすると、確実に存在するかもしれない外部レコードが
 * `planForDelete` から見えなくなる（§10.1 順6 に落ち、防御的 delete が
 * 一切積まれない）。
 *
 * したがって判定は「このジョブの `attempts` **または** discard 前の
 * mapping が `mappingImpliesExternalTouch`（`synced`/`uncertain`）で
 * あったか」の OR で行う——`services/syncJobPlanner.ts`
 * `planForDelete` が使うのと同じ述語をそのまま import して使う
 * （表の複製を避ける、D-21）。
 *
 * `claimedAt` の項を省ける理由：D-39 のガード（`HealthSyncJobRepository.
 * discardJob` は `claimed_at IS NULL` のジョブしか削除しない）により、
 * この関数がジョブを実際に削除できた時点でそのジョブは unclaimed だったと
 * 確定している。
 */
export async function discardSyncJob(db: Transactor, jobId: string): Promise<DiscardSyncJobResult> {
  let result: DiscardSyncJobResult = 'not-found-or-claimed';

  await db.transaction(async (tx) => {
    const job = await HealthSyncJobRepository.findJobById(tx, jobId);
    if (!job || job.claimedAt !== null) return; // D-39: claim済みは対象外

    const jobDiscarded = await HealthSyncJobRepository.discardJob(tx, jobId);
    if (!jobDiscarded) return; // 同じ D-39 の条件を素の primitive 側でも再確認（冗長だが害はない）

    if (job.operation !== 'delete') {
      const activity = await ActivityRepository.findActivityById(tx, job.activityId);
      if (activity) {
        const existingMapping = await HealthSyncRepository.findMapping(tx, job.activityId, job.provider);
        const externalTouchPossible =
          job.attempts > 0 || mappingImpliesExternalTouch(toMappingState(existingMapping));
        await HealthSyncRepository.upsertDeclinedOrUncertainMapping(tx, {
          activityId: job.activityId,
          provider: job.provider,
          syncState: externalTouchPossible ? 'uncertain' : 'declined',
        });
      }
      // Activity が無い場合（§9.5.3 の内部不整合）は FK RESTRICT により
      // health_sync 行を作れず、作る理由も無い——何もしない。
    }
    // operation === 'delete': Activity は定義上すでに存在せず、mapping も
    // ActivityService.deleteActivity が同期的に削除済み——何もしない。

    result = 'discarded';
  });

  return result;
}
